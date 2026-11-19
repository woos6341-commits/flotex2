import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Network from "expo-network";
import { getApiBaseUrl } from "@/constants/api";

type Connectivity = "online" | "offline" | "checking";

function isOffline(state: Network.NetworkState) {
  return state.isConnected === false || state.isInternetReachable === false;
}

async function canReachApplicationApi() {
  const base = getApiBaseUrl();
  if (!base) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      // Health is a read-only request. Two attempts avoid a false offline screen
      // during a cold start while never retrying a financial mutation.
      const response = await fetch(`${base}/api/health?probe=${Date.now()}`, { method: "GET", cache: "no-store", signal: controller.signal });
      if (response.ok) return true;
    } catch {
      // Retry once after a short backoff; the caller shows offline only after both fail.
    } finally {
      clearTimeout(timeout);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return false;
}

function initialConnectivity(): Connectivity {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  return "checking";
}

export function OfflineOverlay() {
  const [connectivity, setConnectivity] = useState<Connectivity>(initialConnectivity);
  const [checking, setChecking] = useState(false);
  const [hasKnownOnlineState, setHasKnownOnlineState] = useState(false);
  const [resumeGrace, setResumeGrace] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setConnectivity("offline");
          return;
        }
      } else {
        const state = await Network.getNetworkStateAsync();
        if (isOffline(state)) {
          setConnectivity("offline");
          return;
        }
      }
      const online = await canReachApplicationApi();
      if (online) setHasKnownOnlineState(true);
      setConnectivity(online ? "online" : "offline");
    } catch {
      setConnectivity("offline");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const initialCheck = setTimeout(() => void refresh(), 0);
    if (Platform.OS === "web") {
      const onOnline = () => void refresh();
      const onOffline = () => setConnectivity("offline");
      if (typeof window === "undefined") return () => clearTimeout(initialCheck);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      return () => {
        clearTimeout(initialCheck);
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    }
    const networkSubscription = Network.addNetworkStateListener((state) => {
      if (isOffline(state)) setConnectivity("offline");
      else void refresh();
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // Camera activities can briefly pause the JS bridge and the API probe.
        // Do not cover the verification form while Expo restores the image result.
        setResumeGrace(true);
        setTimeout(() => setResumeGrace(false), 8000);
        void refresh();
      }
    });
    return () => {
      clearTimeout(initialCheck);
      networkSubscription.remove();
      appStateSubscription.remove();
    };
  }, [refresh]);

  if (resumeGrace || connectivity === "online" || (connectivity === "checking" && hasKnownOnlineState)) return null;
  const verifying = connectivity === "checking";
  return <View accessibilityRole="alert" style={styles.overlay}>
    <View style={styles.card}>
      {verifying ? <ActivityIndicator size="large" color="#D7A948" /> : <Text style={styles.icon}>×</Text>}
      <Text style={styles.title}>{verifying ? "جارٍ التحقق من الاتصال" : "تعذر الوصول إلى خادم التطبيق"}</Text>
      <Text style={styles.body}>{verifying
        ? "نتأكد من اتصال آمن قبل عرض المحفظة والبيانات."
        : "تعذر الوصول إلى واجهة API بعد محاولتين. تحقق من الإنترنت أو أعد المحاولة؛ لن نعيد إرسال أي عملية مالية تلقائيًا."}</Text>
      {!verifying ? <Pressable accessibilityRole="button" disabled={checking} onPress={() => void refresh()} style={({ pressed }) => [styles.button, (pressed || checking) && styles.buttonPressed]}>
        {checking ? <ActivityIndicator color="#0B1018" /> : <Text style={styles.buttonText}>إعادة المحاولة</Text>}
      </Pressable> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1100, backgroundColor: "#0B1018", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 480, borderRadius: 24, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#121B28", padding: 24, alignItems: "center" },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#5C4A28", color: "#F7F1E3", fontSize: 30, fontWeight: "800", textAlign: "center", textAlignVertical: "center" },
  title: { marginTop: 15, color: "#F7F1E3", fontSize: 20, fontWeight: "800", textAlign: "center" },
  body: { marginTop: 9, color: "#C5CBD3", fontSize: 14, lineHeight: 23, textAlign: "center" },
  button: { minWidth: 150, minHeight: 46, marginTop: 18, borderRadius: 15, backgroundColor: "#D7A948", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonPressed: { opacity: 0.78 },
  buttonText: { color: "#0B1018", fontSize: 14, fontWeight: "800" },
});
