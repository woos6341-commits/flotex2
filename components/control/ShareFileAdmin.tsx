import { useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ActionButton, Card } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";

export function ShareFileAdmin() {
  const upload = trpc.admin.uploadShareFile.useMutation();
  const [fileName, setFileName] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const chooseAndUpload = async () => {
    if (upload.isPending) return;
    setFeedback(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: false, copyToCacheDirectory: true, base64: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      let data = (asset.base64 ?? "").replace(/^data:[^,]*,/, "");
      if (!data) {
        if (Platform.OS === "web") {
          const file = asset.file ?? await (await fetch(asset.uri)).blob();
          data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
            reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
            reader.readAsDataURL(file);
          });
        } else {
          data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        }
      }
      if (!data) throw new Error("الملف فارغ أو تعذرت قراءته.");
      const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
      const mimeType = allowedMimeTypes.includes(asset.mimeType as (typeof allowedMimeTypes)[number]) ? asset.mimeType as (typeof allowedMimeTypes)[number] : null;
      if (!mimeType) throw new Error("نوع الملف غير مدعوم. استخدم PDF أو PNG أو JPG أو WEBP.");
      await upload.mutateAsync({ fileName: asset.name, mimeType, data });
      setFileName(asset.name);
      setFeedback({ ok: true, text: "تم رفع ملف المشاركة وحفظه بنجاح." });
    } catch (error) {
      setFeedback({ ok: false, text: error instanceof Error ? error.message : "تعذر رفع ملف المشاركة." });
    }
  };

  return <Card className="mb-4">
    <Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>ملف المشاركة</Text>
    <Text className="mt-1 text-right text-xs leading-5 text-[#9BA8B8]">ارفع الملف الذي سيظهر للعملاء عند الضغط على «مشاركة». يمكن استبداله في أي وقت.</Text>
    {fileName ? <Text className="mt-3 text-right text-sm font-semibold text-[#D7A948]">الملف الحالي: {fileName}</Text> : null}
    {feedback ? <Text className={`mt-3 text-right text-xs ${feedback.ok ? "text-[#47D7A5]" : "text-[#FF7D8D]"}`}>{feedback.text}</Text> : null}
    <View className="mt-4"><ActionButton label={upload.isPending ? "جارٍ الرفع..." : "اختيار ورفع ملف"} icon="cloud-upload-outline" onPress={() => { void chooseAndUpload(); }} /></View>
    {upload.isPending ? <ActivityIndicator className="mt-3" color="#D7A948" /> : null}
  </Card>;
}
