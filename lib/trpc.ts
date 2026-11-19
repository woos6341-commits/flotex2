import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/api";
import * as Auth from "@/lib/_core/auth";
import { authSessionState } from "@/shared/auth-session-state";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        // tRPC v11: transformer MUST be inside httpBatchLink, not at root
        transformer: superjson,
        async headers() {
          if (authSessionState.getSnapshot().signedOut) return {};
          const token = await Auth.getSessionToken();
          if (authSessionState.getSnapshot().signedOut) return {};
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // Custom fetch to include credentials for cookie-based auth
        async fetch(url, options) {
          const state = authSessionState.getSnapshot();
          const response = await fetch(url, {
            ...options,
            credentials: state.signedOut ? "omit" : "include",
          });
          authSessionState.assertCurrent(state.generation);
          return response;
        },
      }),
    ],
  });
}
