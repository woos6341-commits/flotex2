import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton, Card, Pill, Screen, formatMoney } from "@/components/atheer-ui";
import { LoginPanel } from "@/components/LoginPanel";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { calculateExpectedInterestAtRate, formatExpectedSavingsInterest, getSavingsMinimumFundingShortfallMinor, getSavingsProduct, roundInterestToWallet, SAVINGS_FREQUENCIES, type SavingsFrequency } from "@/shared/savings";
import { SAVINGS_SETTINGS_DEFAULTS, ratePercentToPpm } from "@/shared/savings-settings";
import { formatMoneyMinorUnits, tryParseMoneyMinorUnits } from "@/shared/transactions";
import { formatMoneyAmount } from "@/lib/currency";

const GOLD = "#D7A948";
const GOLD_LIGHT = "#E9C97E";
const GREEN = "#47D7A5";
const MUTED = "#9BA8B8";

const FREQUENCY_ICONS: Record<SavingsFrequency, keyof typeof Ionicons.glyphMap> = {
  daily: "sunny-outline",
  monthly: "calendar-outline",
  yearly: "moon-outline",
};

const inputStyle = {
  minHeight: 50,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 16,
  backgroundColor: "#0B1018",
  color: "#F7F1E3",
  paddingHorizontal: 15,
  paddingVertical: 10,
  fontSize: 16,
  textAlign: "right" as const,
  writingDirection: "ltr" as const,
};

export default function SavingsScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = width <= 380;
  const tight = width <= 340 || height <= 720;
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const keyboardOffset = Platform.OS === "ios" ? Math.max(0, keyboardHeight - insets.bottom) : 0;
  const [frequency, setFrequency] = useState<SavingsFrequency>("daily");
  const [amount, setAmount] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const operationRef = useRef<{ fingerprint: string; id: string } | null>(null);
  // Do not refetch financial queries when the native keyboard changes the window
  // focus/size. On Android that transition can rebuild the query result while the
  // user is typing and cause the controlled TextInput to lose native focus.
  const portfolio = trpc.portfolio.get.useQuery(undefined, { enabled: Boolean(user), refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const create = trpc.savings.create.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.savings.mine.invalidate(), utils.portfolio.get.invalidate()]);
      showFinancialMessage("تم استلام طلب الادخار", "تم حجز المبلغ مؤقتًا، والطلب قيد المراجعة وبانتظار الموافقة، ولم يتم خصم أي مبلغ نهائيًا حتى الآن.");
      router.push("/savings-history");
    },
    onError: (error) => showFinancialMessage("تعذر إنشاء الادخار", error.message),
  });
  const settings = trpc.savings.settings.useQuery(undefined, { enabled: Boolean(user), refetchOnWindowFocus: false });
  const product = getSavingsProduct(frequency);
  const feeAmount = settings.data?.feeAmount ?? SAVINGS_SETTINGS_DEFAULTS.feeAmount;
  const minimumAmount = settings.data?.minimumAmount ?? SAVINGS_SETTINGS_DEFAULTS.minimumAmount;
  const ratePercent = settings.data?.[`${frequency}RatePercent`] ?? product.ratePercent;
  const validAmount = useMemo(() => tryParseMoneyMinorUnits(amount), [amount]);
  const minimumMinor = tryParseMoneyMinorUnits(minimumAmount) ?? 0;
  const feeMinor = tryParseMoneyMinorUnits(feeAmount) ?? 0;
  const availableValue = portfolio.data?.available?.available;
  const availableMinor = useMemo(
    () => typeof availableValue === "string" ? tryParseMoneyMinorUnits(availableValue) : null,
    [availableValue],
  );
  const minimumFundingShortfallMinor = useMemo(
    () => getSavingsMinimumFundingShortfallMinor(minimumAmount, feeAmount, typeof availableValue === "string" ? availableValue : null),
    [minimumAmount, feeAmount, availableValue],
  );
  const minimumFundingUnavailable = !portfolio.isLoading && !portfolio.isError && !settings.isLoading && !settings.isError
    && minimumFundingShortfallMinor !== null && minimumFundingShortfallMinor > 0;
  const expected = useMemo(
    () => amount && validAmount !== null ? calculateExpectedInterestAtRate(amount, ratePercentToPpm(ratePercent)) : "0.0000",
    [amount, validAmount, ratePercent],
  );
  const expectedDisplay = formatExpectedSavingsInterest(expected);
  const totalAtApproval = validAmount !== null ? formatMoneyMinorUnits(validAmount + feeMinor) : "0.00";
  const expectedInterestMinor = tryParseMoneyMinorUnits(roundInterestToWallet(expected)) ?? 0;
  const netExpectedMinor = validAmount !== null ? validAmount + expectedInterestMinor - feeMinor : 0;
  const netExpected = `${netExpectedMinor < 0 ? "−" : ""}${formatMoneyMinorUnits(Math.abs(netExpectedMinor))}`;

  const quickAmounts = useMemo(() => {
    const base = Math.max(minimumMinor, 10000);
    const values = Array.from(new Set([minimumMinor, base, base * 5, base * 10, base * 25].filter((value) => value > 0)));
    const affordableValues = availableMinor === null ? values : values.filter((value) => value + feeMinor <= availableMinor);
    return affordableValues.slice(0, compact ? 4 : 5);
  }, [minimumMinor, compact, availableMinor, feeMinor]);

  const submitSavingsRequest = () => {
    if (create.isPending) return;
    if (portfolio.isLoading || settings.isLoading) {
      showFinancialMessage("جارٍ تحميل بيانات الادخار", "انتظر لحظات حتى يظهر رصيدك وإعدادات الادخار ثم أعد المحاولة.");
      return;
    }
    if (portfolio.isError || settings.isError || availableMinor === null) {
      showFinancialMessage("تعذر التحقق من رصيدك", "لم يُرسل أي طلب. أعد تحميل الرصيد والإعدادات أولًا.");
      return;
    }
    if (minimumFundingShortfallMinor !== null && minimumFundingShortfallMinor > 0) {
      showFinancialMessage(
        "الرصيد لا يغطي الحد الأدنى",
        `الحد الأدنى مع رسوم الطلب هو ${formatMoneyMinorUnits(minimumMinor + feeMinor)} ج.م، ورصيدك المتاح ${formatMoneyMinorUnits(availableMinor)} ج.م. ينقصك ${formatMoneyMinorUnits(minimumFundingShortfallMinor)} ج.م إضافية.`,
      );
      return;
    }
    if (validAmount === null || validAmount <= 0) {
      showFinancialMessage("مبلغ غير صالح", "أدخل مبلغ ادخار أكبر من صفر.");
      return;
    }
    if (validAmount < minimumMinor) {
      showFinancialMessage("المبلغ أقل من الحد الأدنى", `الحد الأدنى الحالي لطلب الادخار هو ${formatMoney(minimumAmount)}.`);
      return;
    }
    const requiredMinor = validAmount + feeMinor;
    if (requiredMinor > availableMinor) {
      showFinancialMessage("الرصيد غير كافٍ", `الرصيد المتاح لا يغطي أصل الادخار ورسوم الاعتماد (${formatMoneyMinorUnits(requiredMinor)} ج.م).`);
      return;
    }

    const fingerprint = `${frequency}:${amount.trim()}`;
    if (!operationRef.current || operationRef.current.fingerprint !== fingerprint) {
      operationRef.current = { fingerprint, id: `SAV-CLIENT-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
    }
    create.mutate({ frequency, amount, clientOperationId: operationRef.current.id });
  };

  if (loading) return <Screen title="الادخار"><View className="flex-1 items-center justify-center"><ActivityIndicator color={GOLD} /></View></Screen>;
  if (!user) return <Screen title="الادخار"><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom, 12) + 16 }}><LoginPanel /></ScrollView></Screen>;

  return (
    <Screen title="الادخار" subtitle="اختر خطتك وراجع التفاصيل قبل تأكيد الطلب" compact={compact}>
      <View style={{ flex: 1, width: "100%", minHeight: 0 }}>
        <ScrollView keyboardAware={Platform.OS !== "android"} keyboardGap={88} keyboardDismissMode="none" keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false} style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingBottom: compact ? 6 : 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: compact ? 8 : 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="كيفية الادخار" onPress={() => router.push("/savings-how-to")} style={({ pressed }) => [savingsStyles.navButtonSecondary, compact && savingsStyles.navButtonCompact, pressed && savingsStyles.pressed]}>
              <Ionicons name="help-circle-outline" size={compact ? 14 : 16} color={GOLD} />
              <Text style={[savingsStyles.navText, compact && savingsStyles.navTextCompact]}>كيفية الادخار</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="سجل الادخار" onPress={() => router.push("/savings-history")} style={({ pressed }) => [savingsStyles.navButton, compact && savingsStyles.navButtonCompact, pressed && savingsStyles.pressed]}>
              <Ionicons name="time-outline" size={compact ? 14 : 16} color={GOLD} />
              <Text style={[savingsStyles.navHighlight, compact && savingsStyles.navTextCompact]}>سجل الادخار</Text>
            </Pressable>
          </View>

          <View style={[savingsStyles.hero, compact && { padding: 14, borderRadius: 22 }]}>
            <View style={savingsStyles.heroGlow} />
            <View style={savingsStyles.heroGlowSmall} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <View style={[savingsStyles.walletIcon, compact && { width: 34, height: 34, borderRadius: 12 }]}><Ionicons name="wallet-outline" size={compact ? 17 : 20} color={GOLD} /></View>
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Pill tone={portfolio.isError ? "red" : "green"}>{portfolio.isError ? "غير متاح" : "متاح الآن"}</Pill>
                  <Text style={savingsStyles.heroTitle}>رصيدك المتاح للادخار</Text>
                </View>
                <Text style={savingsStyles.heroMeta}>يتحقق الخادم من المبلغ قبل تسجيل أي طلب</Text>
              </View>
            </View>
            <View style={savingsStyles.heroAmountRow}>
              <Text style={savingsStyles.heroCurrency}>ج.م</Text>
              {portfolio.isLoading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل الرصيد المتاح" color={GOLD} /> : (
                <Text accessibilityLabel={`الرصيد المتاح ${formatMoney(portfolio.data?.available?.available)}`} style={[savingsStyles.heroAmount, compact && { fontSize: 28 }]}>
                  {portfolio.isError ? "—" : formatMoneyAmount(portfolio.data?.available?.available)}
                </Text>
              )}
            </View>
            <View style={savingsStyles.heroStats}>
              <View style={savingsStyles.heroStat}><Text style={savingsStyles.heroStatValue}>{formatMoney(minimumAmount)}</Text><Text style={savingsStyles.heroStatLabel}>الحد الأدنى</Text></View>
              <View style={savingsStyles.heroStatDivider} />
              <View style={savingsStyles.heroStat}><Text style={savingsStyles.heroStatValue}>{formatMoney(feeAmount)}</Text><Text style={savingsStyles.heroStatLabel}>رسوم الطلب</Text></View>
              <View style={savingsStyles.heroStatDivider} />
              <View style={savingsStyles.heroStat}><Text style={savingsStyles.heroStatValue}>{ratePercent}%</Text><Text style={savingsStyles.heroStatLabel}>عائد {product.label}</Text></View>
            </View>
            {portfolio.isError ? <View className="mt-3"><ActionButton label="إعادة تحميل الرصيد" icon="refresh-outline" secondary onPress={() => void portfolio.refetch()} /></View> : null}
          </View>

          <Card style={savingsStyles.card} className={compact ? "mt-2 p-3" : "mt-4 p-4"}>
            <SectionHeading step="01" title="اختر خطة الادخار" subtitle="قارن دورية العائد والنسبة الحالية" compact={compact} />
            <View style={{ flexDirection: "row", gap: compact ? 5 : 8, marginTop: compact ? 8 : 14 }}>
              {SAVINGS_FREQUENCIES.map((item) => {
                const selected = item === frequency;
                const option = getSavingsProduct(item);
                const rate = settings.data?.[`${item}RatePercent`] ?? option.ratePercent;
                return (
                  <Pressable key={item} onPress={() => setFrequency(item)} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [savingsStyles.planCard, compact && savingsStyles.planCardCompact, selected && savingsStyles.planSelected, pressed && savingsStyles.pressed]}>
                    {selected ? <View style={savingsStyles.planCheck}><Ionicons name="checkmark" size={11} color="#0B1018" /></View> : null}
                    <View style={[savingsStyles.planIcon, selected && savingsStyles.planIconSelected]}><Ionicons name={FREQUENCY_ICONS[item]} size={compact ? 15 : 18} color={selected ? "#0B1018" : GOLD} /></View>
                    <Text style={[savingsStyles.planLabel, selected && { color: GOLD_LIGHT }]}>{option.label}</Text>
                    <Text style={[savingsStyles.planRate, selected && { color: "#FFFFFF" }]}>{rate}%</Text>
                    <Text style={savingsStyles.planPeriod}>{option.periodLabel}</Text>
                  </Pressable>
                );
              })}
            </View>
            {settings.isError ? <Text accessibilityRole="alert" className="mt-3 text-xs leading-5 text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل إعدادات الادخار؛ لن يُرسل طلب قبل التحقق منها.</Text> : null}
          </Card>

          <Card style={savingsStyles.card} className={compact ? "mt-2 p-3" : "mt-4 p-4"}>
            <SectionHeading step="02" title="حدد مبلغ الادخار" subtitle="المبلغ بالجنيه المصري · حتى منزلتين عشريتين" compact={compact} />
            <View style={[savingsStyles.amountWrap, amountFocused && savingsStyles.amountWrapFocused, compact && { minHeight: 54, marginTop: 8 }]}>
              <Text style={savingsStyles.amountCurrency}>ج.م</Text>
              <TextInput
                accessibilityLabel="مبلغ الادخار"
                accessibilityHint="أدخل المبلغ بالجنيه المصري حتى منزلتين عشريتين"
                value={amount}
                onChangeText={setAmount}
                onFocus={() => setAmountFocused(true)}
                onBlur={() => setAmountFocused(false)}
                placeholder="0.00"
                placeholderTextColor="#4F5D70"
                inputMode="decimal"
                keyboardType="decimal-pad"
                showSoftInputOnFocus={true}
                blurOnSubmit={false}
                autoCorrect={false}
                returnKeyType="done"
                selectionColor={GOLD}
                style={[inputStyle, savingsStyles.amountInput, compact && { fontSize: 24 }]}
              />
            </View>
            <View style={[savingsStyles.profitBanner, compact && { padding: 10, marginTop: 8 }]}>
              <View style={savingsStyles.profitIcon}><Ionicons name="trending-up" size={18} color={GREEN} /></View>
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={savingsStyles.profitLabel}>العائد المتوقع · {product.label}</Text>
                {settings.isLoading ? <ActivityIndicator accessibilityLabel="جارٍ تحميل نسبة العائد" size="small" color={GREEN} /> : (
                  <Text accessibilityLabel={`العائد المتوقع ${expectedDisplay} جنيه مصري`} style={[savingsStyles.profitValue, compact && { fontSize: 22 }]}>{expectedDisplay} <Text style={savingsStyles.profitCurrency}>ج.م</Text></Text>
                )}
              </View>
            </View>
            <View style={savingsStyles.quickRow}>
              {quickAmounts.map((value) => (
                <Pressable key={value} accessibilityRole="button" accessibilityLabel={`استخدام مبلغ ${formatMoneyMinorUnits(value)} جنيه`} onPress={() => setAmount(formatMoneyMinorUnits(value))} style={({ pressed }) => [savingsStyles.quickChip, pressed && savingsStyles.pressed]}>
                  <Text style={savingsStyles.quickChipText}>{formatMoneyMinorUnits(value)}</Text>
                </Pressable>
              ))}
            </View>
            {validAmount === null && amount.length > 0 ? <Text className="mt-2 text-xs leading-5 text-[#FF7D8D]" style={{ textAlign: "right" }}>أدخل مبلغًا صحيحًا حتى منزلتين عشريتين.</Text> : null}
            <View style={savingsStyles.hintRow}>
              <Ionicons name="information-circle-outline" size={14} color={MUTED} />
              <Text style={savingsStyles.hintText}>الحد الأدنى الحالي: {formatMoney(minimumAmount)} · يمكنك تعديل المبلغ في أي وقت قبل الإرسال</Text>
            </View>
            {minimumFundingUnavailable && minimumFundingShortfallMinor !== null ? (
              <View accessibilityRole="alert" style={savingsStyles.fundingNotice}>
                <Text style={savingsStyles.fundingNoticeText}>
                  لا يمكن بدء طلب الادخار الآن: الحد الأدنى مع الرسوم هو {formatMoneyMinorUnits(minimumMinor + feeMinor)} ج.م، ورصيدك المتاح {formatMoneyMinorUnits(availableMinor ?? 0)} ج.م. ينقصك {formatMoneyMinorUnits(minimumFundingShortfallMinor)} ج.م.
                </Text>
                <Text accessibilityRole="link" accessibilityLabel={`إيداع المبلغ الناقص ${formatMoneyMinorUnits(minimumFundingShortfallMinor)} جنيه`} onPress={() => router.push("/deposit")} style={savingsStyles.fundingNoticeLink}>إيداع المبلغ الناقص</Text>
              </View>
            ) : null}
          </Card>

          <Card style={savingsStyles.summaryCard} className={compact ? "mt-2 p-3" : "mt-4 p-4"}>
            <SectionHeading step="03" title="ملخص طلبك" subtitle="مبالغ واضحة قبل تأكيد الطلب" compact={compact} />
            <View style={{ marginTop: 6 }}>
              <SummaryRow label="أصل الادخار" value={`${validAmount !== null ? formatMoneyAmount(amount) : "0.00"} ج.م`} />
              <SummaryRow label="رسوم الطلب عند الموافقة" value={`${formatMoneyAmount(feeAmount)} ج.م`} />
              <SummaryRow label="إجمالي الخصم عند الموافقة" value={`${totalAtApproval} ج.م`} tone="gold" />
              <SummaryRow label="الصافي التقديري بعد أول عائد والرسوم" value={`${netExpected} ج.م`} tone="green" emphasis />
            </View>
            <View className={`${compact ? "mt-2 p-2" : "mt-3 p-3"} rounded-xl border border-[#273548] bg-[#0B1018]`}>
              <Text className={`${tight ? "text-[9px] leading-3" : compact ? "text-[11px] leading-4" : "text-xs leading-5"} text-[#B6C1CF]`} style={{ textAlign: "right" }}>
                الحد الأدنى {formatMoney(minimumAmount)} · {product.maturityLabel} ويُقرب العائد الفعلي لأقرب قرش؛ يبدأ الخصم النهائي بعد الموافقة، وأصل المبلغ قابل للاسترداد بعد 48 ساعة.
              </Text>
            </View>
          </Card>
        </ScrollView>
        <View style={[savingsStyles.submitDock, compact && savingsStyles.submitDockCompact, { paddingBottom: Math.max(insets.bottom, compact ? 8 : 12), marginBottom: keyboardOffset }]}>
          <View style={{ width: "100%", maxWidth: 1024, alignSelf: "center" }}>
            <ActionButton label={create.isPending ? "جارٍ إرسال الطلب..." : "تأكيد طلب الادخار"} icon="pie-chart-outline" onPress={submitSavingsRequest} />
            <Text className={`text-center text-[#8190A2] ${compact ? "mt-1 px-1 text-[10px] leading-4" : "mt-2 px-2 text-xs leading-5"}`}>لن يُخصم أي مبلغ نهائيًا قبل الموافقة. يمكنك متابعة حالة الطلب من سجل الادخار.</Text>
          </View>
        </View>
      </View>
    </Screen>
  );
}

function SectionHeading({ step, title, subtitle, compact = false }: { step: string; title: string; subtitle: string; compact?: boolean }) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <View style={[savingsStyles.stepBadge, compact && savingsStyles.stepBadgeCompact]}><Text className={`${compact ? "text-[10px]" : "text-xs"} font-bold text-[#E3BB66]`}>{step}</Text></View>
      <View className="flex-1">
        <Text className={`${compact ? "text-sm" : "text-base"} font-bold text-[#F7F1E3]`} style={{ textAlign: "right" }}>{title}</Text>
        <Text className={`${compact ? "mt-0.5 text-[10px] leading-3" : "mt-1 text-xs leading-5"} text-[#9BA8B8]`} style={{ textAlign: "right" }}>{subtitle}</Text>
      </View>
    </View>
  );
}

function SummaryRow({ label, value, tone, emphasis = false }: { label: string; value: string; tone?: "gold" | "green"; emphasis?: boolean }) {
  const color = tone === "green" ? GREEN : tone === "gold" ? GOLD_LIGHT : "#F7F1E3";
  return (
    <View style={[savingsStyles.summaryRow, emphasis && savingsStyles.summaryRowEmphasis]}>
      <Text style={[savingsStyles.summaryValue, { color }, emphasis && { fontSize: 15, fontWeight: "800" }]}>{value}</Text>
      <Text style={savingsStyles.summaryLabel}>{label}</Text>
    </View>
  );
}

const savingsStyles = StyleSheet.create({
  submitDock: { zIndex: 20, borderTopWidth: 1, borderTopColor: "#273548", backgroundColor: "#0B1018", paddingTop: 10, shadowColor: "#000000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 8 },
  submitDockCompact: { paddingTop: 6 },
  navButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: "#D7A94866", backgroundColor: "#D7A94812" },
  navButtonSecondary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28" },
  navButtonCompact: { gap: 4, paddingHorizontal: 9, paddingVertical: 6 },
  navHighlight: { color: GOLD, fontSize: 12, fontWeight: "700" },
  navText: { color: "#F7F1E3", fontSize: 12, fontWeight: "700" },
  navTextCompact: { fontSize: 10 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  hero: { borderRadius: 26, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#161F2C", padding: 18, overflow: "hidden", shadowColor: "#000000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 4 },
  heroGlow: { position: "absolute", width: 230, height: 230, borderRadius: 115, backgroundColor: "#D7A94814", top: -120, left: -70 },
  heroGlowSmall: { position: "absolute", width: 110, height: 110, borderRadius: 55, backgroundColor: "#47D7A50D", bottom: -50, right: -30 },
  heroTitle: { color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right" },
  heroMeta: { color: MUTED, fontSize: 10.5, marginTop: 3, textAlign: "right" },
  walletIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#D7A94814" },
  heroAmountRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#3B3424", marginTop: 14, paddingTop: 12 },
  heroCurrency: { color: MUTED, fontSize: 12, fontWeight: "700" },
  heroAmount: { color: GOLD_LIGHT, fontSize: 34, fontWeight: "900", textAlign: "right", writingDirection: "ltr", fontVariant: ["tabular-nums"] },
  heroStats: { flexDirection: "row", alignItems: "center", marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0E1723", paddingVertical: 9 },
  heroStat: { flex: 1, alignItems: "center", gap: 2 },
  heroStatValue: { color: "#F7F1E3", fontSize: 12.5, fontWeight: "800", writingDirection: "ltr", fontVariant: ["tabular-nums"] },
  heroStatLabel: { color: MUTED, fontSize: 9.5 },
  heroStatDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: "#273548" },
  card: { shadowColor: "#000000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 8, elevation: 2 },
  summaryCard: { backgroundColor: "#13212B", borderColor: "#2B4548", shadowColor: "#000000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 8, elevation: 2 },
  planCard: { flex: 1, minHeight: 112, alignItems: "center", justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", paddingHorizontal: 5, paddingVertical: 10, gap: 3 },
  planCardCompact: { minHeight: 94, borderRadius: 14, paddingVertical: 7 },
  planSelected: { borderColor: GOLD, backgroundColor: "#D7A94814" },
  planCheck: { position: "absolute", top: 6, left: 6, width: 17, height: 17, borderRadius: 9, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" },
  planIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#D7A94814", marginBottom: 2 },
  planIconSelected: { backgroundColor: GOLD },
  planLabel: { color: "#C4CEDB", fontSize: 12, fontWeight: "700" },
  planRate: { color: "#F7F1E3", fontSize: 17, fontWeight: "900", writingDirection: "ltr" },
  planPeriod: { color: "#8190A2", fontSize: 9.5, textAlign: "center" },
  amountWrap: { flexDirection: "row", alignItems: "center", marginTop: 14, minHeight: 66, borderRadius: 18, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", paddingHorizontal: 16 },
  amountWrapFocused: { borderColor: GOLD, backgroundColor: "#101A26", shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.16, shadowRadius: 6, elevation: 1 },
  amountInput: { flex: 1, borderWidth: 0, backgroundColor: "transparent", minHeight: 52, fontSize: 30, fontWeight: "800", paddingHorizontal: 4, paddingVertical: 0, textAlign: "right" },
  amountCurrency: { color: MUTED, fontSize: 13, fontWeight: "700", marginLeft: 6 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  quickChip: { borderRadius: 999, borderWidth: 1, borderColor: "#2A394D", backgroundColor: "#121B28", paddingHorizontal: 11, paddingVertical: 6 },
  quickChipText: { color: GOLD_LIGHT, fontSize: 11, fontWeight: "700", writingDirection: "ltr" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  hintText: { color: MUTED, fontSize: 10.5, flex: 1, textAlign: "right", lineHeight: 16 },
  fundingNotice: { marginTop: 10, borderWidth: 1, borderColor: "#5C4A28", borderRadius: 14, backgroundColor: "#D7A94810", padding: 10, gap: 6 },
  fundingNoticeText: { color: "#E9C97E", fontSize: 10.5, lineHeight: 17, textAlign: "right" },
  fundingNoticeLink: { alignSelf: "flex-end", color: GOLD_LIGHT, fontSize: 11, fontWeight: "800", paddingVertical: 3, textDecorationLine: "underline" },
  profitBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: "#2B4548", backgroundColor: "#0D191F", padding: 12 },
  profitIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#47D7A514" },
  profitLabel: { color: MUTED, fontSize: 10.5, fontWeight: "600", textAlign: "right" },
  profitValue: { color: GREEN, fontSize: 26, fontWeight: "900", writingDirection: "ltr", fontVariant: ["tabular-nums"], marginTop: 1 },
  profitCurrency: { color: MUTED, fontSize: 12, fontWeight: "600" },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#273548" },
  summaryRowEmphasis: { borderBottomWidth: 0, marginTop: 4, borderRadius: 10, backgroundColor: "#47D7A50F", paddingHorizontal: 8 },
  summaryValue: { fontSize: 13, fontWeight: "700", writingDirection: "ltr", fontVariant: ["tabular-nums"], maxWidth: "58%", textAlign: "left" },
  summaryLabel: { color: MUTED, fontSize: 11.5, maxWidth: "58%", textAlign: "right" },
  stepBadge: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#D7A94812" },
  stepBadgeCompact: { width: 26, height: 26, borderRadius: 9 },
});
