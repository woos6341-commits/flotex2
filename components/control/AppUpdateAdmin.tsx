import { useState } from "react";
import { ActivityIndicator, Platform, Switch, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File, UploadType } from "expo-file-system";
import { ActionButton, Card } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { isAndroidApkFileName, isAndroidApkMimeType, isReleaseVersion, MAX_ANDROID_APK_SIZE_BYTES, type AndroidUpdatePolicy } from "@/shared/app-updates";
const EMPTY_POLICY: AndroidUpdatePolicy = {
  enabled: false,
  version: "",
  buildNumber: 0,
  downloadUrl: "",
  storageKey: "",
  releaseNotes: "",
  mandatory: false,
};

export function AppUpdateAdmin() {
  const policyQuery = trpc.admin.androidUpdatePolicy.useQuery(undefined, { refetchOnMount: "always" });
  const savePolicy = trpc.admin.updateAndroidUpdatePolicy.useMutation();
  const requestUploadUrl = trpc.admin.androidUpdateUploadUrl.useMutation();
  const utils = trpc.useUtils();
  const [overrides, setOverrides] = useState<Partial<AndroidUpdatePolicy>>({});
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const draft: AndroidUpdatePolicy = { ...EMPTY_POLICY, ...policyQuery.data, ...overrides };

  const save = () => {
    setFeedback(null);
    if (uploading) {
      setFeedback({ tone: "error", text: "انتظر اكتمال رفع ملف APK قبل حفظ السياسة." });
      return;
    }
    if (policyQuery.isError || !policyQuery.data) {
      setFeedback({ tone: "error", text: "تعذر تحميل الإعداد الحالي؛ لم يتم الحفظ." });
      return;
    }
    if (draft.enabled && !isReleaseVersion(draft.version)) {
      setFeedback({ tone: "error", text: "أدخل رقم إصدار من ثلاثة أجزاء، مثل 1.0.1." });
      return;
    }
    if (draft.enabled && (!Number.isSafeInteger(draft.buildNumber) || draft.buildNumber < 1)) {
      setFeedback({ tone: "error", text: "أدخل رقم بناء Android موجبًا وأكبر من رقم البناء السابق." });
      return;
    }
    if (draft.enabled && !draft.storageKey) {
      setFeedback({ tone: "error", text: "ارفع ملف APK لهذا الإصدار قبل تفعيل السياسة." });
      return;
    }
    if (draft.releaseNotes.length > 4000) {
      setFeedback({ tone: "error", text: "ملاحظات الإصدار أطول من الحد المسموح." });
      return;
    }
    savePolicy.mutate({
      enabled: draft.enabled,
      version: draft.version,
      buildNumber: draft.buildNumber,
      storageKey: draft.storageKey ?? "",
      releaseNotes: draft.releaseNotes,
      mandatory: draft.enabled,
    }, {
      onSuccess: async () => {
        setOverrides({});
        setFeedback({ tone: "success", text: "حُفظت سياسة تحديث Android على الخادم." });
        await utils.admin.androidUpdatePolicy.invalidate();
        await utils.appUpdates.androidPolicy.invalidate();
        await policyQuery.refetch();
      },
      onError: () => setFeedback({ tone: "error", text: "تعذر حفظ سياسة التحديث." }),
    });
  };

  const chooseAndUploadApk = async () => {
    if (uploading) return;
    setFeedback(null);
    if (!isReleaseVersion(draft.version)) {
      setFeedback({ tone: "error", text: "أدخل رقم إصدار صالحًا من ثلاثة أجزاء قبل رفع APK." });
      return;
    }
    if (!Number.isSafeInteger(draft.buildNumber) || draft.buildNumber < 1) {
      setFeedback({ tone: "error", text: "أدخل رقم بناء Android موجبًا قبل رفع APK." });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset || !isAndroidApkFileName(asset.name) || !isAndroidApkMimeType(asset.mimeType)) {
        setFeedback({ tone: "error", text: "اختر ملف APK صالحًا فقط." });
        return;
      }

      const nativeFile = Platform.OS === "web" ? null : new File(asset.uri);
      const webBlob = Platform.OS === "web"
        ? asset.file ?? await (await fetch(asset.uri)).blob()
        : null;
      const nativeSize = nativeFile?.size ?? 0;
      const fileSize = Platform.OS === "web" ? webBlob!.size : (nativeSize > 0 ? nativeSize : asset.size);
      if (typeof fileSize !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
        setFeedback({ tone: "error", text: "تعذر التحقق من حجم الملف المحدد." });
        return;
      }
      if (fileSize > MAX_ANDROID_APK_SIZE_BYTES) {
        setFeedback({ tone: "error", text: "حجم ملف APK يتجاوز الحد الأقصى البالغ 200 MiB." });
        return;
      }

      const uploadTarget = await requestUploadUrl.mutateAsync({
        version: draft.version.trim(),
        buildNumber: draft.buildNumber,
        fileName: asset.name,
        fileSize,
      });

      if (Platform.OS === "web") {
        const response = await fetch(uploadTarget.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": uploadTarget.contentType },
          body: webBlob!,
        });
        if (!response.ok) throw new Error("upload-failed");
        setUploadProgress(100);
      } else {
        const task = nativeFile!.createUploadTask(uploadTarget.uploadUrl, {
          httpMethod: "PUT",
          uploadType: UploadType.BINARY_CONTENT,
          headers: { "Content-Type": uploadTarget.contentType },
          onProgress: ({ bytesSent, totalBytes }) => {
            if (totalBytes > 0) setUploadProgress(Math.min(100, Math.round((bytesSent / totalBytes) * 100)));
          },
        });
        const response = await task.uploadAsync();
        if (!response || response.status < 200 || response.status >= 300) throw new Error("upload-failed");
      }

      setOverrides((current) => ({ ...current, storageKey: uploadTarget.key }));
      setUploadedFileName(asset.name);
      setFeedback({ tone: "success", text: "اكتمل رفع APK. راجع الإعدادات ثم احفظ سياسة التحديث يدويًا." });
    } catch {
      setFeedback({ tone: "error", text: "تعذر رفع ملف APK. تحقق من الملف والاتصال ثم حاول مرة أخرى." });
    } finally {
      setUploading(false);
    }
  };

  const field = (label: string, value: string, onChangeText: (value: string) => void, placeholder: string, options: { multiline?: boolean; keyboardType?: "default" | "url" | "number-pad" } = {}) => (
    <View className="mt-3">
      <Text className="mb-1 text-right text-xs text-[#9BA8B8]">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#657286"
        autoCapitalize="none"
        keyboardType={options.keyboardType ?? "default"}
        multiline={options.multiline}
        textAlignVertical={options.multiline ? "top" : "center"}
        style={options.multiline ? { minHeight: 112 } : undefined}
        className="rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]"
      />
    </View>
  );

  return (
    <Card className="mb-4">
      <Text className="text-lg font-bold text-[#F7F1E3]">تحديث تطبيق Android</Text>
      <Text className="mt-1 text-right text-xs leading-5 text-[#9BA8B8]">
        عند تفعيل السياسة، يفحص تطبيق Android الإصدار تلقائيًا عند الفتح. ارفع ملف APK هنا، ثم احفظ السياسة بشكل منفصل.
      </Text>
      {feedback ? <Text className={`mt-3 text-right text-sm ${feedback.tone === "error" ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`}>{feedback.text}</Text> : null}
      {policyQuery.isLoading ? <ActivityIndicator className="mt-5" color="#D7A948" /> : <>
        <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3">
          <Text className="flex-1 text-right text-sm font-semibold text-[#F7F1E3]">تفعيل فحص الإصدار على Android</Text>
          <Switch value={draft.enabled} onValueChange={(enabled) => setOverrides((current) => ({ ...current, enabled }))} trackColor={{ false: "#273548", true: "#8B713A" }} thumbColor={draft.enabled ? "#D7A948" : "#9BA8B8"} />
        </View>
        {field("رقم الإصدار المتاح", draft.version, (version) => {
          setOverrides((current) => version === draft.version ? { ...current, version } : { ...current, version, storageKey: "" });
          if (version !== draft.version) setUploadedFileName(null);
        }, "مثال: 1.0.1")}
        {field("رقم بناء Android", draft.buildNumber ? String(draft.buildNumber) : "", (value) => {
          const buildNumber = value.replace(/\D/g, "");
          setOverrides((current) => ({ ...current, buildNumber: buildNumber ? Number(buildNumber) : 0, storageKey: "" }));
          setUploadedFileName(null);
        }, "مثال: 101", { keyboardType: "number-pad" })}
        <View className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-4">
          <Text className="mb-2 text-right text-xs text-[#9BA8B8]">ملف APK (حتى 200 MiB)</Text>
          <ActionButton
            label={uploading ? "جارٍ رفع ملف APK" : uploadedFileName ? "اختيار ملف APK آخر" : "اختيار ورفع ملف APK"}
            icon={uploading ? "cloud-upload-outline" : "document-attach-outline"}
            onPress={chooseAndUploadApk}
          />
          {uploading && uploadProgress !== null ? <Text className="mt-2 text-right text-xs text-[#D7A948]">تقدم الرفع: {uploadProgress}%</Text> : null}
          {uploadedFileName ? <Text className="mt-2 text-right text-xs text-[#47D7A5]">الملف المرفوع: {uploadedFileName}</Text> : null}
          <Text className="mt-2 text-right text-xs leading-5 text-[#9BA8B8]">
            بعد اكتمال الرفع، اضغط «حفظ سياسة التحديث» لحفظ الإصدار وملاحظاته وخيار الإلزام. لن تُفعّل السياسة تلقائيًا بسبب الرفع.
          </Text>
        </View>
        {field("ملاحظات التحديث", draft.releaseNotes, (releaseNotes) => setOverrides((current) => ({ ...current, releaseNotes })), "اكتب ما تغيّر في هذا الإصدار", { multiline: true })}
        <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3">
          <Text className="flex-1 text-right text-sm font-semibold text-[#F7F1E3]">تحديث إجباري (يحجب النسخ الأقدم)</Text>
          <Switch value={draft.enabled} disabled trackColor={{ false: "#273548", true: "#8B713A" }} thumbColor={draft.enabled ? "#D7A948" : "#9BA8B8"} />
        </View>
        <Text className="mt-3 text-right text-xs leading-5 text-[#D7A948]">
          اختبر ملف APK الصحيح الموقّع قبل الحفظ. يجب أن يستخدم كل إصدار لاحق معرّف الحزمة ومفتاح التوقيع نفسيهما، مع زيادة رقم البناء.
        </Text>
        <View className="mt-4"><ActionButton label={savePolicy.isPending ? "جارٍ الحفظ" : "حفظ سياسة التحديث"} icon="save-outline" onPress={save} /></View>
      </>}
    </Card>
  );
}
