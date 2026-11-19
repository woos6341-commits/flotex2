import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { trpc } from "@/lib/trpc";
import { getExpoProjectId, isExpoGo, usePushNotifications } from "@/hooks/use-push-notifications";

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });

export function PushRegistrar() {
  const auth = trpc.auth.me.useQuery();
  const { registerDevice } = usePushNotifications();
  const handledUser = useRef<number | null>(null);

  useEffect(() => {
    const userId = auth.data?.id;
    if (!userId) {
      handledUser.current = null;
      return;
    }
    if (Platform.OS === "web" || isExpoGo() || !getExpoProjectId()) {
      handledUser.current = null;
      return;
    }
    if (handledUser.current === userId) return;
    handledUser.current = userId;
    void registerDevice(false).catch(() => {
      // Push setup is optional and must never block sign-in, the wallet, or money operations.
    });
  }, [auth.data?.id, registerDevice]);

  return null;
}
