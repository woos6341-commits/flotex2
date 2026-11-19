import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/hooks/use-auth";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarStyle = user
    ? {
        paddingTop: 8,
        paddingBottom: bottomPadding,
        height: 56 + bottomPadding,
        backgroundColor: "#121B28",
        borderTopColor: "#273548",
        borderTopWidth: 1,
      }
    : { display: "none" as const };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#D7A948",
        tabBarInactiveTintColor: "#657286",
        tabBarStyle,
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "الرئيسية", tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={21} color={color} /> }} />
      <Tabs.Protected guard={Boolean(user)}>
      <Tabs.Screen name="stocks" options={{ title: "الذهب", tabBarIcon: ({ color }) => <Ionicons name="diamond-outline" size={21} color={color} /> }} />
      <Tabs.Screen name="wallet" options={{ title: "المحفظة", tabBarIcon: ({ color }) => <Ionicons name="wallet-outline" size={21} color={color} /> }} />
      <Tabs.Screen name="activity" options={{ title: "النشاط", tabBarIcon: ({ color }) => <Ionicons name="pulse-outline" size={21} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "حسابي", tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={21} color={color} /> }} />
      </Tabs.Protected>
    </Tabs>
  );
}
