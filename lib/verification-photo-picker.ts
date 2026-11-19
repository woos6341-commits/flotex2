import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { AppState, Platform } from "react-native";
import { compressImageForUpload } from "./image-compression";

export const VERIFICATION_PHOTO_KEYS = ["idFront", "idBack", "selfie", "walletProfile"] as const;
export type VerificationPhotoKey = (typeof VERIFICATION_PHOTO_KEYS)[number];
export type VerificationPhoto = Awaited<ReturnType<typeof compressImageForUpload>>;
export type VerificationPhotoScope = "account" | "phone";
const PENDING_KEY = "flotex:pending-verification-camera:v1";
const TTL = 20 * 60 * 1000;
const RECOVERY_ATTEMPTS = 16;
const RECOVERY_DELAY_MS = 200;
type Pending = { userId: number; scope: VerificationPhotoScope; key: VerificationPhotoKey; at: number };
type RecoveredPhoto = { key: VerificationPhotoKey; photo: VerificationPhoto };
const recoveryPromises = new Map<string, Promise<RecoveredPhoto | null>>();

// Only camera routing metadata is persisted, NEVER the photos or base64 payloads.
async function readPending(): Promise<Pending | null> {
  try {
    const value = await AsyncStorage.getItem(PENDING_KEY);
    if (!value) return null;
    const pending = JSON.parse(value) as Pending;
    if (!Number.isInteger(pending.userId) || !["account", "phone"].includes(pending.scope) ||
      !VERIFICATION_PHOTO_KEYS.includes(pending.key) || !Number.isFinite(pending.at) || Date.now() - pending.at > TTL) {
      await AsyncStorage.removeItem(PENDING_KEY);
      return null;
    }
    return pending;
  } catch { return null; }
}

export async function getPendingVerificationRoute(userId: number): Promise<"/account-verification" | "/change-phone" | null> {
  if (Platform.OS !== "android") return null;
  const pending = await readPending();
  return pending?.userId === userId ? pending.scope === "account" ? "/account-verification" : "/change-phone" : null;
}

async function prepare(asset: ImagePicker.ImagePickerAsset): Promise<VerificationPhoto> {
  const compressed = await compressImageForUpload(asset);
  if (compressed.width < 300 || compressed.height < 300) throw new Error("دقة الصورة منخفضة؛ التقط صورة أوضح وأكبر حتى يمكن مراجعتها.");
  return compressed;
}

export async function pickVerificationPhoto(scope: VerificationPhotoScope, userId: number, key: VerificationPhotoKey): Promise<VerificationPhoto | null> {
  const camera = key !== "walletProfile";
  if (Platform.OS !== "web") {
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error(camera ? "اسمح باستخدام الكاميرا لإكمال طلب التوثيق." : "اسمح بالوصول إلى الصور لاختيار صورة المحفظة.");
    // Keep only a short-lived route marker so Android can restore the exact field if its Activity is recreated.
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ userId, scope, key, at: Date.now() } satisfies Pending)).catch(() => undefined);
  }

  let appWasBackgrounded = false;
  let keepPendingMarker = false;
  const appStateSubscription = Platform.OS === "android"
    ? AppState.addEventListener("change", (state) => { if (state !== "active") appWasBackgrounded = true; })
    : null;
  try {
    // On web do not await storage/permission work before launching: user activation must remain valid.
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: false, base64: false, exif: false, quality: 0.7 };
    const result = camera
      ? await ImagePicker.launchCameraAsync({ ...options, cameraType: key === "selfie" ? ImagePicker.CameraType.front : ImagePicker.CameraType.back })
      : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.assets?.[0];
    if (result.canceled || !asset) {
      // Android can recreate MainActivity while the camera is open. In that case a canceled/empty
      // launch promise may arrive before Expo exposes its pending activity result; retry and preserve
      // only the routing marker if the image result is still pending.
      if (Platform.OS === "android" && appWasBackgrounded) {
        // Android may resolve the camera promise before Expo publishes the
        // pending activity result. Keep the marker and retry through the
        // same recovery path instead of treating the capture as cancelled.
        const recovered = await recoverVerificationPhoto(scope, userId);
        if (recovered) return recovered.photo;
        keepPendingMarker = Boolean(await readPending());
      }
      return null;
    }
    return await prepare(asset);
  } finally {
    appStateSubscription?.remove();
    if (Platform.OS !== "web" && !keepPendingMarker) await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
  }
}

export function recoverVerificationPhoto(scope: VerificationPhotoScope, userId: number): Promise<RecoveredPhoto | null> {
  if (Platform.OS !== "android") return Promise.resolve(null);
  const identity = `${scope}:${userId}`;
  const existing = recoveryPromises.get(identity);
  if (existing) return existing;
  let tracked: Promise<RecoveredPhoto | null>;
  tracked = recoverPendingVerificationPhoto(scope, userId).finally(() => {
    if (recoveryPromises.get(identity) === tracked) recoveryPromises.delete(identity);
  });
  recoveryPromises.set(identity, tracked);
  return tracked;
}

async function recoverPendingVerificationPhoto(scope: VerificationPhotoScope, userId: number): Promise<RecoveredPhoto | null> {
  const pending = await readPending();
  if (!pending || pending.scope !== scope || pending.userId !== userId) return null;
  for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
    const result = await ImagePicker.getPendingResultAsync();
    if (result) {
      if ("code" in result) {
        await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
        throw new Error("تعذر استعادة صورة الكاميرا. أعد التقاط الصورة؛ حسابك ما زال مسجلًا.");
      }
      if (result.canceled || !result.assets?.[0]) {
        await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
        return null;
      }
      const photo = await prepare(result.assets[0]);
      await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
      return { key: pending.key, photo };
    }
    if (attempt < RECOVERY_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, RECOVERY_DELAY_MS));
  }
  // Keep the short-lived route marker; Android can deliver the pending result after Activity restoration.
  return null;
}

export async function removeLegacyVerificationDrafts(): Promise<void> {
  // Older releases persisted unencrypted base64, exceeding AsyncStorage's per-row/quota limits.
  // Remove those drafts without reading/allocating them; actual submitted encrypted documents are untouched.
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("flotex:account-verification-draft:"));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch { /* unavailable storage must never crash the account screen */ }
}

export async function clearVerificationPhotoDrafts(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
  await removeLegacyVerificationDrafts();
}
