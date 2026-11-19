import Constants from "expo-constants";
import * as ReactNative from "react-native";
import { resolveApiBaseUrl } from "@/shared/api-base-url";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
const configuredApiBaseUrl = extra.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
const isDevelopment = typeof __DEV__ !== "undefined" && __DEV__;
const isWeb = ReactNative.Platform.OS === "web";

function getCurrentLocation() {
  if (!isWeb || typeof window === "undefined" || !window.location) return null;
  return {
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    origin: window.location.origin,
    port: window.location.port,
  };
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl({
    platform: isWeb ? "web" : "native",
    isDevelopment,
    configuredBaseUrl: configuredApiBaseUrl,
    location: getCurrentLocation(),
  });
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";
