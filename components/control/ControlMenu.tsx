import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";

export type ControlSection = "overview" | "payments" | "fees" | "requests" | "savings" | "gold" | "coin" | "topup" | "customers" | "readiness" | "updates" | "customerSupport" | "phoneVerification" | "accountVerification" | "phoneChange" | "notifications" | "supportMessaging" | "guestSupport" | "verificationCodes" | "adminAccounts" | "externalTransfers" | "gameTopup" | "homeActionOrder" | "buttonVisibility" | "shareFile" | "serviceControls";

type IconName = keyof typeof Ionicons.glyphMap;

const styles = StyleSheet.create({
  menuCard: { borderRadius: 24, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28", padding: 18, flexDirection: "row", alignItems: "center", gap: 14 },
  primaryMenuCard: { borderColor: "#5C4A28", backgroundColor: "#171D27" },
  menuIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#D7A94822" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  backButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: "#273548", alignItems: "center", justifyContent: "center", backgroundColor: "#121B28" },
});

export function ControlMenuCard({ title, description, icon, onPress, primary = false }: { title: string; description: string; icon: IconName; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuCard, primary && styles.primaryMenuCard, pressed && { opacity: 0.78 }]}>
      <View style={styles.menuIcon}><Ionicons name={icon} size={24} color="#D7A948" /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#F7F1E3", fontSize: 16, fontWeight: "800", textAlign: "right" }}>{title}</Text>
        <Text style={{ color: "#9BA8B8", fontSize: 12, lineHeight: 19, marginTop: 4, textAlign: "right" }}>{description}</Text>
      </View>
      <Ionicons name="chevron-back" size={20} color="#657286" />
    </Pressable>
  );
}

export function SectionHeader({ title, subtitle, onBack, children }: { title: string; subtitle?: string; onBack: () => void; children?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى القائمة" onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}>
        <Ionicons name="arrow-forward" size={20} color="#D7A948" />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#F7F1E3", fontSize: 21, fontWeight: "800", textAlign: "right" }}>{title}</Text>
        {subtitle ? <Text style={{ color: "#9BA8B8", fontSize: 12, lineHeight: 19, marginTop: 3, textAlign: "right" }}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}
