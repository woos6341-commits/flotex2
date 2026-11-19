import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "@/constants/api";
import * as Auth from "./auth";
import { authSessionState } from "@/shared/auth-session-state";

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

export class ApiHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Cookies remain the primary web session. The stored token is a fallback for
  // embedded previews where third-party cookie policies can block Set-Cookie.
  const sessionToken = authSessionState.getSnapshot().signedOut ? null : await Auth.getSessionToken();
  if (sessionToken && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  }

  const baseUrl = getApiBaseUrl();
  // Ensure no double slashes between baseUrl and endpoint
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = baseUrl ? `${cleanBaseUrl}${cleanEndpoint}` : endpoint;
  const controller = new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  const abort=()=>controller.abort();
  options.signal?.addEventListener("abort",abort,{once:true});
  if(options.signal?.aborted)controller.abort();
  try {
    console.log("[API] Making request...");
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: options.credentials ?? (authSessionState.getSnapshot().signedOut ? "omit" : "include"),
      signal:controller.signal,
    });

    console.log("[API] Response received");
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorText;
      } catch {
        // Not JSON, use text as is
      }
      throw new ApiHttpError(errorMessage || `API call failed: ${response.statusText}`, response.status);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      console.log("[API] JSON response received");
      return data as T;
    }

    const text = await response.text();
    console.log("[API] Text response received");
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    if(controller.signal.aborted)throw new Error("انتهت مهلة الاتصال. تحقق من الشبكة وحاول مرة أخرى.");
    if(error instanceof TypeError)throw new Error("تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت.");
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("تعذر إكمال الاتصال بالخادم");
  } finally {
    clearTimeout(timeout);options.signal?.removeEventListener("abort",abort);
  }
}

// Logout
export async function logout(presentedToken?: string | null): Promise<void> {
  const pushToken = await AsyncStorage.getItem("flotex.push.token");
  await apiCall<void>("/api/auth/logout", {
    method: "POST",
    headers: presentedToken ? { Authorization: `Bearer ${presentedToken}` } : {},
    credentials: "include",
    body: JSON.stringify(pushToken ? { pushToken } : {}),
  });
  if (pushToken) await AsyncStorage.removeItem("flotex.push.token");
}

// Get current authenticated user (web uses cookie-based auth)
export async function getMe(): Promise<{
  id: number;
  openId: string;
  customerId: string;
  name: string | null;
  email: string | null;
  givenName: string | null;
  fatherName: string | null;
  phoneNumber: string | null;
  birthDate: string | null;
  governorate: string | null;
  profileCompletedAt: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
  role?: "user" | "admin";
} | null> {
  try {
    const result = await apiCall<{ user: any }>("/api/auth/me");
    return result.user || null;
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 401) return null;
    throw error;
  }
}

// Establish session cookie on the backend (3000-xxx domain)
// Called after receiving token via postMessage to get a proper Set-Cookie from the backend
export async function establishSession(token: string): Promise<boolean> {
  try {
    console.log("[API] establishSession: setting cookie on backend...");
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/auth/session`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include", // Important: allows Set-Cookie to be stored
    });

    if (!response.ok) {
      console.error("[API] establishSession failed");
      return false;
    }

    console.log("[API] establishSession: cookie set successfully");
    return true;
  } catch {
    console.error("[API] establishSession error");
    return false;
  }
}

/** Legacy OAuth callback compatibility; manual email login remains the primary flow. */
export async function exchangeOAuthCode(code: string, state: string): Promise<{ sessionToken?: string; user?: any }> {
  return apiCall<{ sessionToken?: string; user?: any }>(`/api/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
}
