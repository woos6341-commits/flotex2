import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useRootNavigationState, useRouter, useSegments } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { getPendingVerificationRoute } from "@/lib/verification-photo-picker";
import { authSessionState } from "@/shared/auth-session-state";
import { shouldRestoreVerificationRoute } from "@/shared/auth-routing";

export function VerificationRouteRecovery() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const navigation = useRootNavigationState();
  const segments = useSegments() as string[];
  const recovering = useRef(false);

  const recover = useCallback(async () => {
    if (recovering.current || loading || !user || !navigation?.key) return;
    recovering.current = true;
    const generation = authSessionState.getSnapshot().generation;
    try {
      const destination = await getPendingVerificationRoute(user.id);
      if (authSessionState.getSnapshot().generation !== generation) return;
      if (destination && shouldRestoreVerificationRoute(segments, destination)) {
        router.replace(destination);
      }
    } catch {
      // Recovery failure must never change the authenticated session.
    } finally {
      recovering.current = false;
    }
  }, [loading, navigation?.key, router, segments, user]);

  useEffect(() => {
    void recover();
  }, [recover]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void recover();
    });
    return () => subscription.remove();
  }, [recover]);

  return null;
}
