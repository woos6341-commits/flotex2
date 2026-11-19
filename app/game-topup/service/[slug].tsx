import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActionButton, Card, EmptyState, Pill, Screen, formatMoney } from "@/components/atheer-ui";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { resolveGameImageUrl } from "@/lib/game-topup";
import { showFinancialMessage } from "@/lib/financial-feedback";

const GOLD = "#D7A948";
const MUTED = "#9BA8B8";
const RED = "#FF7D8D";

const styles = StyleSheet.create({
  input: { minHeight: 52, borderWidth: 1, borderColor: "#2A394D", borderRadius: 15, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, fontSize: 15, textAlign: "right" },
  label: { color: "#C7B98D", fontSize: 12, fontWeight: "700", marginBottom: 7, textAlign: "right" },
  tab: { flex: 1, minHeight: 52, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#243244" },
  summaryLabel: { color: MUTED, fontSize: 12 },
  summaryValue: { color: "#F7F1E3", fontSize: 13, fontWeight: "700", writingDirection: "ltr" },
  heroImage: { width: "100%", height: 150, borderRadius: 20, backgroundColor: "#172235" },
  guideButton: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, borderColor: "#D7A94866", backgroundColor: "#D7A94814", paddingHorizontal: 11, paddingVertical: 7 },
});

function makeKey(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 80);
}

function clampFee(game: { depositFeeEnabled: boolean; depositFeeAmount: string; depositFeeMin: string; depositFeeMax: string }) {
  if (!game.depositFeeEnabled) return 0;
  const fee = Number(game.depositFeeAmount || 0);
  const min = Number(game.depositFeeMin || 0);
  const max = Number(game.depositFeeMax || 0);
  return Math.max(min, max > 0 ? Math.min(fee, max) : fee, 0);
}

export default function GameServiceScreen() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { user, loading } = useAuth();
  const router = useRouter();
  const catalog = trpc.gameTopup.catalog.useQuery(undefined, { enabled: Boolean(user), staleTime: 0, refetchOnWindowFocus: true, refetchOnReconnect: true, refetchInterval: 10000 });
  const overview = trpc.gameTopup.overview.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000 });
  const game = useMemo(() => catalog.data?.games.find((item) => item.slug === slug), [catalog.data, slug]);
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [depositAmount, setDepositAmount] = useState("");
  const [userGameId, setUserGameId] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawUserGameId, setWithdrawUserGameId] = useState("");
  const [withdrawalCode, setWithdrawalCode] = useState("");
  const [error, setError] = useState("");
  const depositKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const withdrawKey = useRef<{ fingerprint: string; key: string } | null>(null);

  const deposit = trpc.gameTopup.createDeposit.useMutation({
    onSuccess: (result) => {
      setDepositAmount(""); setUserGameId(""); depositKey.current = null;
      void showFinancialMessage("تم إرسال طلب الإيداع", result.message);
      router.replace("/game-topup/history" as never);
    },
    onError: (reason) => setError(reason.message),
  });
  const withdraw = trpc.gameTopup.createWithdraw.useMutation({
    onSuccess: (result) => {
      setWithdrawAmount(""); setWithdrawUserGameId(""); setWithdrawalCode(""); withdrawKey.current = null;
      void showFinancialMessage("تم إرسال طلب السحب", result.message);
      router.replace("/game-topup/history" as never);
    },
    onError: (reason) => setError(reason.message),
  });

  if (loading) return <Screen title="خدمة الألعاب"><View className="flex-1 items-center justify-center"><ActivityIndicator color={GOLD} /></View></Screen>;
  if (!user) return <Screen title="خدمة الألعاب"><Card><Text style={{ color: "#F7F1E3", textAlign: "right" }}>سجّل الدخول للوصول إلى خدمة الألعاب.</Text></Card></Screen>;
  if (catalog.isLoading) return <Screen title="خدمة الألعاب"><View className="flex-1 items-center justify-center"><ActivityIndicator color={GOLD} /></View></Screen>;
  if (catalog.isError || !game || game.serviceType !== "deposit_withdraw") {
    return <Screen title="خدمة الألعاب"><EmptyState title="الخدمة غير متاحة" text="تحقق من الاتصال أو اختر لعبة أخرى من قسم شحن الألعاب." /><View className="mt-4"><ActionButton label="العودة" icon="arrow-forward" secondary onPress={() => router.back()} /></View></Screen>;
  }

  const fee = clampFee(game);
  const minDeposit = Number(game.minDepositAmount || 50);
  const minWithdraw = Number(game.minWithdrawAmount || 50);
  const depositTotal = Math.max(0, Number(depositAmount || 0)) + fee;
  const image = resolveGameImageUrl(game.imageUrl);
  const available = Number(overview.data?.wallet.available ?? 0);
  const submitDeposit = () => {
    setError("");
    if (!(Number(depositAmount) >= minDeposit)) { setError(`أقل مبلغ للإيداع هو ${formatMoney(minDeposit)}.`); return; }
    if (userGameId.trim().length < 2) { setError(`أدخل ${game.userIdFieldLabel}.`); return; }
    if (overview.data && depositTotal > available) { setError("رصيد محفظتك غير كافٍ لمبلغ الإيداع والرسوم."); return; }
    const fingerprint = `${game.id}|${depositAmount}|${userGameId.trim()}`;
    if (!depositKey.current || depositKey.current.fingerprint !== fingerprint) depositKey.current = { fingerprint, key: makeKey("GT-DEP") };
    deposit.mutate({ gameId: game.id, amount: depositAmount, userGameId: userGameId.trim(), idempotencyKey: depositKey.current.key });
  };
  const submitWithdraw = () => {
    setError("");
    if (!(Number(withdrawAmount) >= minWithdraw)) { setError(`أقل مبلغ للسحب هو ${formatMoney(minWithdraw)}.`); return; }
    const city = game.cityValue.trim();
    const street = game.streetValue.trim();
    if (!city || !street) { setError("لم تضبط الإدارة بيانات المدينة والشارع الثابتة بعد؛ تواصل مع خدمة العملاء."); return; }
    if (withdrawUserGameId.trim().length < 2) { setError(`أدخل ${game.userIdFieldLabel}.`); return; }
    if (withdrawalCode.trim().length < 2) { setError(`أدخل ${game.withdrawalCodeLabel}.`); return; }
    const fingerprint = `${game.id}|${withdrawAmount}|${withdrawUserGameId.trim()}|${city}|${street}|${withdrawalCode.trim()}`;
    if (!withdrawKey.current || withdrawKey.current.fingerprint !== fingerprint) withdrawKey.current = { fingerprint, key: makeKey("GT-WD") };
    withdraw.mutate({ gameId: game.id, amount: withdrawAmount, userGameId: withdrawUserGameId.trim(), withdrawalCode: withdrawalCode.trim(), idempotencyKey: withdrawKey.current.key });
  };

  return (
    <Screen title={game.name} subtitle="إيداع وسحب عبر محفظة Flotex">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 44 }}>
        <View className="mb-4 flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="العودة" onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-2xl border border-[#2A394D] bg-[#121B28]"><Ionicons name="arrow-forward" size={19} color={GOLD} /></Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/game-topup/history" as never)} className="flex-row items-center gap-1.5 rounded-full border border-[#2A394D] bg-[#121B28] px-3 py-2"><Ionicons name="receipt-outline" size={15} color="#D7B76B" /><Text style={{ color: "#D7B76B", fontSize: 12, fontWeight: "700" }}>طلباتي</Text></Pressable>
        </View>

        <Card className="border-[#5C4A28] bg-[#161D28]">
          {image ? <Image source={{ uri: image }} style={styles.heroImage} contentFit="cover" transition={180} /> : null}
          <View className="flex-row items-center justify-between">
            <View className="flex-1 items-end">
              <Text style={{ color: "#F7F1E3", fontSize: 22, fontWeight: "800", textAlign: "right" }}>{game.name}</Text>
              <Text style={{ color: MUTED, fontSize: 11.5, marginTop: 5, textAlign: "right" }}>إيداع وسحب سريع مع مراجعة يدوية آمنة</Text>
            </View>
            <View className="ml-3 h-12 w-12 items-center justify-center rounded-2xl border border-[#D7A94855] bg-[#D7A94818]"><Ionicons name="swap-horizontal" size={24} color={GOLD} /></View>
          </View>
          <View className="mt-4 flex-row items-center justify-between rounded-2xl border border-[#2A394D] bg-[#0B1018] px-4 py-3">
            <Text style={{ color: MUTED, fontSize: 11 }}>الرصيد المتاح</Text>
            <Text style={{ color: GOLD, fontSize: 18, fontWeight: "800", writingDirection: "ltr" }}>{overview.isLoading ? "…" : formatMoney(overview.data?.wallet.available)}</Text>
          </View>
        </Card>

        <View className="mt-4 flex-row gap-3">
          <Pressable accessibilityRole="button" onPress={() => { setMode("deposit"); setError(""); }} style={[styles.tab, mode === "deposit" ? { borderColor: GOLD, backgroundColor: "#D7A94822" } : { borderColor: "#2A394D", backgroundColor: "#111B28" }]}>
            <Ionicons name="arrow-down-circle-outline" size={19} color={mode === "deposit" ? GOLD : MUTED} />
            <Text style={{ color: mode === "deposit" ? GOLD : "#C8D0DB", fontSize: 14, fontWeight: "800" }}>الإيداع</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setMode("withdraw"); setError(""); }} style={[styles.tab, mode === "withdraw" ? { borderColor: GOLD, backgroundColor: "#D7A94822" } : { borderColor: "#2A394D", backgroundColor: "#111B28" }]}>
            <Ionicons name="arrow-up-circle-outline" size={19} color={mode === "withdraw" ? GOLD : MUTED} />
            <Text style={{ color: mode === "withdraw" ? GOLD : "#C8D0DB", fontSize: 14, fontWeight: "800" }}>السحب</Text>
          </Pressable>
        </View>

        {mode === "deposit" ? (
          <Card className="mt-4">
            <View className="flex-row items-center justify-between"><Pill tone="gold">إيداع</Pill><Text style={{ color: "#F7F1E3", fontSize: 17, fontWeight: "800", textAlign: "right" }}>أدخل بيانات الإيداع</Text></View>
            <Text style={[styles.label, { marginTop: 18 }]}>مبلغ الإيداع (ج.م)</Text>
            <TextInput value={depositAmount} onChangeText={(value) => { setDepositAmount(value.replace(/[^0-9.]/g, "")); setError(""); }} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#657286" style={styles.input} />
            <Text style={{ color: "#657286", fontSize: 10.5, lineHeight: 17, marginTop: 6, textAlign: "right" }}>الحد الأدنى للإيداع: {formatMoney(minDeposit)}</Text>
            <Text style={[styles.label, { marginTop: 14 }]}>{game.userIdFieldLabel}</Text>
            <TextInput value={userGameId} onChangeText={(value) => { setUserGameId(value); setError(""); }} placeholder="أدخل ID المستخدم في 1xBet" placeholderTextColor="#657286" autoCapitalize="none" style={styles.input} />
            <View className="mt-4 rounded-2xl border border-[#2A394D] bg-[#0B1018] px-4 py-2">
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>مبلغ الإيداع</Text><Text style={styles.summaryValue}>{formatMoney(depositAmount || "0")}</Text></View>
              <View style={styles.summaryRow}><Text style={styles.summaryLabel}>رسوم الإيداع</Text><Text style={styles.summaryValue}>{game.depositFeeEnabled ? formatMoney(fee) : "بدون رسوم"}</Text></View>
              <View style={[styles.summaryRow, { borderBottomWidth: 0, paddingTop: 11 }]}><Text style={{ color: GOLD, fontSize: 13, fontWeight: "800" }}>الإجمالي المطلوب</Text><Text style={{ color: GOLD, fontSize: 17, fontWeight: "900", writingDirection: "ltr" }}>{formatMoney(depositTotal)}</Text></View>
            </View>
            <Text style={{ color: "#657286", fontSize: 10.5, lineHeight: 17, marginTop: 8, textAlign: "right" }}>تُحسب الرسوم تلقائيًا حسب إعدادات اللعبة. يُحجز الإجمالي مؤقتًا ولا يُخصم نهائيًا قبل اعتماد الإدارة.</Text>
            {error ? <Text accessibilityRole="alert" style={{ color: RED, fontSize: 12, lineHeight: 20, marginTop: 10, textAlign: "right" }}>{error}</Text> : null}
            <View className="mt-4"><ActionButton label={deposit.isPending ? "جارٍ إرسال الطلب…" : "تأكيد"} icon="checkmark-circle-outline" onPress={() => { if (!deposit.isPending) submitDeposit(); }} /></View>
          </Card>
        ) : (
          <Card className="mt-4">
            <View className="flex-row items-center justify-between"><Pill tone={game.withdrawEnabled ? "green" : "muted"}>{game.withdrawEnabled ? "متاح" : "متوقف"}</Pill><Text style={{ color: "#F7F1E3", fontSize: 17, fontWeight: "800", textAlign: "right" }}>اختر نقد</Text></View>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/game-topup/withdraw-guide", params: { slug: game.slug } } as never)} style={({ pressed }) => [styles.guideButton, { marginTop: 10, opacity: pressed ? 0.7 : 1 }]}><Ionicons name="help-circle-outline" size={15} color={GOLD} /><Text style={{ color: GOLD, fontSize: 11.5, fontWeight: "700" }}>كيفية السحب</Text></Pressable>
            <View className="mt-4 rounded-2xl border border-[#2A394D] bg-[#0B1018] px-4 py-3">
              <View style={[styles.summaryRow, { alignItems: "flex-start", gap: 8 }]}>
                <Text selectable style={[styles.summaryValue, { flex: 1, flexShrink: 1, textAlign: "right", writingDirection: "rtl" }]}>{game.cityValue.trim() || "لم تُحددها الإدارة بعد"}</Text>
                <Text style={[styles.summaryLabel, { marginLeft: 8 }]}>{game.cityLabel}</Text>
              </View>
              <View style={[styles.summaryRow, { borderBottomWidth: 0, alignItems: "flex-start", gap: 8 }]}>
                <Text selectable style={[styles.summaryValue, { flex: 1, flexShrink: 1, textAlign: "right", writingDirection: "rtl" }]}>{game.streetValue.trim() || "لم يُحددها الإدارة بعد"}</Text>
                <Text style={[styles.summaryLabel, { marginLeft: 8 }]}>{game.streetLabel}</Text>
              </View>
            </View>
            {(!game.cityValue.trim() || !game.streetValue.trim()) ? <Text style={{ color: RED, fontSize: 11.5, lineHeight: 18, marginTop: 8, textAlign: "right" }}>لم تضبط الإدارة بيانات المدينة والشارع الثابتة بعد؛ لن يمكن إرسال طلب السحب حتى تُحدّثها.</Text> : <Text style={{ color: MUTED, fontSize: 10.5, lineHeight: 17, marginTop: 7, textAlign: "right" }}>العنوان ثابت ومحدد من الإدارة ولا يحتاج إلى إدخال.</Text>}
            <Text style={[styles.label, { marginTop: 14 }]}>أدخل مبلغ السحب (ج.م)</Text>
            <TextInput value={withdrawAmount} onChangeText={(value) => { setWithdrawAmount(value.replace(/[^0-9.]/g, "")); setError(""); }} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#657286" style={styles.input} />
            <Text style={{ color: "#657286", fontSize: 10.5, lineHeight: 17, marginTop: 6, textAlign: "right" }}>الحد الأدنى للسحب: {formatMoney(minWithdraw)}</Text>
            <Text style={[styles.label, { marginTop: 14 }]}>{game.userIdFieldLabel}</Text>
            <TextInput value={withdrawUserGameId} onChangeText={(value) => { setWithdrawUserGameId(value); setError(""); }} placeholder="أدخل ID المستخدم في 1xBet" placeholderTextColor="#657286" autoCapitalize="none" style={styles.input} />
            <Text style={[styles.label, { marginTop: 14 }]}>{game.withdrawalCodeLabel}</Text>
            <TextInput value={withdrawalCode} onChangeText={(value) => { setWithdrawalCode(value); setError(""); }} placeholder="أدخل كود السحب" placeholderTextColor="#657286" autoCapitalize="none" style={styles.input} />
            <View className="mt-4 rounded-2xl border border-[#2A394D] bg-[#0B1018] px-4 py-3"><View style={[styles.summaryRow, { borderBottomWidth: 0 }]}><Text style={{ color: GOLD, fontSize: 13, fontWeight: "800" }}>إجمالي مبلغ السحب</Text><Text style={{ color: GOLD, fontSize: 17, fontWeight: "900", writingDirection: "ltr" }}>{formatMoney(withdrawAmount || "0")}</Text></View></View>
            <Text style={{ color: "#657286", fontSize: 10.5, lineHeight: 17, marginTop: 8, textAlign: "right" }}>تُراجع الإدارة الطلب قبل تنفيذ السحب، وتصلك النتيجة عبر الإشعارات.</Text>
            {!game.withdrawEnabled ? <Text style={{ color: RED, fontSize: 12, marginTop: 10, textAlign: "right" }}>خدمة السحب لهذه اللعبة متوقفة مؤقتًا.</Text> : null}
            {error ? <Text accessibilityRole="alert" style={{ color: RED, fontSize: 12, lineHeight: 20, marginTop: 10, textAlign: "right" }}>{error}</Text> : null}
            <View className="mt-4"><ActionButton label={withdraw.isPending ? "جارٍ إرسال الطلب…" : "تأكيد الطلب"} icon="checkmark-circle-outline" onPress={() => { if (!withdraw.isPending && game.withdrawEnabled) submitWithdraw(); }} /></View>
          </Card>
        )}

        <View className="mt-4 flex-row items-center gap-2 rounded-2xl border border-[#273548] bg-[#0E1723] px-4 py-3"><Ionicons name="shield-checkmark-outline" size={17} color="#47D7A5" /><Text style={{ color: "#B6C1CF", fontSize: 11, lineHeight: 18, flex: 1, textAlign: "right" }}>كل طلب له رقم مرجعي ويُراجع يدويًا. لا يتم خصم أي مبلغ من محفظتك قبل اعتماد الإدارة.</Text></View>
      </ScrollView>
    </Screen>
  );
}
