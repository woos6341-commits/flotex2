import * as Application from "expo-application";
import Constants from "expo-constants";
import { useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { trpc } from "@/lib/trpc";
import { decideAndroidUpdateGate } from "@/shared/app-updates";

const APP_BRAND = "فولتكس إيجيبت – Flotex EGP";
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const INSTALL_PACKAGE_ACTION = "android.intent.action.INSTALL_PACKAGE";
const UNKNOWN_SOURCES_SETTINGS_ACTION = "android.settings.MANAGE_UNKNOWN_APP_SOURCES";

export function AppUpdateGate() {
  const configuredPackage = Constants.expoConfig?.extra?.androidApplicationId;
  const isStandaloneAndroid = Platform.OS === "android"
    && Boolean(configuredPackage)
    && Application.applicationId === configuredPackage;
  const deferredVersion = null;
  const [updateError, setUpdateError] = useState("");
  const [updateMessage, setUpdateMessage] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isPreparingUpdate, setIsPreparingUpdate] = useState(false);
  const policyQuery = trpc.appUpdates.androidPolicy.useQuery(undefined, {
    enabled: isStandaloneAndroid,
    retry: 1,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const downloadUrlMutation = trpc.appUpdates.androidDownloadUrl.useMutation();

  const installedVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0";
  const installedBuildNumber = Number(Application.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? 0) || 0;
  const decision = decideAndroidUpdateGate({
    platform: Platform.OS,
    applicationIdMatches: isStandaloneAndroid,
    policyReady: policyQuery.isSuccess,
    installedVersion,
    installedBuildNumber,
    policy: policyQuery.data,
    deferredVersion,
  });
  const policy = policyQuery.data;
  if (!decision.visible || !policy) return null;

  const confirmUpdate = async () => {
    if (Platform.OS !== "android" || !isStandaloneAndroid || isPreparingUpdate) return;

    setIsPreparingUpdate(true);
    setUpdateError("");
    setUpdateMessage("جارٍ التحقق من الإصدار وتجهيز التنزيل…");
    setDownloadProgress(null);

    try {
      // Request a fresh signed URL only after the user confirms the update.
      const download = await downloadUrlMutation.mutateAsync({ version: policy.version });
      const { File, Paths } = await import("expo-file-system");
      const destination = new File(Paths.cache, "flotex-egp-update.apk");
      if (destination.exists) destination.delete();

      setUpdateMessage("جارٍ تنزيل ملف التحديث…");
      const task = File.createDownloadTask(download.url, destination, {
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) {
            const percent = Math.min(100, Math.round((bytesWritten / totalBytes) * 100));
            setDownloadProgress(percent);
            setUpdateMessage(`جارٍ تنزيل ملف التحديث… ${percent}%`);
          } else {
            setDownloadProgress(null);
            setUpdateMessage(`جارٍ تنزيل ملف التحديث… (${(bytesWritten / (1024 * 1024)).toFixed(1)} م.ب)`);
          }
        },
      });
      const downloadedFile = await task.downloadAsync();
      if (!downloadedFile) throw new Error("APK download did not produce a file");

      setDownloadProgress(100);
      setUpdateMessage("اكتمل التنزيل. جارٍ فتح مثبت Android لتأكيد التثبيت…");
      const intentLauncher = await import("expo-intent-launcher");
      try {
        await intentLauncher.startActivityAsync(INSTALL_PACKAGE_ACTION, {
          data: downloadedFile.contentUri,
          type: APK_MIME_TYPE,
          flags: FLAG_GRANT_READ_URI_PERMISSION,
        });
        setUpdateMessage("عاد التطبيق من نافذة Android. إذا لم يكتمل التثبيت، اضغط «تحديث الآن» مجددًا.");
      } catch {
        try {
          await intentLauncher.startActivityAsync(UNKNOWN_SOURCES_SETTINGS_ACTION, {
            data: `package:${Application.applicationId}`,
          });
          setUpdateError("اسمح للتطبيق بالتثبيت من هذا المصدر في إعدادات Android، ثم عُد واضغط «تحديث الآن» مرة أخرى.");
        } catch {
          setUpdateError("تعذر فتح إعدادات السماح بالتثبيت. افتح إعدادات Android وفعّل السماح لهذا التطبيق، ثم حاول مرة أخرى.");
        }
        setUpdateMessage("");
      }
    } catch {
      setUpdateError("تعذر تنزيل ملف التحديث. تحقق من اتصال الإنترنت وأعد المحاولة.");
      setUpdateMessage("");
    } finally {
      setIsPreparingUpdate(false);
    }
  };

  return (
    <Modal
      visible={decision.visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => undefined}
    >
      <View className="flex-1 items-center justify-center bg-black/80 px-5 py-8">
        <View className="w-full max-w-md rounded-3xl border border-[#5C4A28] bg-[#121B28] p-5">
          <View className="mb-4 h-12 w-12 items-center justify-center rounded-2xl bg-[#D7A94822]">
            <Text className="text-2xl font-black text-[#D7A948]">F</Text>
          </View>
          <Text className="text-right text-xl font-extrabold leading-8 text-[#F7F1E3]">
            يتوفر إصدار جديد من تطبيق {APP_BRAND}. يرجى تحديث التطبيق للمتابعة
          </Text>
          <Text className="mt-2 text-right text-sm text-[#9BA8B8]">
            الإصدار المثبت {installedVersion} · الإصدار المتاح {policy.version}
          </Text>
          {policy.releaseNotes ? (
            <View className="mt-4 rounded-2xl border border-[#273548] bg-[#0B1018] p-4">
              <Text className="mb-1 text-right text-xs font-bold text-[#D7A948]">ملاحظات التحديث</Text>
              <Text className="text-right text-sm leading-6 text-[#D9E0EA]">{policy.releaseNotes}</Text>
            </View>
          ) : null}
          {updateMessage ? <Text className="mt-3 text-right text-sm text-[#D9E0EA]">{updateMessage}</Text> : null}
          {downloadProgress !== null && isPreparingUpdate ? (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: downloadProgress }}
              className="mt-2 h-2 overflow-hidden rounded-full bg-[#273548]"
            >
              <View className="h-full rounded-full bg-[#D7A948]" style={{ width: `${downloadProgress}%` }} />
            </View>
          ) : null}
          {updateError ? <Text className="mt-3 text-right text-sm text-[#FF7D8D]">{updateError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={isPreparingUpdate}
            onPress={confirmUpdate}
            className={`mt-5 items-center rounded-2xl bg-[#D7A948] px-4 py-3.5 ${isPreparingUpdate ? "opacity-60" : ""}`}
          >
            <Text className="font-bold text-[#0B1018]">
              {isPreparingUpdate ? "جارٍ تجهيز التحديث…" : "تحديث الآن"}
            </Text>
          </Pressable>
          <Text className="mt-3 text-center text-xs leading-5 text-[#9BA8B8]">
            هذا التحديث إلزامي. إذا طلب Android السماح بالتثبيت من هذا المصدر، فعّل السماح ثم عُد واضغط «تحديث الآن».
          </Text>
        </View>
      </View>
    </Modal>
  );
}
