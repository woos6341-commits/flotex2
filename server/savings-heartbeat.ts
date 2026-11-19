import { jwtVerify } from "jose";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import { getDb } from "./db";
import { processAutomaticSavingsPayouts } from "./savings";
import {
  SAVINGS_AUTO_PAYOUT_PATH,
  SAVINGS_AUTO_PAYOUT_JOB_NAME,
  SAVINGS_AUTO_PAYOUT_TASK_UID_KEY,
  SAVINGS_EXTERNAL_AUTO_PAYOUT_PATH,
} from "./savings-schedule-config";

export {
  SAVINGS_AUTO_PAYOUT_PATH,
  SAVINGS_AUTO_PAYOUT_JOB_NAME,
  SAVINGS_AUTO_PAYOUT_TASK_UID_KEY,
  SAVINGS_EXTERNAL_AUTO_PAYOUT_PATH,
} from "./savings-schedule-config";
const IDENTITY_METHOD = "webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt";
const MAX_TICKET_LIFETIME_SECONDS = 2 * 60 * 60 + 30;
const MAX_CRON_SIGNATURE_SKEW_MS = 5 * 60 * 1000;

export class SavingsHeartbeatError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(code);
    this.name = "SavingsHeartbeatError";
  }
}

export type SavingsHeartbeatIdentity = {
  openId: string;
  projectId: string;
  name: string;
  taskUid: string;
};

type HeartbeatClaims = {
  appId?: unknown;
  openId?: unknown;
  name?: unknown;
  exp?: unknown;
};

type AuthenticateOptions = {
  jwtSecret: string;
  projectId: string;
  oauthApiUrl: string;
  fetcher?: typeof fetch;
};

function getPlatformToken(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  const values = cookieHeader.split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith("app_session_id="));
  if (values.length !== 1) return null;
  const token = values[0].slice("app_session_id=".length);
  return token && !/[\s,;]/.test(token) ? token : null;
}

export async function authenticateSavingsHeartbeat(cookieHeader: string | undefined, options?: AuthenticateOptions): Promise<SavingsHeartbeatIdentity> {
  const jwtSecret = options?.jwtSecret ?? process.env.MANUS_JWT_SECRET ?? process.env.JWT_SECRET ?? "";
  const projectId = options?.projectId ?? process.env.MANUS_PROJECT_ID ?? "";
  const oauthApiUrl = options?.oauthApiUrl ?? process.env.MANUS_OAUTH_API_URL ?? process.env.OAUTH_SERVER_URL ?? "";
  const fetcher = options?.fetcher ?? fetch;
  if (!jwtSecret || !projectId || !oauthApiUrl) throw new SavingsHeartbeatError(503, "heartbeat_auth_unavailable");

  const token = getPlatformToken(cookieHeader);
  if (!token) throw new SavingsHeartbeatError(401, "missing_schedule_ticket");

  let claims: HeartbeatClaims;
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(jwtSecret), { algorithms: ["HS256"] });
    claims = verified.payload as HeartbeatClaims;
  } catch {
    throw new SavingsHeartbeatError(401, "invalid_schedule_ticket");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds || claims.exp > nowSeconds + MAX_TICKET_LIFETIME_SECONDS) {
    throw new SavingsHeartbeatError(401, "expired_schedule_ticket");
  }
  if (claims.appId !== projectId || typeof claims.openId !== "string" || !claims.openId.startsWith("cron_") || typeof claims.name !== "string") {
    throw new SavingsHeartbeatError(403, "schedule_identity_mismatch");
  }

  const endpoint = `${oauthApiUrl.replace(/\/+$/, "")}/${IDENTITY_METHOD}`;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt_token: token, project_id: projectId }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SavingsHeartbeatError(502, "schedule_identity_lookup_failed");
  }
  if (!response.ok) throw new SavingsHeartbeatError(502, "schedule_identity_lookup_failed");

  let identity: Partial<SavingsHeartbeatIdentity> & { error?: unknown };
  try {
    identity = await response.json() as Partial<SavingsHeartbeatIdentity> & { error?: unknown };
  } catch {
    throw new SavingsHeartbeatError(502, "schedule_identity_lookup_failed");
  }
  if (identity.error || identity.projectId !== projectId || identity.openId !== claims.openId || identity.name !== claims.name || typeof identity.taskUid !== "string" || !identity.taskUid) {
    throw new SavingsHeartbeatError(403, "schedule_identity_mismatch");
  }
  return identity as SavingsHeartbeatIdentity;
}

type HeartbeatDependencies = {
  authenticate?: typeof authenticateSavingsHeartbeat;
  getDatabase?: typeof getDb;
  runSweep?: typeof processAutomaticSavingsPayouts;
};

export function createSavingsAutoPayoutHandler(dependencies: HeartbeatDependencies = {}): RequestHandler {
  const authenticate = dependencies.authenticate ?? authenticateSavingsHeartbeat;
  const getDatabase = dependencies.getDatabase ?? getDb;
  const runSweep = dependencies.runSweep ?? processAutomaticSavingsPayouts;

  return async (request: Request, response) => {
    try {
      const identity = await authenticate(request.headers.cookie);
      const db = await getDatabase();
      if (!db) return response.status(503).json({ ok: false, error: "database_unavailable" });

      const [allowedTask] = await db.select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, SAVINGS_AUTO_PAYOUT_TASK_UID_KEY))
        .limit(1);
      if (!allowedTask) return response.status(503).json({ ok: false, error: "heartbeat_task_not_configured" });
      if (allowedTask.value !== identity.taskUid) return response.status(403).json({ ok: false, error: "schedule_identity_mismatch" });

      const result = await runSweep();
      if (result.failed > 0) {
        return response.status(503).json({ ok: false, error: "some_savings_payouts_failed", ...result });
      }
      return response.status(200).json({ ok: true, ...result });
    } catch (error) {
      const failure = error instanceof SavingsHeartbeatError
        ? error
        : new SavingsHeartbeatError(503, "savings_auto_payout_sweep_failed");
      console.error("[savings-auto-payout] heartbeat failed", failure.code);
      return response.status(failure.statusCode).json({ ok: false, error: failure.code });
    }
  };
}

export function registerSavingsAutoPayoutHeartbeat(app: Pick<Express, "post">) {
  app.post(SAVINGS_AUTO_PAYOUT_PATH, createSavingsAutoPayoutHandler());
}

export function createSavingsCronSignature(secret: string, timestamp: string, method: string, path: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${method.toUpperCase()}.${path}`).digest("hex");
}

export function verifySavingsCronSignature(secret: string, timestamp: string, signature: string, method: string, path: string, now = Date.now()) {
  if (!/^\d{10,13}$/.test(timestamp)) return false;
  const numericTimestamp = Number(timestamp);
  const timestampMs = numericTimestamp < 1_000_000_000_000 ? numericTimestamp * 1000 : numericTimestamp;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > MAX_CRON_SIGNATURE_SKEW_MS) return false;
  const normalizedSignature = signature.replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalizedSignature)) return false;
  const expected = Buffer.from(createSavingsCronSignature(secret, timestamp, method, path), "hex");
  const provided = Buffer.from(normalizedSignature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function createExternalSavingsAutoPayoutHandler(dependencies: HeartbeatDependencies = {}): RequestHandler {
  const getDatabase = dependencies.getDatabase ?? getDb;
  const runSweep = dependencies.runSweep ?? processAutomaticSavingsPayouts;
  return async (request, response) => {
    const expected = process.env.SAVINGS_CRON_SECRET ?? "";
    const provided = request.header("x-flotex-cron-secret") ?? (request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    const expectedBytes = Buffer.from(expected);
    const providedBytes = Buffer.from(provided);
    if (!expected) return response.status(503).json({ ok: false, error: "cron_secret_unconfigured" });
    const staticSecretValid = expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
    const hmacValid = verifySavingsCronSignature(
      expected,
      request.header("x-flotex-cron-timestamp") ?? "",
      request.header("x-flotex-cron-signature") ?? "",
      request.method,
      request.path || (request.originalUrl ?? "").split("?")[0] || SAVINGS_EXTERNAL_AUTO_PAYOUT_PATH,
    );
    if (!staticSecretValid && !hmacValid) return response.status(401).json({ ok: false, error: "invalid_cron_secret" });
    try {
      const db = await getDatabase();
      if (!db) return response.status(503).json({ ok: false, error: "database_unavailable" });
      const result = await runSweep();
      if (result.failed > 0) return response.status(503).json({ ok: false, error: "some_savings_payouts_failed", ...result });
      return response.status(200).json({ ok: true, mode: "external-cron", ...result });
    } catch (error) {
      console.error("[savings-auto-payout] external cron failed", error instanceof Error ? error.message : "unknown");
      return response.status(503).json({ ok: false, error: "savings_auto_payout_sweep_failed" });
    }
  };
}
