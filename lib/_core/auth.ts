import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { SESSION_TOKEN_KEY, USER_INFO_KEY } from "@/constants/api";

export type User = {
  id: number;
  openId: string;
  customerId: string;
  name: string | null;
  email: string | null;
  givenName?: string | null;
  birthDate?: string | null;
  governorate?: string | null;
  fatherName?: string | null;
  phoneNumber?: string | null;
  phoneVerifiedAt?: string | Date | null;
  nationalIdMasked?: string | null;
  profileCompletedAt?: string | Date | null;
  loginMethod: string | null;
  lastSignedIn: Date;
  role?: "user" | "admin";
};

export const AUTH_STATE_CHANGED_EVENT = "flotex-auth-state-changed";
const SESSION_REFRESHED_AT_KEY = "flotex.auth.sessionRefreshedAt";
const SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export function notifyAuthStateChanged(): void {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT));
  }
}

// FIFO prevents a late SecureStore write from surviving a subsequent logout.
let storageQueue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.catch(() => undefined);
  return result;
}
async function read(key: string) {
  return Platform.OS === "web" ? window.localStorage.getItem(key) : SecureStore.getItemAsync(key);
}
async function write(key: string, value: string) {
  if (Platform.OS === "web") window.localStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}
async function remove(key: string) {
  if (Platform.OS === "web") window.localStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}

export async function getSessionToken(): Promise<string | null> {
  try { return await serial(() => read(SESSION_TOKEN_KEY)); } catch { return null; }
}
export function setSessionToken(token: string): Promise<void> {
  return serial(() => write(SESSION_TOKEN_KEY, token));
}
export function removeSessionToken(): Promise<void> {
  return serial(() => remove(SESSION_TOKEN_KEY));
}
export async function shouldRefreshSessionToken(): Promise<boolean> {
  try {
    const raw = await serial(() => read(SESSION_REFRESHED_AT_KEY));
    const refreshedAt = raw ? Number(raw) : 0;
    return !Number.isFinite(refreshedAt) || refreshedAt <= 0 || Date.now() - refreshedAt >= SESSION_REFRESH_INTERVAL_MS;
  } catch {
    // A storage failure must never be treated as an expired session.
    return false;
  }
}
export function markSessionTokenRefreshed(): Promise<void> {
  return serial(() => write(SESSION_REFRESHED_AT_KEY, String(Date.now())));
}
export function clearSessionRefreshMarker(): Promise<void> {
  return serial(() => remove(SESSION_REFRESHED_AT_KEY));
}

/** Explicit allow-list: an unexpected server field can never persist a secret/hash. */
export function publicStoredUser(user: User): User {
  return {
    id: user.id, openId: user.openId, customerId: user.customerId,
    name: user.name, email: user.email, givenName: user.givenName,
    birthDate: user.birthDate, governorate: user.governorate, fatherName: user.fatherName,
    phoneNumber: user.phoneNumber, phoneVerifiedAt: user.phoneVerifiedAt,
    nationalIdMasked: user.nationalIdMasked, profileCompletedAt: user.profileCompletedAt,
    loginMethod: user.loginMethod, lastSignedIn: user.lastSignedIn, role: user.role,
  };
}
export async function getUserInfo(): Promise<User | null> {
  try {
    const info = await serial(() => read(USER_INFO_KEY));
    if (!info) return null;
    const parsed = JSON.parse(info);
    return publicStoredUser({ ...parsed, lastSignedIn: new Date(parsed.lastSignedIn) });
  } catch { return null; }
}
export function setUserInfo(user: User): Promise<void> {
  return serial(() => write(USER_INFO_KEY, JSON.stringify(publicStoredUser(user))));
}
export function clearUserInfo(): Promise<void> {
  return serial(() => remove(USER_INFO_KEY));
}
