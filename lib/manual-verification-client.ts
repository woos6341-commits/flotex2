import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { manualVerificationRoot } from "@/server/manual-verification-router";
import { getApiBaseUrl } from "@/constants/api";
import * as Auth from "@/lib/_core/auth";
import { authSessionState } from "@/shared/auth-session-state";

/** Direct RPC: neither issued codes nor grants enter the React Query cache. */
export const manualVerificationClient = createTRPCProxyClient<typeof manualVerificationRoot>({
  links: [httpBatchLink({
    url: `${getApiBaseUrl()}/api/trpc`, transformer: superjson,
    async headers() {
      if (authSessionState.getSnapshot().signedOut) return {};
      const token = await Auth.getSessionToken();
      if (authSessionState.getSnapshot().signedOut) return {};
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    async fetch(url, options) {
      const state = authSessionState.getSnapshot();
      const response = await fetch(url, { ...options, cache: "no-store", credentials: state.signedOut ? "omit" : "include" });
      authSessionState.assertCurrent(state.generation);
      return response;
    },
  })],
});
