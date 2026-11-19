import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/api";

const TOKEN_KEY = "flotex_guest_support_token_v1";
export type GuestAttachment = { data: string; mimeType: "image/jpeg" | "image/png" | "application/pdf" };
export type GuestStatus = "new" | "pending_reply" | "replied" | "closed";
export const GUEST_STATUS_LABELS: Record<GuestStatus, string> = { new: "جديدة", pending_reply: "قيد المراجعة", replied: "تم الرد", closed: "مغلقة" };
export type GuestMessage = { id: number; senderRole: "guest" | "admin"; body: string; attachment: GuestAttachment | null; readAt: string | null; createdAt: string };
export type GuestConversation = { ticket: { ticketCode: string; displayName: string; status: GuestStatus; updatedAt: string }; messages: GuestMessage[] };
// This is an idempotency identifier, not an authentication secret.
export function newGuestOperationId() { return `gs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`; }
async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "تعذر تنفيذ طلب الدعم.");
  return payload as T;
}
function webStorage(): Storage {
  if (typeof window === "undefined") throw new Error("تعذر حفظ جلسة الدعم على هذا الجهاز.");
  try { return window.localStorage; } catch { throw new Error("فعّل تخزين المتصفح للحفاظ على المحادثة."); }
}
let opening: Promise<string> | null = null;
export const guestSupportClient = {
  anonymous() { return request<{ guestSupportToken: string; ticketCode: string; nextStep: "guest_support"; expiresInSeconds: number }>("/api/guest-support/anonymous", { method: "POST" }); },
  start(input: { displayName: string; email?: string; phone?: string }) { return request<{ ticketCode: string; challengeId: string; expiresInSeconds: number }>("/api/guest-support/start", { method: "POST", body: JSON.stringify(input) }); },
  verify(input: { ticketCode: string; challengeId: string; code: string }) { return request<{ guestSupportToken: string; ticketCode: string; nextStep: "guest_support"; expiresInSeconds: number }>("/api/guest-support/verify", { method: "POST", body: JSON.stringify(input) }); },
  messages(token: string) { return request<GuestConversation>("/api/guest-support/messages", {}, token); },
  send(token: string, input: { body: string; attachment?: GuestAttachment; operationId?: string }) { return request<{ sent: true; messageId: number }>("/api/guest-support/messages", { method: "POST", body: JSON.stringify(input) }, token); },
  async loadToken() { return Platform.OS === "web" ? webStorage().getItem(TOKEN_KEY) : SecureStore.getItemAsync(TOKEN_KEY); },
  async saveToken(token: string) { if (Platform.OS === "web") webStorage().setItem(TOKEN_KEY, token); else await SecureStore.setItemAsync(TOKEN_KEY, token); },
  async clearToken() { if (Platform.OS === "web") webStorage().removeItem(TOKEN_KEY); else await SecureStore.deleteItemAsync(TOKEN_KEY); },
  open(): Promise<string> {
    if (!opening) opening = (async () => {
      const saved = await guestSupportClient.loadToken();
      if (saved) return saved;
      const created = await guestSupportClient.anonymous();
      await guestSupportClient.saveToken(created.guestSupportToken);
      return created.guestSupportToken;
    })().finally(() => { opening = null; });
    return opening;
  },
};
