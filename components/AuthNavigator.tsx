import { Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/use-auth";
import { authSessionState } from "@/shared/auth-session-state";
import { PROTECTED_ROOT_ROUTES } from "@/shared/auth-routing";

export function AuthNavigator() {
  const { user, sessionReady } = useAuth();
  const state = useSyncExternalStore(authSessionState.subscribe, authSessionState.getSnapshot, authSessionState.getSnapshot);
  if (!sessionReady) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0B1018" }}><ActivityIndicator color="#D7A948" /></View>;
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="index" />
      <Stack.Protected guard={!user || state.registrationReceiptActive}>
        <Stack.Screen name="register" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="oauth/callback" />
      </Stack.Protected>
      <Stack.Screen name="support-portal" />
      <Stack.Protected guard={Boolean(user)}>
        {PROTECTED_ROOT_ROUTES.map((name) => <Stack.Screen key={name} name={name} />)}
      </Stack.Protected>
      <Stack.Protected guard={user?.role === "admin"}>
        <Stack.Screen name="admin" />
        <Stack.Screen name="control" />
        <Stack.Screen name="dev/theme-lab" />
      </Stack.Protected>
    </Stack>
  );
}
