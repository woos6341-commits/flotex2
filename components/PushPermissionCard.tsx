import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { getExpoProjectId, isExpoGo, usePushNotifications } from "@/hooks/use-push-notifications";
import { getPushRegistrationFailureMessage } from "@/shared/push-registration-error";

type PermissionState = { granted: boolean; canAskAgain: boolean };

export function PushPermissionCard() {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [message, setMessage] = useState("");
  const { registerDevice, isPending } = usePushNotifications();
  const projectIdMissing = !getExpoProjectId();
  let setupMessage = "";

  useEffect(() => {
    let active = true;
    if (Platform.OS === "web") return () => { active = false; };
    void Notifications.getPermissionsAsync().then((current) => {
      if (active) setPermission({ granted: current.granted, canAskAgain: current.canAskAgain });
    }).catch(() => {
      if (active) setPermission(null);
    });
    return () => { active = false; };
  }, []);

  if (Platform.OS === "web") {
    setupMessage = "هذه معاينة ويب؛ المتصفح لا يصدر رمز Push للهاتف. يلزم تطبيق هاتف مُثبت لاختبار الإشعارات الحقيقية.";
  } else if (isExpoGo()) {
    setupMessage = "هذه النسخة تعمل داخل Expo Go. لا يدعم Expo Go الإشعارات البعيدة منذ SDK 53؛ يلزم Development Build."
      + (projectIdMissing ? " كما أن Expo/EAS Project ID غير مضبوط لهذا المشروع." : "");
  } else if (projectIdMissing) {
    setupMessage = "لم يُربط التطبيق بمعرّف Expo/EAS Project ID. يلزم إعداد المعرف واعتمادات FCM المطابقة ثم إنشاء Development Build جديد.";
  }

  const enable = async () => {
    setMessage("");
    if (setupMessage) {
      setMessage(setupMessage);
      return;
    }
    try {
      const result = await registerDevice(true);
      if (result === "registered") {
        setPermission({ granted: true, canAskAgain: false });
        setMessage("تم السماح بالإشعارات وربط هذا الجهاز بحسابك.");
      } else if (result === "denied") {
        const current = await Notifications.getPermissionsAsync();
        setPermission({ granted: current.granted, canAskAgain: current.canAskAgain });
        setMessage("لم يُمنح الإذن. المحفظة تعمل كالمعتاد؛ يمكنك إعادة التفعيل من إعدادات الهاتف.");
      } else if (result === "missing-project") {
        setMessage("لم يُربط التطبيق بمعرّف Expo/EAS Project ID. يلزم إعداد المعرف قبل تسجيل جهاز الهاتف.");
      } else {
        setMessage("تفعيل Push يتطلب تطبيق هاتف مثبتًا؛ معاينة المتصفح لا تسجل أجهزة الهاتف.");
      }
    } catch (error) {
      setMessage(getPushRegistrationFailureMessage(error));
    }
  };

  const openSettings = () => {
    Alert.alert("إعدادات إشعارات Flotex EGP", "الإذن مرفوض من النظام. افتح إعدادات التطبيق وفعّل الإشعارات يدويًا.", [
      { text: "ليس الآن", style: "cancel" },
      { text: "فتح الإعدادات", onPress: () => { void Linking.openSettings(); } },
    ]);
  };

  return <Card className="mt-4">
    <View className="flex-row items-center justify-between"><Text className="text-base font-bold text-[#F7F1E3]">إشعارات المحفظة</Text><Pill tone={permission?.granted ? "gold" : "muted"}>{permission?.granted ? "مفعّلة" : "اختيارية"}</Pill></View>
    <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]">بعد موافقتك، نرسل لهذا الجهاز تنبيهًا عند إرسال طلب إيداع أو سحب، وعند مراجعته أو إضافة رصيد أو خصمه. رفض الإذن لا يعطّل المحفظة، ولا يُربط الجهاز إلا بحسابك المسجّل.</Text>
    {setupMessage && !message ? <Text className="mt-3 text-xs leading-5 text-[#D7A948]">{setupMessage}</Text> : null}
    {message ? <Text className="mt-3 text-xs leading-5 text-[#9BA8B8]">{message}</Text> : null}
    <View className="mt-4"><ActionButton label={isPending ? "جارٍ تسجيل الجهاز" : setupMessage ? "متطلبات Push غير مكتملة" : permission?.granted ? "تحديث تسجيل هذا الجهاز" : permission && !permission.canAskAgain ? "فتح إعدادات الإشعارات" : "تفعيل إشعارات المحفظة"} icon="notifications-outline" onPress={setupMessage ? enable : permission && !permission.canAskAgain && !permission.granted ? openSettings : enable} /></View>
  </Card>;
}
