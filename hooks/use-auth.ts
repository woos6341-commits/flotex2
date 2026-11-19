import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { trpc } from "@/lib/trpc";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { getDeviceIdentity } from "@/lib/device-identity";
import { authSessionState } from "@/shared/auth-session-state";
import { performLogout } from "@/shared/logout-lifecycle";
import { resolveSessionUser, shouldBlockForAuthState } from "@/shared/auth-session-resolution";
import { clearVerificationPhotoDrafts } from "@/lib/verification-photo-picker";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

type StoredSession = {
  ready: boolean;
  token: boolean;
  user: Auth.User | null;
};

const AUTH_STORAGE_BOOT_TIMEOUT_MS = 5_000;
const AUTH_SERVER_VERIFY_TIMEOUT_MS = 15_000;

// useAuth is mounted by several screens at once. Keep one shared refresh in
// flight so a cold start does not send a burst of duplicate requests.
let sharedSessionRefresh: Promise<void> | null = null;

export function useAuth(options?: { autoFetch?: boolean }) {
  const state = useSyncExternalStore(authSessionState.subscribe, authSessionState.getSnapshot, authSessionState.getSnapshot);
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<StoredSession>({ ready: false, token: false, user: null });
  const refreshAttempted = useRef(false);
  const [serverVerificationTimedOut, setServerVerificationTimedOut] = useState(false);

  // Restore the durable token and cached profile before asking the server. A cold
  // start, an offline phone, or a slow API must not look like a logout.
  useEffect(() => {
    let alive = true;
    refreshAttempted.current = false;
    const storageTimeout = setTimeout(() => {
      if (alive) setSession((current) => current.ready ? current : { ...current, ready: true });
    }, AUTH_STORAGE_BOOT_TIMEOUT_MS);
    void Promise.all([Auth.getSessionToken(), Auth.getUserInfo()])
      .then(([token, user]) => {
        if (!alive) return;
        setSession({ ready: true, token: Boolean(token), user: token ? user : null });
      })
      .catch(() => {
        if (alive) setSession((current) => ({ ...current, ready: true }));
      });
    return () => { alive = false; clearTimeout(storageTimeout); };
  }, [state.generation]);

  const canQuery = session.ready && session.token && !state.signedOut && (options?.autoFetch ?? true);
  const me = trpc.auth.me.useQuery(undefined, {
    enabled: canQuery,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 4000),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (!canQuery || session.user || !me.isLoading) {
      setServerVerificationTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setServerVerificationTimedOut(true), AUTH_SERVER_VERIFY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [canQuery, me.isLoading, session.user]);

  // A successful null response is the only server signal that the session is
  // genuinely invalid. Query errors and loading states keep the cached identity.
  useEffect(() => {
    if (!me.isSuccess) return;
    if (me.data) {
      setSession((current) => ({ ...current, ready: true, token: true, user: me.data }));
      void Auth.setUserInfo(me.data).catch(() => undefined);
      return;
    }
    if (!session.token || authSessionState.getSnapshot().signedOut) return;
    authSessionState.signOut();
    void queryClient.cancelQueries();
    queryClient.clear();
    utils.auth.me.setData(undefined, null);
    void Promise.all([
      Auth.removeSessionToken(),
      Auth.clearUserInfo(),
      Auth.clearSessionRefreshMarker(),
      clearVerificationPhotoDrafts(),
    ]).catch(() => undefined);
  }, [me.data, me.isSuccess, queryClient, session.token, utils]);

  // Touch the device session while it is valid. Refresh once per day; failures
  // are deliberately swallowed because they are not a logout event.
  useEffect(() => {
    if (!me.isSuccess || !me.data || !session.token || refreshAttempted.current || authSessionState.getSnapshot().signedOut) return;
    refreshAttempted.current = true;
    if (sharedSessionRefresh) return;
    sharedSessionRefresh = (async () => {
      try {
        if (!(await Auth.shouldRefreshSessionToken())) return;
        const identity = await getDeviceIdentity();
        const refreshed = await manualAuthClient.auth.refresh.mutate(identity);
        if (!refreshed?.app_session_id || !refreshed.user) return;
        await Auth.setSessionToken(refreshed.app_session_id);
        await Auth.setUserInfo(refreshed.user);
        await Auth.markSessionTokenRefreshed();
        queryClient.setQueryData(getQueryKey(trpc.auth.me, undefined, "query"), refreshed.user);
      } catch {
        // Keep the existing token; the next app resume will retry if needed.
      }
    })().finally(() => { sharedSessionRefresh = null; });
  }, [me.data, me.isSuccess, queryClient, session.token]);

  const logout = useCallback(() => performLogout({
    captureToken: Auth.getSessionToken,
    signOut: authSessionState.signOut,
    cancelQueries: () => queryClient.cancelQueries(),
    clearCache: () => {
      queryClient.clear(); // All account/wallet data and mutation inputs/results.
      utils.auth.me.setData(undefined, null);
    },
    clearLocal: () => Promise.all([
      Auth.removeSessionToken(),
      Auth.clearUserInfo(),
      Auth.clearSessionRefreshMarker(),
      clearVerificationPhotoDrafts(),
    ]),
    revoke: Api.logout,
  }), [queryClient, utils]);

  const storedUser = session.token ? session.user : null;
  const user = resolveSessionUser({ signedOut: state.signedOut, serverSettled: me.isSuccess, serverUser: me.data ?? null, storedUser });
  const loading = shouldBlockForAuthState({
    sessionReady: session.ready,
    hasSessionToken: session.token,
    hasCachedUser: Boolean(session.user),
    serverQueryLoading: me.isLoading,
    serverVerificationTimedOut,
  });
  const error = state.signedOut ? null : me.error;

  return {
    user,
    loading,
    error,
    isAuthenticated: Boolean(user),
    refresh: me.refetch,
    logout,
    sessionReady: session.ready,
    hasStoredSession: session.token,
    sessionVerified: me.isSuccess && Boolean(me.data),
  };
}
