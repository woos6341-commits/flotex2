import { useState } from "react";
import { Image, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { ActionButton } from "@/components/atheer-ui";
import { compressImageForUpload } from "@/lib/image-compression";
import type { GuestAttachment } from "@/lib/guest-support-client";

type PickedAttachment = GuestAttachment & { uri?: string };
export function useGuestSupportAttachment() {
  const [attachment, setAttachment] = useState<PickedAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  async function pickImage() {
    setAttachmentError("");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("اسمح بالوصول إلى الصور لإرفاق صورة.");
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, base64: false, quality: 0.75 });
      if (!result.canceled && result.assets?.[0]) setAttachment(await compressImageForUpload(result.assets[0]));
    } catch (reason) { setAttachmentError(reason instanceof Error ? reason.message : "تعذر تجهيز الصورة."); }
  }
  async function pickPdf() {
    setAttachmentError("");
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true, base64: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if ((asset.size ?? 0) > 2 * 1024 * 1024) throw new Error("يجب ألا يتجاوز حجم المرفق 2 ميجابايت.");
      const data = Platform.OS === "web" ? (asset.base64 ?? "").replace(/^data:[^,]*,/, "") : await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!data || data.length > Math.ceil(2 * 1024 * 1024 / 3) * 4) throw new Error("تعذر قراءة الملف أو حجمه أكبر من المسموح.");
      setAttachment({ data, mimeType: "application/pdf", uri: asset.uri });
    } catch (reason) { setAttachmentError(reason instanceof Error ? reason.message : "تعذر تجهيز الملف."); }
  }
  return { attachment, setAttachment, attachmentError, setAttachmentError, pickImage, pickPdf };
}

export function GuestSupportAttachmentPicker({ picker, disabled = false }: { picker: ReturnType<typeof useGuestSupportAttachment>; disabled?: boolean }) {
  return <View>
    {picker.attachment ? <View className="mt-3 flex-row items-center justify-between"><Text className="text-xs text-[#D6C79E]">{picker.attachment.mimeType === "application/pdf" ? "ملف PDF جاهز للإرسال" : "صورة جاهزة للإرسال"}</Text><Pressable accessibilityRole="button" onPress={() => picker.setAttachment(null)}><Text className="text-xs text-[#FF9BA7]">حذف المرفق</Text></Pressable></View> : null}
    {picker.attachmentError ? <Text className="mt-2 text-xs text-[#FF9BA7]" style={{ textAlign: "right" }}>{picker.attachmentError}</Text> : null}
    <View className="mt-3 flex-row gap-2"><View className="flex-1"><ActionButton label="إرفاق صورة" icon="image-outline" secondary onPress={() => { if (!disabled) void picker.pickImage(); }} /></View><View className="flex-1"><ActionButton label="إرفاق PDF" icon="document-outline" secondary onPress={() => { if (!disabled) void picker.pickPdf(); }} /></View></View>
  </View>;
}

export function GuestSupportAttachmentView({ attachment }: { attachment: { data: string; mimeType: string } }) {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const image = attachment.mimeType === "image/jpeg" || attachment.mimeType === "image/png";
  const uri = `data:${attachment.mimeType};base64,${attachment.data}`;
  async function openPdf() {
    setError("");
    try {
      if (attachment.mimeType !== "application/pdf") throw new Error("نوع المرفق غير مدعوم.");
      if (Platform.OS === "web") {
        const binary = atob(attachment.data);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        // Some browsers return null for noopener even when opening succeeded.
        void opened;
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        if (!FileSystem.cacheDirectory) throw new Error("لا توجد مساحة مؤقتة لفتح المرفق.");
        const path = `${FileSystem.cacheDirectory}guest-support-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
        await FileSystem.writeAsStringAsync(path, attachment.data, { encoding: FileSystem.EncodingType.Base64 });
        if (Platform.OS === "android") {
          const contentUri = await FileSystem.getContentUriAsync(path);
          await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data: contentUri, flags: 1, type: "application/pdf" });
        } else await Linking.openURL(path);
      }
    } catch { setError("تعذر فتح الملف. تأكد من وجود تطبيق لعرض PDF على جهازك."); }
  }
  if (image) return <>
    <Pressable accessibilityRole="button" accessibilityLabel="فتح الصورة" onPress={() => setVisible(true)}><Image source={{ uri }} resizeMode="contain" style={{ width: 230, height: 150, marginTop: 10, borderRadius: 14, backgroundColor: "#0B1018" }} /></Pressable>
    <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setVisible(false)}><Pressable accessibilityRole="button" accessibilityLabel="إغلاق معاينة الصورة" onPress={() => setVisible(false)} style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.92)" }}><Image source={{ uri }} resizeMode="contain" style={{ width: "100%", height: "82%" }} /><Text className="mt-3 text-xs text-[#F7F1E3]">اضغط للإغلاق</Text></Pressable></Modal>
  </>;
  return <View><Pressable accessibilityRole="button" onPress={() => void openPdf()}><Text className="mt-2 text-sm text-[#D7B75E]">فتح المرفق PDF</Text></Pressable>{error ? <Text className="mt-2 text-xs text-[#FF9BA7]">{error}</Text> : null}</View>;
}
