import { useCallback } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpc } from "@/lib/trpc";
import { classifyPushRegistrationError, PushRegistrationError } from "@/shared/push-registration-error";

const PUSH_TOKEN_STORAGE_KEY = "flotex.push.token";
export type PushRegistrationResult = "registered" | "denied" | "web" | "missing-project";

export function getExpoProjectId() {
  const extraProjectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return extraProjectId || Constants.easConfig?.projectId || null;
}

/** Expo Go's ownership marker is the available distinction from a development client. */
export function isExpoGo() {
  return Constants.appOwnership === "expo";
}

export function usePushNotifications() {
  const register = trpc.auth.registerPushToken.useMutation();
  const unregister = trpc.auth.unregisterPushToken.useMutation();

  const registerDevice = useCallback(async (requestPermission: boolean): Promise<PushRegistrationResult> => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return "web";

    let permission: Notifications.NotificationPermissionsStatus;
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("flotex-egp", {
          name: "Flotex EGP",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: "default",
        });
      }
      const current = await Notifications.getPermissionsAsync();
      permission = current.granted
        ? current
        : requestPermission && current.canAskAgain
          ? await Notifications.requestPermissionsAsync()
          : current;
    } catch (error) {
      throw classifyPushRegistrationError("device", error);
    }
    if (!permission.granted) return "denied";

    const projectId = getExpoProjectId();
    if (!projectId) return "missing-project";

    let token: string;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch (error) {
      throw classifyPushRegistrationError("token", error);
    }

    try {
      await register.mutateAsync({ token, provider: "expo", platform: Platform.OS as "ios" | "android" });
    } catch (error) {
      throw classifyPushRegistrationError("server", error);
    }

    try {
      await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    } catch {
      try {
        await unregister.mutateAsync({ token });
      } catch {
        // Best-effort cleanup: never report success if the local token cannot be persisted.
      }
      throw new PushRegistrationError("storage");
    }
    return "registered";
  }, [register.mutateAsync, unregister.mutateAsync]);

  const unregisterDevice = useCallback(async () => {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
    if (!token) return;
    await unregister.mutateAsync({ token });
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  }, [unregister.mutateAsync]);

  return { registerDevice, unregisterDevice, isPending: register.isPending || unregister.isPending };
}
