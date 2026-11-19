import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { trpc } from "@/lib/trpc";

export function AppActivityReporter() {
  const { data: user } = trpc.auth.me.useQuery(undefined, { retry: false });
  const mutation = trpc.activity.report.useMutation();
  const mutateRef = useRef(mutation.mutate);
  const lastSentAt = useRef(0);
  const configuredBuild = Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber;
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "unknown";
  const buildNumber = Application.nativeBuildVersion ?? (configuredBuild == null ? undefined : String(configuredBuild));

  useEffect(() => {
    mutateRef.current = mutation.mutate;
  }, [mutation.mutate]);

  useEffect(() => {
    if (!user?.id) {
      lastSentAt.current = 0;
      return;
    }
    const report = () => {
      const now = Date.now();
      if (now - lastSentAt.current < 60_000) return;
      lastSentAt.current = now;
      mutateRef.current({ version, buildNumber });
    };
    report();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") report();
    });
    return () => subscription.remove();
  }, [buildNumber, user?.id, version]);

  return null;
}
