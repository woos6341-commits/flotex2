import { Ionicons } from "@expo/vector-icons";
import { useCallback, useRef } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { Card, EmptyState, Screen } from "@/components/atheer-ui";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";

const GOLD = "#D7A948";
const MUTED = "#9BA8B8";

export default function WithdrawGuideScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { user } = useAuth();
  const router = useRouter();
  const catalog = trpc.gameTopup.catalog.useQuery(undefined, {
    enabled: Boolean(user),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
  });
  const { refetch: refetchCatalog } = catalog;
  const hasFocusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (hasFocusedOnce.current && user) void refetchCatalog();
    hasFocusedOnce.current = true;
    return undefined;
  }, [refetchCatalog, user]));
  const game = catalog.data?.games.find((item) => item.slug === slug);
  const instructions = game?.withdrawalInstructions?.trim() || "لم تُضف تعليمات السحب بعد. تواصل مع خدمة العملاء لمعرفة الخطوات.";

  return (
    <Screen title="كيفية السحب" subtitle="خطوات السحب من خدمة الألعاب">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mb-4 flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="العودة" onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-2xl border border-[#2A394D] bg-[#121B28]"><Ionicons name="arrow-forward" size={19} color={GOLD} /></Pressable>
          <Text style={{ color: "#F7F1E3", fontSize: 18, fontWeight: "800", textAlign: "right" }}>{game?.name || "خدمة السحب"}</Text>
        </View>
        {catalog.isLoading || !catalog.isFetchedAfterMount ? <View className="py-16 items-center"><ActivityIndicator color={GOLD} /></View> : catalog.isError || !game ? (
          <EmptyState title="تعذر تحميل الإرشادات" text="تحقق من الاتصال ثم أعد المحاولة." />
        ) : (
          <Card className="border-[#5C4A28] bg-[#161D28]">
            <View className="flex-row items-center justify-between">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-[#D7A94818]"><Ionicons name="document-text-outline" size={23} color={GOLD} /></View>
              <Text style={{ color: "#F7F1E3", fontSize: 17, fontWeight: "800", textAlign: "right" }}>خطوات السحب</Text>
            </View>
            <Text selectable style={{ color: "#E6E0D5", fontSize: 13.5, lineHeight: 26, marginTop: 16, textAlign: "right" }}>{instructions}</Text>
            <View className="mt-5 rounded-2xl border border-[#2A394D] bg-[#0B1018] p-4">
              <Text style={{ color: MUTED, fontSize: 11, lineHeight: 19, textAlign: "right" }}>تُحمّل هذه التعليمات من إعدادات الخدمة مباشرة، ويظهر أي تعديل تحفظه الإدارة دون تحديث التطبيق.</Text>
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
