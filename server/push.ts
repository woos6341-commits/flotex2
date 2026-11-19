import { and, eq } from "drizzle-orm";
import { pushDeliveries, pushTokens } from "../drizzle/schema";
import { getDb } from "./db";

type PushInput = {
  userId: number;
  operationId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export class AmbiguousPushDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousPushDeliveryError";
  }
}

export function classifyPushFailure(error: unknown): "failed" | "unknown" {
  return error instanceof AmbiguousPushDeliveryError ? "unknown" : "failed";
}

export function isRetryablePushFailure(error: unknown) {
  if (error instanceof AmbiguousPushDeliveryError) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:push_http_429|\b429\b)/.test(message);
}

function isExpoToken(token: string) {
  return /^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9._-]+\]$/.test(token);
}

export function buildExpoPushPayload(token: string, input: PushInput, platform: string) {
  return {
    to: token,
    ...(platform === "android" ? { channelId: "flotex-egp" } : {}),
    title: input.title,
    body: input.body,
    data: input.data ?? {},
    sound: "default",
    priority: "high",
  };
}

export async function registerPushToken(userId: number, token: string, platform: string, provider = "expo") {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const normalized = token.trim();
  if (!isExpoToken(normalized)) throw new Error("رمز Expo Push غير صالح");
  if (provider !== "expo") throw new Error("موفر الإشعارات غير مدعوم لهذا التطبيق");
  if (!/^(ios|android)$/.test(platform)) throw new Error("منصة الجهاز غير صالحة");
  await db.insert(pushTokens).values({
    userId,
    token: normalized,
    provider,
    platform,
    enabled: 1,
  }).onDuplicateKeyUpdate({
    set: { userId, provider, platform, enabled: 1, lastSeenAt: new Date() },
  });
  return { success: true as const };
}

export async function unregisterPushToken(userId: number, token: string) {
  const db = await getDb();
  if (!db) return { success: false as const };
  const normalized = token.trim();
  if (!isExpoToken(normalized)) return { success: false as const };
  await db.update(pushTokens)
    .set({ enabled: 0 })
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, normalized)));
  return { success: true as const };
}

async function sendExpoPush(token: string, input: PushInput, platform: string) {
  let response: Response;
  try {
    response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(buildExpoPushPayload(token, input, platform)),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network_error";
    throw new AmbiguousPushDeliveryError(`push_network_result_unknown:${message}`.slice(0, 500));
  }

  const payload = await response.json().catch(() => null);
  const ticket = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  if (response.status >= 500) {
    throw new AmbiguousPushDeliveryError(`push_http_${response.status}_result_unknown`);
  }
  if (!response.ok || ticket?.status === "error") {
    throw new Error(String(ticket?.message || `push_http_${response.status}`).slice(0, 500));
  }
  if (ticket?.status !== "ok" || typeof ticket?.id !== "string") {
    throw new AmbiguousPushDeliveryError("push_response_acceptance_unknown");
  }
  return ticket.id;
}

const MAX_PUSH_ATTEMPTS = 3;

function affectedRows(result: unknown) {
  const rows = Array.isArray(result) ? result[0] : result;
  return Number((rows as { affectedRows?: number } | null)?.affectedRows ?? 0);
}

function retryDelay(attemptCount: number) {
  return Math.min(1000 * 2 ** Math.max(0, attemptCount - 1), 4000);
}

/**
 * Sends once per operation, customer and device. Only an explicit HTTP 429 rejection
 * can be retried, with a short bounded backoff. Ambiguous acceptance is never resent.
 */
export async function sendPushOnce(input: PushInput) {
  const db = await getDb();
  if (!db) return { attempted: 0, sent: 0, configured: false };
  const devices = await db.select().from(pushTokens)
    .where(and(eq(pushTokens.userId, input.userId), eq(pushTokens.enabled, 1)));
  let attempted = 0;
  let sent = 0;

  for (const device of devices) {
    const whereDelivery = and(
      eq(pushDeliveries.operationId, input.operationId),
      eq(pushDeliveries.token, device.token),
      eq(pushDeliveries.userId, input.userId),
    );
    const [existing] = await db.select({
      id: pushDeliveries.id,
      status: pushDeliveries.status,
      attemptCount: pushDeliveries.attemptCount,
      lastAttemptAt: pushDeliveries.lastAttemptAt,
      error: pushDeliveries.error,
    })
      .from(pushDeliveries).where(whereDelivery).limit(1);
    let attemptCount = 1;
    if (existing) {
      const retryable = existing.status === "failed" && isRetryablePushFailure(existing.error ?? "");
      if (!retryable || existing.attemptCount >= MAX_PUSH_ATTEMPTS) continue;
      const elapsed = Date.now() - (existing.lastAttemptAt ? new Date(existing.lastAttemptAt).getTime() : 0);
      if (elapsed < retryDelay(existing.attemptCount)) continue;
      attemptCount = existing.attemptCount + 1;
      const claimed = await db.update(pushDeliveries)
        .set({ status: "pending", attemptCount, lastAttemptAt: new Date(), error: null })
        .where(and(whereDelivery, eq(pushDeliveries.status, "failed"), eq(pushDeliveries.attemptCount, existing.attemptCount)));
      if (affectedRows(claimed) !== 1) continue;
    } else {
      try {
        await db.insert(pushDeliveries).values({
          userId: input.userId,
          operationId: input.operationId,
          token: device.token,
          provider: device.provider,
          status: "pending",
          attemptCount,
          lastAttemptAt: new Date(),
        });
      } catch {
        // A concurrent retry may have won the unique (operation, token, user) insert.
        const [raced] = await db.select({ id: pushDeliveries.id })
          .from(pushDeliveries).where(whereDelivery).limit(1);
        if (raced) continue;
        throw new Error("تعذر تسجيل محاولة الإشعار بأمان");
      }
    }

    while (attemptCount <= MAX_PUSH_ATTEMPTS) {
      attempted += 1;
      let providerMessageId: string;
      try {
        if (device.provider !== "expo") throw new Error(`provider_${device.provider}_not_configured`);
        providerMessageId = await sendExpoPush(device.token, input, device.platform);
      } catch (error) {
        const status = classifyPushFailure(error);
        const message = error instanceof Error ? error.message.slice(0, 500) : "push_failed";
        try {
          await db.update(pushDeliveries)
            .set({ status, error: message })
            .where(whereDelivery);
        } catch {
          // Keep the existing attempt row; an uncertain result is never blindly resent.
          console.warn("[push] could not persist provider failure state");
          break;
        }

        if (status !== "failed" || !isRetryablePushFailure(error) || attemptCount >= MAX_PUSH_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attemptCount)));
        const nextAttempt = attemptCount + 1;
        const claimed = await db.update(pushDeliveries)
          .set({ status: "pending", attemptCount: nextAttempt, lastAttemptAt: new Date(), error: null })
          .where(and(whereDelivery, eq(pushDeliveries.status, "failed"), eq(pushDeliveries.attemptCount, attemptCount)));
        if (affectedRows(claimed) !== 1) break;
        attemptCount = nextAttempt;
        continue;
      }

      try {
        await db.update(pushDeliveries)
          .set({ status: "sent", providerMessageId, sentAt: new Date(), error: null })
          .where(whereDelivery);
        sent += 1;
      } catch {
        // Expo accepted the request, but the receipt update is uncertain. Keep the
        // existing idempotency row and never submit this financial event again.
        try {
          await db.update(pushDeliveries)
            .set({ status: "unknown", error: "provider_accepted_but_delivery_receipt_not_persisted" })
            .where(whereDelivery);
        } catch {
          console.warn("[push] provider acceptance could not be persisted; pending row prevents duplicates");
        }
      }
      break;
    }
  }
  return { attempted, sent, configured: devices.length > 0 };
}
