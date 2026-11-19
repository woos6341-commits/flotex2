import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { ENV } from "./_core/env";
import { storagePut, storageGetSignedUrl } from "./storage";

export function decodePaymentImage(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("اختر صورة JPEG أو PNG أو WebP صالحة");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("حجم الصورة يجب ألا يتجاوز 8 ميجابايت");
  const valid = match[1] === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP";
  if (!valid) throw new Error("محتوى الملف لا يطابق صيغة الصورة");
  return { bytes, mime: match[1] };
}
function encryptionKey() {
  const secret = process.env.PAYMENT_RECEIPT_SECRET || ENV.cookieSecret;
  if (!secret) throw new Error("تشفير إيصالات التحويل غير مهيأ على الخادم");
  return Buffer.from(hkdfSync("sha256", secret, "atheer-receipt-v1", "private-payment-receipts", 32));
}
export function encryptReceipt(dataUrl: string) {
  decodePaymentImage(dataUrl);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload = Buffer.concat([cipher.update(dataUrl, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("ATH1"), iv, cipher.getAuthTag(), payload]);
}
export function decryptReceipt(bytes: Buffer) {
  if (bytes.subarray(0,4).toString() !== "ATH1") throw new Error("الإيصال المحفوظ غير صالح");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(4,16));
  decipher.setAuthTag(bytes.subarray(16,32));
  return Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]).toString("utf8");
}
export async function saveReceipt(userId: number, dataUrl: string) {
  const uploaded = await storagePut(`private-receipts/${userId}/${randomUUID()}.enc`, encryptReceipt(dataUrl), "application/octet-stream");
  return uploaded.url;
}
export async function readReceipt(storedPath: string) {
  if (!storedPath.startsWith("/manus-storage/private-receipts/")) throw new Error("الإيصال غير متاح من التخزين الخاص");
  const url = await storageGetSignedUrl(storedPath.slice("/manus-storage/".length));
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("تعذر تحميل إيصال التحويل، حاول مرة أخرى");
  return { dataUrl: decryptReceipt(Buffer.from(await response.arrayBuffer())) };
}
export async function saveMethodImage(id: string, dataUrl: string) {
  const image = decodePaymentImage(dataUrl);
  const extension = image.mime.split("/")[1];
  return (await storagePut(`payment-methods/${id}/${randomUUID()}.${extension}`, image.bytes, image.mime)).url;
}
