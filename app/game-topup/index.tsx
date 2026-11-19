import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { LoginPanel } from "@/components/LoginPanel";
import { ActionButton, Card, EmptyState, Screen, formatMoney } from "@/components/atheer-ui";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { formatGameQuantity, resolveGameImageUrl } from "@/lib/game-topup";

const GOLD = "#D7A948";
const MUTED = "#9BA8B8";

const styles = StyleSheet.create({
  hero: { borderRadius: 28, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#161D28", padding: 18, overflow: "hidden" },
  heroGlow: { position: "absolute", width: 190, height: 190, borderRadius: 95, backgroundColor: "#D7A94816", top: -90, left: -60 },
  balanceValue: { color: "#E9C97E", fontSize: 30, fontWeight: "800", writingDirection: "ltr", fontVariant: ["tabular-nums"], textAlign: "right" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  gameCard: { borderRadius: 18, borderWidth: 1, borderColor: "#2A394D", backgroundColor: "#111B28", overflow: "hidden" },
  gameImage: { width: "100%", height: 88, backgroundColor: "#1A2433" },
  gameImageFallback: { width: "100%", height: 88, alignItems: "center", justifyContent: "center", backgroundColor: "#1A2433" },
  gameBody: { padding: 9 },
  gameName: { color: "#F7F1E3", fontSize: 13.5, fontWeight: "800", textAlign: "right" },
  gameMeta: { color: MUTED, fontSize: 10.5, marginTop: 3, textAlign: "right" },
  priceTag: { alignSelf: "flex-start", marginTop: 6, borderRadius: 999, backgroundColor: "#D7A94818", paddingHorizontal: 8, paddingVertical: 4 },
  priceTagText: { color: GOLD, fontSize: 10.5, fontWeight: "700" },
  historyButton: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, borderColor: "#2A394D", backgroundColor: "#121B28", paddingHorizontal: 12, paddingVertical: 8 },
  historyText: { color: "#D7B76B", fontSize: 12, fontWeight: "700" },
  note: { color: "#657286", fontSize: 11, lineHeight: 18, textAlign: "center", marginTop: 14 },
});

export default function GameTopupScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardWidth = width >= 700 ? "31.5%" : "48.7%";
  const catalog = trpc.gameTopup.catalog.useQuery(undefined, { enabled: Boolean(user), refetchOnWindowFocus: true });
  const overview = trpc.gameTopup.overview.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true });

  if (loading) {
    return <Screen title="شحن الألعاب"><View className="flex-1 items-center justify-center"><ActivityIndicator color={GOLD} /></View></Screen>;
  }
  if (!user) {
    return (
      <Screen title="شحن الألعاب" subtitle="سجّل الدخول لشحن لعبتك من محفظتك">
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 40 }}>
          <LoginPanel />
        </ScrollView>
      </Screen>
    );
  }

  const games = catalog.data?.games ?? [];
  const enabled = catalog.data?.enabled !== false;

  return (
    <Screen title="شحن الألعاب" subtitle="اشحن شدات وجواهر ألعابك من رصيد محفظتك">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mb-4 flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="العودة للرئيسية" onPress={() => router.back()} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]} className="h-10 w-10 items-center justify-center rounded-2xl border border-[#2A394D] bg-[#121B28]">
            <Ionicons name="arrow-forward" size={19} color={GOLD} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="سجل طلبات الشحن" onPress={() => router.push("/game-topup/history" as never)} style={({ pressed }) => [styles.historyButton, { opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name="receipt-outline" size={15} color="#D7B76B" />
            <Text style={styles.historyText}>طلباتي</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <View className="flex-row items-center justify-between">
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-[#D7A948]">
              <Ionicons name="game-controller" size={23} color="#0B1018" />
            </View>
            <View className="items-end">
              <Text style={{ color: "#F7F1E3", fontSize: 16, fontWeight: "800", textAlign: "right" }}>الرصيد المتاح للشحن</Text>
              <Text style={{ color: MUTED, fontSize: 11, marginTop: 3, textAlign: "right" }}>يُحجز المبلغ فقط عند تأكيد الطلب</Text>
            </View>
          </View>
          <View className="mt-4 flex-row items-end justify-between border-t border-[#3B3424] pt-3">
            <Text style={{ color: MUTED, fontSize: 12, fontWeight: "700" }}>ج.م</Text>
            {overview.isLoading ? <ActivityIndicator color={GOLD} /> : (
              <Text accessibilityLabel={`الرصيد المتاح ${formatMoney(overview.data?.wallet.available)}`} style={styles.balanceValue}>
                {overview.isError ? "—" : formatMoney(overview.data?.wallet.available)}
              </Text>
            )}
          </View>
          {overview.isError ? <Text style={{ color: "#FF7D8D", fontSize: 11, marginTop: 8, textAlign: "right" }}>تعذر تحميل الرصيد؛ أعد المحاولة قبل إرسال أي طلب.</Text> : null}
        </View>

        <View className="mb-3 mt-6 flex-row items-center justify-between">
          <Text style={{ color: MUTED, fontSize: 12 }}>{games.length ? `${games.length} ألعاب متاحة` : ""}</Text>
          <Text style={{ color: "#F7F1E3", fontSize: 18, fontWeight: "800", textAlign: "right" }}>اختر لعبتك</Text>
        </View>

        {catalog.isLoading ? (
          <View className="py-14 items-center"><ActivityIndicator color={GOLD} /><Text style={{ color: MUTED, fontSize: 12, marginTop: 10 }}>جارٍ تحميل الألعاب…</Text></View>
        ) : !enabled ? (
          <EmptyState title="خدمة شحن الألعاب متوقفة مؤقتًا" text="سيتم تفعيل الخدمة من لوحة الإدارة قريبًا. لا يتم خصم أي مبلغ أثناء التوقف." />
        ) : catalog.isError ? (
          <Card><Text style={{ color: "#FF7D8D", fontSize: 13, textAlign: "center" }}>تعذر تحميل الألعاب. تحقق من الاتصال ثم أعد المحاولة.</Text><View className="mt-4"><ActionButton label="إعادة المحاولة" icon="refresh-outline" secondary onPress={() => void catalog.refetch()} /></View></Card>
        ) : !games.length ? (
          <EmptyState title="لا توجد ألعاب مضافة" text="ستظهر الألعاب هنا بعد إضافتها من لوحة الإدارة." />
        ) : (
          <View style={styles.grid}>
            {games.map((game) => {
              const image = resolveGameImageUrl(game.imageUrl);
              const cheapest = game.packages.length ? game.packages.reduce((min, item) => Number(item.price) < Number(min.price) ? item : min, game.packages[0]) : null;
              return (
                <Pressable
                  key={game.id}
                  accessibilityRole="button"
                  accessibilityLabel={`شحن ${game.name}`}
                  onPress={() => router.push((game.serviceType === "deposit_withdraw" ? `/game-topup/service/${game.slug}` : `/game-topup/${game.slug}`) as never)}
                  style={({ pressed }) => [styles.gameCard, { width: cardWidth, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }]}
                >
                  {image ? (
                    <Image source={{ uri: image }} style={styles.gameImage} contentFit="contain" transition={180} />
                  ) : (
                    <View style={styles.gameImageFallback}><Ionicons name="game-controller-outline" size={34} color={GOLD} /></View>
                  )}
                  <View style={styles.gameBody}>
                    <Text numberOfLines={1} style={styles.gameName}>{game.name}</Text>
                    <Text style={styles.gameMeta}>{game.serviceType === "deposit_withdraw" ? "إيداع وسحب سريع" : `يبدأ من ${formatGameQuantity(game.minQuantity, game.currencyLabel)}`}</Text>
                    {game.serviceType === "deposit_withdraw" ? <View style={styles.priceTag}><Text style={styles.priceTagText}>{game.depositFeeEnabled ? `رسوم الإيداع ${formatMoney(game.depositFeeAmount)}` : "بدون رسوم إيداع"}</Text></View> : cheapest ? <View style={styles.priceTag}><Text style={styles.priceTagText}>من {formatMoney(cheapest.price)}</Text></View> : <View style={styles.priceTag}><Text style={styles.priceTagText}>{formatMoney(game.unitPrice)} / {game.currencyLabel}</Text></View>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View className="mt-5 flex-row items-center gap-2 rounded-2xl border border-[#273548] bg-[#0E1723] px-4 py-3">
          <Ionicons name="shield-checkmark-outline" size={17} color="#47D7A5" />
          <Text style={{ color: "#B6C1CF", fontSize: 11, lineHeight: 18, flex: 1, textAlign: "right" }}>كل طلب يُراجع يدويًا ويُخصم من محفظتك مرة واحدة فقط بعد الاعتماد. لا يُعلن اكتمال الشحن قبل تسجيل مرجع العملية.</Text>
        </View>
        <Text style={styles.note}>Flotex EGP · خدمة شحن ألعاب داخلية مرتبطة بمحفظتك</Text>
      </ScrollView>
    </Screen>
  );
}
