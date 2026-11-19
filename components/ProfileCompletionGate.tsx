import { useEffect, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, useSegments, useRootNavigationState } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { authSessionState } from "@/shared/auth-session-state";
import { needsProfileCompletion } from "@/shared/registration";
import {
  authenticatedHomeRoute,
  isAdministrativeRoute,
  isPublicUnauthenticatedRoute,
  shouldRedirectAuthenticatedUser,
} from "@/shared/auth-routing";

export function ProfileCompletionGate() {
  const { user, loading, error, refresh } = useAuth();
  const state = useSyncExternalStore(authSessionState.subscribe, authSessionState.getSnapshot, authSessionState.getSnapshot);
  const router = useRouter();
  const segments = useSegments() as string[];
  const navigation = useRootNavigationState();
  const first = segments[0];
  const isPublicRoute = isPublicUnauthenticatedRoute(segments);
  const isOnboardingRoute = first === "onboarding";
  const isAdminRoute = isAdministrativeRoute(segments);
  const showingReceipt = first === "register" && state.registrationReceiptActive;
  const redirectSignedInEntry = shouldRedirectAuthenticatedUser(segments) && !showingReceipt;
  const profileIncomplete = Boolean(user && user.role !== "admin" && needsProfileCompletion(user));

  useEffect(() => {
    if (!navigation?.key || loading || showingReceipt) return;

    if (!user) {
      // A temporary API/network failure is not proof that the session ended.
      if (error) return;
      if (!isPublicRoute) router.replace("/register");
      return;
    }

    if (profileIncomplete) {
      if (!isOnboardingRoute) router.replace("/onboarding");
      return;
    }

    if (redirectSignedInEntry || isOnboardingRoute) {
      router.replace(authenticatedHomeRoute(user.role));
      return;
    }

    if (isAdminRoute && user.role !== "admin") {
      router.replace(authenticatedHomeRoute(user.role));
    }
  }, [
    isAdminRoute,
    isOnboardingRoute,
    isPublicRoute,
    error,
    loading,
    showingReceipt,
    navigation?.key,
    profileIncomplete,
    redirectSignedInEntry,
    router,
    user,
  ]);

  const redirectingAuthenticatedUser = Boolean(
    user &&
      !showingReceipt &&
      (profileIncomplete
        ? !isOnboardingRoute
        : redirectSignedInEntry || isOnboardingRoute || (isAdminRoute && user.role !== "admin")),
  );
  const sessionUnavailable = !isPublicRoute && !user && (loading || Boolean(error));
  const protectCurrentRoute = sessionUnavailable || redirectingAuthenticatedUser;

  if (!protectCurrentRoute) return null;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          zIndex: 10000,
          elevation: 10000,
          backgroundColor: "#0B1018",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        },
      ]}
    >
      {error ? (
        <>
          <Text className="text-center text-base leading-7 text-[#F7F1E3]">
            تعذر التحقق من الجلسة مؤقتًا. حسابك لم يُسجّل الخروج؛ تحقق من الاتصال وأعد المحاولة.
          </Text>
          <Pressable onPress={() => { void refresh(); }} className="mt-5 rounded-2xl bg-[#D7A948] px-5 py-3">
            <Text className="font-bold text-[#0B1018]">إعادة المحاولة</Text>
          </Pressable>
          <Text className="mt-4 max-w-[320px] text-center text-xs leading-5 text-[#9BA8B8]">
            سيبقى حسابك محفوظًا على هذا الجهاز، وسيُستأنف تلقائيًا بعد عودة الاتصال.
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator color="#D7A948" />
          <Text className="mt-4 text-sm text-[#9BA8B8]">جارٍ التحقق من تسجيل الدخول…</Text>
        </>
      )}
    </View>
  );
}
