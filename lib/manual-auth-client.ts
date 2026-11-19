import type { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import * as Auth from "@/lib/_core/auth";
import { createTRPCClient, trpc } from "@/lib/trpc";
import { authSessionState } from "@/shared/auth-session-state";

// These raw calls do not create React Query mutation records containing secrets.
export const manualAuthClient = createTRPCClient();

export type ManualSession = {
  app_session_id: string;
  user: Auth.User & { accountFrozen?: boolean };
};

export function assertManualSession(session: ManualSession, expectedEmail?: string) {
  if (!session.app_session_id || !session.user || !Number.isSafeInteger(session.user.id) ||
      session.user.id <= 0 || !session.user.openId || !/^\d{10}$/.test(session.user.customerId) || /^0{10}$/.test(session.user.customerId)) {
    throw new Error("استجابة تسجيل الدخول لا تحتوي جلسة وحسابًا صالحين.");
  }
  if (expectedEmail && session.user.email?.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    throw new Error("استجابة الخادم لا تطابق الحساب المطلوب. لم تُعرض بياناتها.");
  }
}

export async function saveManualSession(
  session: ManualSession,
  queryClient: QueryClient,
  generation = authSessionState.getSnapshot().generation,
) {
  assertManualSession(session);
  authSessionState.assertCurrent(generation);
  // Cancel in-flight previous-account reads before seeding the authenticated identity.
  await queryClient.cancelQueries();
  authSessionState.assertCurrent(generation);
  queryClient.clear();
  await Auth.setSessionToken(session.app_session_id);
  authSessionState.assertCurrent(generation);
  await Auth.setUserInfo({ ...session.user, lastSignedIn: new Date(session.user.lastSignedIn) });
  authSessionState.assertCurrent(generation);
  queryClient.setQueryData(getQueryKey(trpc.auth.me, undefined, "query"), session.user);
  authSessionState.signIn();
}
