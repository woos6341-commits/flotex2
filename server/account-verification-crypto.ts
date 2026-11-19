import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export const MAX_ACCOUNT_VERIFICATION_IMAGE_BYTES = 2 * 1024 * 1024;
export type VerificationImageInput = { mimeType: "image/jpeg" | "image/png"; data: string };

function deriveKey(purpose: "documents" | "fingerprints"): Buffer {
  const configured = process.env.KYC_DOCUMENT_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("إعداد KYC_DOCUMENT_ENCRYPTION_KEY مفقود على الخادم");

  let rootKey: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(configured)) {
    rootKey = Buffer.from(configured, "hex");
  } else {
    const decodedBase64 = Buffer.from(configured, "base64");
    const canonicalBase64 = decodedBase64.toString("base64") === configured && decodedBase64.length >= 32;
    rootKey = canonicalBase64 ? decodedBase64 : Buffer.from(configured, "utf8");
  }

  if (rootKey.length < 32) throw new Error("يجب أن يحتوي KYC_DOCUMENT_ENCRYPTION_KEY على 32 بايت على الأقل");
  return Buffer.from(hkdfSync("sha256", rootKey, "flotex-account-verification-v2", `account-verification:${purpose}`, 32));
}

export function decodeAccountVerificationImage(input: VerificationImageInput): Buffer {
  if (!input || (input.mimeType !== "image/jpeg" && input.mimeType !== "image/png") || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) {
    throw new Error("اختر صورة JPEG أو PNG صالحة للتوثيق");
  }
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > MAX_ACCOUNT_VERIFICATION_IMAGE_BYTES) throw new Error("يجب ألا يتجاوز حجم كل صورة توثيق 2 ميجابايت");
  if (bytes.toString("base64") !== input.data) throw new Error("ترميز الصورة غير صالح");
  const validJpeg = input.mimeType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const validPng = input.mimeType === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(pngSignature);
  if (!validJpeg && !validPng) throw new Error("محتوى الملف لا يطابق صيغة الصورة المختارة");
  return bytes;
}

export function encryptAccountVerificationDocument(plainBytes: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("documents"), iv);
  const ciphertext = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  return Buffer.concat([Buffer.from("KYC2"), iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptAccountVerificationDocument(encoded: string): Buffer {
  const packet = Buffer.from(encoded, "base64");
  if (packet.subarray(0, 4).toString() !== "KYC2" || packet.length < 32) throw new Error("مستند التوثيق المحفوظ غير صالح");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("documents"), packet.subarray(4, 16));
  decipher.setAuthTag(packet.subarray(16, 32));
  return Buffer.concat([decipher.update(packet.subarray(32)), decipher.final()]);
}

export function fingerprintAccountVerificationValue(namespace: string, value: string | Buffer): string {
  return createHmac("sha256", deriveKey("fingerprints"))
    .update(namespace)
    .update("\0")
    .update(value)
    .digest("hex");
}
