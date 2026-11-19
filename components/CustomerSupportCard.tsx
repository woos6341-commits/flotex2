import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";
import { buildSupportEmailUri, buildTelegramUrl, type SupportOperation } from "@/shared/customer-support";

type Props = {
  customerId?: string | null;
  operation: SupportOperation;
  requestId?: string | null;
};

export function CustomerSupportCard({ customerId, operation, requestId }: Props) {
  const settings = trpc.customerSupport.settings.useQuery(undefined, {
    staleTime: 15_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    retry: false,
  });
  const [launchError, setLaunchError] = useState("");

  const openUrl = async (url: string | null, channel: string) => {
    setLaunchError("");
    if (!url) {
      setLaunchError(`بيانات ${channel} غير مكتملة لدى خدمة العملاء.`);
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      setLaunchError(`تعذر فتح ${channel} على هذا الجهاز.`);
    }
  };

  const emailUri = settings.data?.email
    ? buildSupportEmailUri(settings.data.email, { customerId, operation, requestId })
    : null;
  const telegramUrl = settings.data?.telegramUsername
    ? buildTelegramUrl(settings.data.telegramUsername)
    : null;
  const extraLinks = settings.data?.links?.filter((link) => link.enabled) ?? [];
  const noChannels = settings.isSuccess && !emailUri && !telegramUrl && extraLinks.length === 0;

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.iconWrap}><Ionicons name="headset-outline" size={18} color="#D7A948" /></View>
        <Text style={styles.heading}>خدمة العملاء</Text>
      </View>
      <Text style={styles.helpText}>إذا لم تصلك أموال الإيداع أو السحب خلال ساعة من تقديم الطلب، يُرجى التواصل مع خدمة العملاء</Text>
      {settings.isLoading ? <Text style={styles.muted}>جارٍ تحميل قنوات التواصل...</Text> : null}
      {settings.isError ? (
        <Pressable accessibilityRole="button" onPress={() => void settings.refetch()} style={styles.retryButton}>
          <Text style={styles.retryText}>تعذر تحميل القنوات — إعادة المحاولة</Text>
        </Pressable>
      ) : null}
      {noChannels ? <Text style={styles.muted}>قنوات التواصل لم تُضفها الإدارة بعد.</Text> : null}
      {(emailUri || telegramUrl) ? (
        <View style={styles.buttonsRow}>
          {emailUri ? (
            <Pressable accessibilityRole="button" onPress={() => void openUrl(emailUri, "البريد الإلكتروني")} style={styles.channelButton}>
              <Ionicons name="mail-outline" size={17} color="#D7A948" />
              <Text style={styles.channelText}>التواصل مع خدمة العملاء عبر البريد الإلكتروني</Text>
            </Pressable>
          ) : null}
          {telegramUrl ? (
            <Pressable accessibilityRole="button" onPress={() => void openUrl(telegramUrl, "تليجرام")} style={styles.channelButton}>
              <Ionicons name="paper-plane-outline" size={17} color="#D7A948" />
              <Text style={styles.channelText}>التواصل مع خدمة العملاء عبر تليجرام</Text>
            </Pressable>
          ) : null}
          {extraLinks.map((link) => (
            <Pressable key={link.id} accessibilityRole="button" onPress={() => void openUrl(link.url, link.label)} style={styles.channelButton}>
              <Ionicons name={link.icon} size={17} color="#D7A948" />
              <Text style={styles.channelText}>{link.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {launchError ? <Text accessibilityRole="alert" style={styles.errorText}>{launchError}</Text> : null}
    </View>
  );
}

const styles = {
  card: { marginTop: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28" },
  headingRow: { flexDirection: "row-reverse" as const, alignItems: "center" as const, gap: 8 },
  iconWrap: { width: 30, height: 30, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: 10, backgroundColor: "#D7A94818" },
  heading: { color: "#F7F1E3", fontSize: 14, fontWeight: "800" as const, textAlign: "right" as const },
  helpText: { marginTop: 6, color: "#9BA8B8", fontSize: 11, lineHeight: 17, textAlign: "right" as const },
  muted: { marginTop: 7, color: "#657286", fontSize: 11, textAlign: "right" as const },
  buttonsRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 7, marginTop: 9 },
  channelButton: { flexGrow: 1, flexBasis: 140, minHeight: 40, flexDirection: "row-reverse" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, borderWidth: 1, borderColor: "#5C4A28", borderRadius: 12, backgroundColor: "#171D27", paddingHorizontal: 8, paddingVertical: 6 },
  channelText: { color: "#D7A948", fontSize: 10, fontWeight: "700" as const, textAlign: "center" as const, flexShrink: 1 },
  retryButton: { marginTop: 7, alignSelf: "flex-end" as const, paddingVertical: 3 },
  retryText: { color: "#D7A948", fontSize: 11, textAlign: "right" as const },
  errorText: { marginTop: 7, color: "#FF7D8D", fontSize: 11, textAlign: "right" as const },
};
