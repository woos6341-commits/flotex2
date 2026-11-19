import { FontAwesome, Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { trpc } from "@/lib/trpc";
import { showFinancialMessage } from "@/lib/financial-feedback";
import type { ContactButton } from "@/shared/contact-buttons";

const COLORS = {
  panel: "#121B28",
  field: "#0B1018",
  border: "#273548",
  accent: "#D7A948",
  text: "#F7F1E3",
  muted: "#9BA8B8",
  dim: "#657286",
};

function ContactIcon({ button }: { button: ContactButton }) {
  if (button.type === "whatsapp") return <FontAwesome name="whatsapp" size={20} color={COLORS.accent} />;
  if (button.type === "telegram") return <FontAwesome name="telegram" size={20} color={COLORS.accent} />;
  return <Ionicons name="link-outline" size={20} color={COLORS.accent} />;
}

function contactDescription(type: ContactButton["type"]) {
  if (type === "whatsapp") return "تواصل مباشر عبر واتساب";
  if (type === "telegram") return "افتح محادثة تليجرام";
  return "افتح رابط الخدمة";
}

export function PaymentContactButtons() {
  const query = trpc.payment.contactButtons.useQuery(undefined, { staleTime: 30_000 });
  const [openingId, setOpeningId] = useState<string | null>(null);
  const buttons = query.data ?? [];
  if (!query.isLoading && !query.isError && buttons.length === 0) return null;

  const openLink = async (button: ContactButton) => {
    if (openingId) return;
    setOpeningId(button.id);
    try {
      await Linking.openURL(button.target);
    } catch {
      showFinancialMessage("تعذر فتح الرابط", "تحقق من اتصالك أو جرّب فتح الرابط مرة أخرى.");
    } finally {
      setOpeningId(null);
    }
  };

  return <>
    {query.isLoading ? <Text style={styles.statusText}>جارٍ تحميل وسائل التواصل...</Text> : null}
    {query.isError ? <Text style={styles.errorText}>تعذر تحميل بطاقات التواصل.</Text> : null}
    {buttons.map((button) => <Pressable
      key={button.id}
      accessibilityRole="link"
      accessibilityLabel={`فتح ${button.name}`}
      disabled={openingId !== null}
      onPress={() => void openLink(button)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.iconBadge}><ContactIcon button={button} /></View>
      <View style={styles.cardCopy}>
        <Text numberOfLines={2} style={styles.cardName}>{button.name}</Text>
        <Text numberOfLines={1} style={styles.cardDescription}>{contactDescription(button.type)}</Text>
      </View>
      <Ionicons name="chevron-back" size={17} color={COLORS.dim} />
    </Pressable>)}
  </>;
}

const styles = StyleSheet.create({
  card: {
    width: "47%",
    minHeight: 106,
    borderRadius: 16,
    backgroundColor: COLORS.field,
    borderColor: COLORS.border,
    borderWidth: 1,
    padding: 10,
    alignItems: "flex-end",
    justifyContent: "space-between",
    shadowColor: COLORS.accent,
    shadowOpacity: 0.12,
    shadowRadius: 7,
    elevation: 2,
  },
  cardPressed: { opacity: 0.78 },
  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field },
  cardCopy: { width: "100%", alignItems: "flex-end" },
  cardName: { width: "100%", color: COLORS.text, fontSize: 13, fontWeight: "700", textAlign: "right", marginTop: 4 },
  cardDescription: { color: COLORS.dim, fontSize: 9, marginTop: 1, textAlign: "right" },
  statusText: { width: "100%", color: COLORS.dim, fontSize: 12, textAlign: "right", paddingVertical: 10 },
  errorText: { width: "100%", color: "#FF7D8D", fontSize: 12, textAlign: "right", paddingVertical: 10 },
});
