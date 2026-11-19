import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActionButton, Card, EmptyState, Pill, Screen, formatMoney } from "@/components/atheer-ui";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { formatGameQuantity, parseGameQuantity, resolveGameImageUrl } from "@/lib/game-topup";

const GOLD = "#D7A948";
const MUTED = "#9BA8B8";
const GREEN = "#47D7A5";

const styles = StyleSheet.create({
  hero: { borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: "#2A394D", backgroundColor: "#111B28" },
  heroImage: { width: "100%", height: 156 },
  heroFallback: { width: "100%", height: 156, alignItems: "center", justifyContent: "center", backgroundColor: "#1A2433" },
  heroOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 40, paddingBottom: 14, backgroundColor: "#0B1018B8" },
  heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", textAlign: "right", textShadowColor: "#00000088", textShadowRadius: 6 },
  heroMeta: { color: "#E6D8B8", fontSize: 12, marginTop: 4, textAlign: "right" },
  segment: { flexDirection: "row", gap: 6, borderRadius: 16, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", padding: 4 },
  segmentItem: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 9 },
  segmentActive: { backgroundColor: "#D7A948" },
  segmentText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  segmentTextActive: { color: "#0B1018" },
  packageGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8, marginTop: 12 },
  packageCard: { borderRadius: 16, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0E1723", paddingHorizontal: 12, paddingVertical: 11 },
  packageActive: { borderColor: GOLD, backgroundColor: "#D7A94818" },
  packageQty: { color: "#F7F1E3", fontSize: 14, fontWeight: "800", textAlign: "right" },
  packagePrice: { color: GOLD, fontSize: 13, fontWeight: "800", marginTop: 4, textAlign: "right" },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#273548", borderRadius: 14, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, textAlign: "right", writingDirection: "rtl" },
  inputFocused: { borderColor: GOLD, backgroundColor: "#111A25" },
  label: { color: "#D8DEE8", fontSize: 12.5, fontWeight: "700", textAlign: "right", marginBottom: 7 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#273548" },
  rowLabel: { color: MUTED, fontSize: 12.5 },
  rowValue: { color: "#F7F1E3", fontSize: 13.5, fontWeight: "700", writingDirection: "ltr", fontVariant: ["tabular-nums"] },
  total: { color: GOLD, fontSize: 28, fontWeight: "900", writingDirection: "ltr", fontVariant: ["tabular-nums"] },
  chip: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, backgroundColor: "#47D7A518", paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { color: GREEN, fontSize: 10.5, fontWeight: "700" },
  error: { color: "#FF7D8D", fontSize: 12, lineHeight: 19, textAlign: "right", marginTop: 10 },
});

export default function GameTopupOrderScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : Array.isArray(params.slug) ? params.slug[0] : "";
  const router = useRouter();
  const { width } = useWindowDimensions();
  const packageWidth = width >= 700 ? "31.5%" : "48.7%";
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const catalog = trpc.gameTopup.catalog.useQuery(undefined, { enabled: Boolean(user) });
  const overview = trpc.gameTopup.overview.useQuery(undefined, { enabled: Boolean(user), refetchOnWindowFocus: true });
  const game = catalog.data?.games.find((item) => item.slug === slug) ?? null;
  const [mode, setMode] = useState<"package" | "custom">("package");
  const [packageId, setPackageId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const operationRef = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    if (!game) return;
    const timer = setTimeout(() => {
      setPackageId((current) => current && game.packages.some((item) => item.id === current) ? current : (game.packages[0]?.id ?? null));
      setMode(game.packages.length ? "package" : "custom");
      setFields((current) => {
        const next = { ...current };
        for (const field of game.fields) if (!(field.key in next)) next[field.key] = "";
        return next;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [game]);

  const selectedPackage = game?.packages.find((item) => item.id === packageId) ?? null;
  const customQuantity = parseGameQuantity(quantity);
  const unitPrice = game ? Number(game.unitPrice) : 0;
  const serviceFee = catalog.data?.fee?.enabled ? Number(catalog.data.fee.amount) : 0;
  const computedSubtotal = useMemo(() => {
    if (!game) return 0;
    if (mode === "package" && selectedPackage) return Number(selectedPackage.price);
    if (!customQuantity) return 0;
    return Math.round(customQuantity * unitPrice * 100) / 100;
  }, [game, mode, selectedPackage, customQuantity, unitPrice]);
  const computedTotal = computedSubtotal > 0 ? Math.round((computedSubtotal + serviceFee) * 100) / 100 : 0;
  const computedQuantity = mode === "package" ? selectedPackage?.quantity ?? 0 : customQuantity ?? 0;
  const available = Number(overview.data?.wallet.available ?? 0);

  const create = trpc.gameTopup.create.useMutation({
    onSuccess: async (result) => {
      await Promise.all([utils.gameTopup.overview.invalidate(), utils.gameTopup.mine.invalidate(), utils.portfolio.get.invalidate()]);
      showFinancialMessage("تم إرسال طلب الشحن", result.message);
      router.replace("/game-topup/history" as never);
    },
    onError: (error) => {
      setErrorText(error.message);
      showFinancialMessage("تعذر إرسال طلب الشحن", error.message);
    },
  });

  if (catalog.isLoading) {
    return <Screen title="شحن الألعاب"><View className="flex-1 items-center justify-center"><ActivityIndicator color={GOLD} /></View></Screen>;
  }
  if (!game) {
    return (
      <Screen title="شحن الألعاب">
        <EmptyState title="اللعبة غير متاحة" text="ربما تم إخفاؤها من لوحة الإدارة. ارجع إلى قائمة الألعاب واختر لعبة أخرى." />
        <View className="mt-4"><ActionButton label="العودة إلى الألعاب" icon="arrow-forward" onPress={() => router.replace("/game-topup" as never)} /></View>
      </Screen>
    );
  }

  const submit = () => {
    setErrorText(null);
    if (!game.packages.length && mode === "package") {
      setErrorText("لا توجد باقات جاهزة لهذه اللعبة؛ اختر كمية مخصصة.");
      return;
    }
    if (mode === "custom") {
      if (!customQuantity) { setErrorText("أدخل كمية صحيحة أكبر من صفر."); return; }
      if (customQuantity < game.minQuantity) { setErrorText(`أقل كمية متاحة لهذه اللعبة هي ${formatGameQuantity(game.minQuantity, game.currencyLabel)}.`); return; }
    }
    for (const field of game.fields) {
      if (field.required && !fields[field.key]?.trim()) { setErrorText(`أدخل ${field.label}.`); return; }
    }
    if (computedTotal <= 0) { setErrorText("تعذر حساب قيمة الطلب؛ راجع الكمية أو الباقة."); return; }
    if (available > 0 && computedTotal > available) { setErrorText("رصيد محفظتك غير كافٍ لإتمام الطلب"); return; }
    const fingerprint = JSON.stringify({ game: game.id, mode, packageId: mode === "package" ? packageId : null, quantity: mode === "custom" ? customQuantity : null, fields });
    if (!operationRef.current || operationRef.current.fingerprint !== fingerprint) {
      operationRef.current = { fingerprint, id: `GT-CLIENT-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
    }
    create.mutate({
      gameId: game.id,
      packageId: mode === "package" ? packageId : null,
      quantity: mode === "custom" ? customQuantity : null,
      fields,
      idempotencyKey: operationRef.current.id,
    });
  };

  const image = resolveGameImageUrl(game.imageUrl);
  const balanceEnough = available >= computedTotal && computedTotal > 0;

  return (
    <Screen title="شحن الألعاب" subtitle="اختر الباقة وأدخل بيانات اللاعب">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="mb-3 flex-row items-center justify-between">
          <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى الألعاب" onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-2xl border border-[#2A394D] bg-[#121B28]">
            <Ionicons name="arrow-forward" size={19} color={GOLD} />
          </Pressable>
          <Pill tone={catalog.data?.enabled === false ? "red" : "green"}>{catalog.data?.enabled === false ? "الخدمة متوقفة" : "الخدمة متاحة"}</Pill>
        </View>

        <View style={styles.hero}>
          {image ? <Image source={{ uri: image }} style={styles.heroImage} contentFit="cover" transition={180} /> : <View style={styles.heroFallback}><Ionicons name="game-controller-outline" size={44} color={GOLD} /></View>}
          <View style={styles.heroOverlay}>
            <Text style={styles.heroTitle}>{game.name}</Text>
            <Text style={styles.heroMeta}>{game.currencyLabel} · أقل كمية {game.minQuantity} · {game.packages.length} باقات</Text>
          </View>
        </View>

        <Card className="mt-3">
          <View className="flex-row items-center justify-between">
            <View style={styles.chip}><Ionicons name="wallet-outline" size={12} color={GREEN} /><Text style={styles.chipText}>المتاح {formatMoney(available)}</Text></View>
            <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right" }}>تفاصيل الطلب</Text>
          </View>

          <View style={[styles.segment, { marginTop: 14 }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === "package" }} onPress={() => { setMode("package"); setErrorText(null); }} style={[styles.segmentItem, mode === "package" && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === "package" && styles.segmentTextActive]}>الباقات الجاهزة</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === "custom" }} onPress={() => { setMode("custom"); setErrorText(null); }} style={[styles.segmentItem, mode === "custom" && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === "custom" && styles.segmentTextActive]}>كمية مخصصة</Text>
            </Pressable>
          </View>

          {mode === "package" ? (
            game.packages.length ? (
              <View style={styles.packageGrid}>
                {game.packages.map((item) => {
                  const active = item.id === packageId;
                  return (
                    <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { setPackageId(item.id); setErrorText(null); }} style={[styles.packageCard, { width: packageWidth }, active && styles.packageActive]}>
                      <Text style={styles.packageQty}>{formatGameQuantity(item.quantity, game.currencyLabel)}</Text>
                      <Text style={styles.packagePrice}>{formatMoney(item.price)}</Text>
                      {item.label && item.label !== formatGameQuantity(item.quantity, game.currencyLabel) ? <Text style={{ color: MUTED, fontSize: 10, marginTop: 3, textAlign: "right" }}>{item.label}</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={{ color: MUTED, fontSize: 12, marginTop: 14, textAlign: "right" }}>لا توجد باقات جاهزة حاليًا. استخدم «كمية مخصصة» أو تواصل مع الإدارة.</Text>
            )
          ) : (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.label}>الكمية المطلوبة ({game.currencyLabel})</Text>
              <TextInput
                accessibilityLabel="الكمية المطلوبة"
                value={quantity}
                onChangeText={(value) => { setQuantity(value.replace(/[^0-9]/g, "")); setErrorText(null); }}
                onFocus={() => setFocusedKey("quantity")}
                onBlur={() => setFocusedKey(null)}
                placeholder={`أقل كمية ${game.minQuantity}`}
                placeholderTextColor="#657286"
                keyboardType="number-pad"
                style={[styles.input, focusedKey === "quantity" && styles.inputFocused]}
              />
              <Text style={{ color: MUTED, fontSize: 11, marginTop: 7, textAlign: "right" }}>سعر الوحدة {formatMoney(game.unitPrice)} · يُحسب السعر تلقائيًا ويُتحقق منه على الخادم.</Text>
            </View>
          )}
        </Card>

        <Card className="mt-3">
          <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right" }}>بيانات اللاعب</Text>
          <Text style={{ color: MUTED, fontSize: 11, marginTop: 3, textAlign: "right" }}>تظهر الخانات التي يحددها المدير لكل لعبة</Text>
          <View style={{ marginTop: 12, gap: 12 }}>
            {game.fields.map((field) => (
              <View key={field.key}>
                <Text style={styles.label}>{field.label}{field.required ? " *" : ""}</Text>
                <TextInput
                  accessibilityLabel={field.label}
                  value={fields[field.key] ?? ""}
                  onChangeText={(value) => { setFields((current) => ({ ...current, [field.key]: value })); setErrorText(null); }}
                  onFocus={() => setFocusedKey(field.key)}
                  onBlur={() => setFocusedKey(null)}
                  placeholder={field.placeholder ?? field.label}
                  placeholderTextColor="#657286"
                  maxLength={120}
                  autoCapitalize="none"
                  style={[styles.input, focusedKey === field.key && styles.inputFocused]}
                />
              </View>
            ))}
          </View>
        </Card>

        <View accessibilityRole="text" className="mx-1 mt-2 flex-row items-center justify-end gap-2 rounded-xl border border-[#5C4A28]/70 bg-[#D7A948]/[0.06] px-3 py-2">
          <Text style={{ flex: 1, color: "#D6C79E", fontSize: 11, lineHeight: 17, textAlign: "right" }}>راجع بيانات الشحن ثم اضغط على تأكيد الطلب بالأسفل</Text>
          <Ionicons name="arrow-down-outline" size={18} color={GOLD} />
        </View>

        <Card className="mt-3" style={{ borderColor: "#5C4A28", backgroundColor: "#151C26" }}>
          <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right" }}>ملخص الطلب</Text>
          <View style={{ marginTop: 8 }}>
            <View style={styles.row}><Text style={styles.rowValue}>{computedQuantity ? formatGameQuantity(computedQuantity, game.currencyLabel) : "—"}</Text><Text style={styles.rowLabel}>الكمية</Text></View>
            <View style={styles.row}><Text style={styles.rowValue}>{mode === "custom" ? `${formatMoney(game.unitPrice)}` : selectedPackage ? `${formatMoney(selectedPackage.price)}` : "—"}</Text><Text style={styles.rowLabel}>{mode === "custom" ? "سعر الوحدة" : "سعر الباقة"}</Text></View>
            <View style={styles.row}><Text style={styles.rowValue}>{formatMoney(computedSubtotal)}</Text><Text style={styles.rowLabel}>قيمة الشحن</Text></View>
            <View style={styles.row}><Text style={[styles.rowValue, { color: serviceFee > 0 ? "#E9C97E" : MUTED }]}>{serviceFee > 0 ? `${formatMoney(serviceFee)}` : "معفاة"}</Text><Text style={styles.rowLabel}>رسوم الخدمة</Text></View>
            <View style={styles.row}><Text style={[styles.rowValue, { color: balanceEnough ? GREEN : computedTotal > 0 ? "#FF7D8D" : "#F7F1E3" }]}>{formatMoney(available)}</Text><Text style={styles.rowLabel}>رصيد المحفظة المتاح</Text></View>
            <View style={[styles.row, { borderBottomWidth: 0, paddingTop: 14 }]}><Text style={styles.total}>{formatMoney(computedTotal)}</Text><Text style={{ color: "#F7F1E3", fontSize: 14, fontWeight: "800" }}>الإجمالي</Text></View>
          </View>
          <View className="mt-2 rounded-xl border border-[#273548] bg-[#0B1018] p-3">
            <Text style={{ color: "#B6C1CF", fontSize: 11, lineHeight: 18, textAlign: "right" }}>عند التأكيد يُحجز الإجمالي (قيمة الشحن + رسوم الخدمة) من رصيدك المتاح فقط، ويُخصم نهائيًا بعد اعتماد الإدارة. عند الرفض يُعاد المبلغ المحجوز تلقائيًا. لا يُعلن اكتمال الشحن قبل تسجيل مرجع العملية.</Text>
          </View>
          {errorText ? <Text accessibilityRole="alert" style={styles.error}>{errorText}</Text> : null}
          <View className="mt-4">
            <ActionButton
              label={create.isPending ? "جارٍ إرسال الطلب…" : "تأكيد الطلب"}
              icon="game-controller-outline"
              onPress={() => { if (!create.isPending) submit(); }}
            />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
