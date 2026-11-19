import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";

export function AccountFrozenOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const auth = trpc.auth.me.useQuery(undefined, { staleTime: 30_000, refetchOnMount: true, refetchOnReconnect: true, retry: false });
  if (!auth.data?.accountFrozen || pathname === "/frozen-support") return null;
  return <View accessibilityRole="alert" style={styles.overlay}>
    <View style={styles.card}>
      <Text style={styles.icon}>!</Text>
      <Text style={styles.title}>تم إيقاف حسابك مؤقتًا</Text>
      <Text style={styles.body}>تم إيقاف حسابك مؤقتًا. إذا كنت تعتقد أن هناك خطأ أو ترغب في الاستفسار، يمكنك التواصل مع فريق الدعم.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push("/frozen-support" as never)} style={styles.button}>
        <Text style={styles.buttonText}>تواصل مع الدعم</Text>
      </Pressable>
      <Text style={styles.help}>لن يتم فك تجميد الحساب تلقائيًا بمجرد التواصل.</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1000, backgroundColor: "#0B1018", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 480, borderRadius: 24, borderWidth: 1, borderColor: "#6B3942", backgroundColor: "#121B28", padding: 24, alignItems: "center" },
  icon: { width: 44, height: 44, borderRadius: 22, overflow: "hidden", backgroundColor: "#6B3942", color: "#FFFFFF", fontSize: 28, fontWeight: "900", textAlign: "center", textAlignVertical: "center" },
  title: { marginTop: 15, color: "#F7F1E3", fontSize: 20, fontWeight: "800", textAlign: "center" },
  body: { marginTop: 9, color: "#C5CBD3", fontSize: 14, lineHeight: 23, textAlign: "center" },
  button: { marginTop: 20, width: "100%", borderRadius: 16, backgroundColor: "#D7A948", paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#0B1018", fontSize: 15, fontWeight: "800" },
  help: { marginTop: 14, color: "#D7A948", fontSize: 13, fontWeight: "700", textAlign: "center" },
});
