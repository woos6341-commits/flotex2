import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { ActionButton, Card, EmptyState, Pill, formatMoney } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import { GAME_TOPUP_STATUS_TONE, formatGameQuantity, resolveGameImageUrl } from "@/lib/game-topup";
import { isPendingRecentOperation } from "@/shared/recent-operations";

const GOLD = "#D7A948";
const MUTED = "#9BA8B8";
const GREEN = "#47D7A5";
const RED = "#FF7D8D";

type GameFieldDraft = { key: string; label: string; placeholder?: string; required: boolean; type?: "text" | "number" };
type GameDraft = {
  id?: number;
  slug: string;
  name: string;
  serviceType: "topup" | "deposit_withdraw";
  currencyLabel: string;
  minQuantity: string;
  unitPrice: string;
  sortOrder: string;
  isActive: boolean;
  fields: GameFieldDraft[];
  depositFeeEnabled: boolean;
  depositFeeAmount: string;
  depositFeeMin: string;
  depositFeeMax: string;
  minDepositAmount: string;
  minWithdrawAmount: string;
  withdrawEnabled: boolean;
  withdrawalInstructions: string;
  cityLabel: string;
  cityPlaceholder: string;
  cityValue: string;
  streetLabel: string;
  streetPlaceholder: string;
  streetValue: string;
  withdrawalCodeLabel: string;
  userIdFieldLabel: string;
};
type RequestDraft = { reason: string; reference: string; note: string };

const STATUS_FILTERS = [
  { id: "pending", label: "قيد المتابعة" },
  { id: "archive", label: "الأرشيف" },
  { id: "all", label: "الكل" },
  { id: "new", label: "جديد" },
  { id: "under_review", label: "قيد المراجعة" },
  { id: "approved", label: "مقبول" },
  { id: "processing", label: "جارٍ التنفيذ" },
  { id: "completed", label: "مكتمل" },
  { id: "rejected", label: "مرفوض" },
  { id: "cancelled", label: "ملغي" },
] as const;

const EMPTY_GAME: GameDraft = {
  slug: "",
  name: "",
  serviceType: "topup",
  currencyLabel: "جوهرة",
  minQuantity: "1",
  unitPrice: "1.00",
  sortOrder: "99",
  isActive: true,
  fields: [{ key: "playerId", label: "Player ID", placeholder: "أدخل رقم اللاعب", required: true }],
  depositFeeEnabled: true,
  depositFeeAmount: "0.00",
  depositFeeMin: "0.00",
  depositFeeMax: "0.00",
  minDepositAmount: "50.00",
  minWithdrawAmount: "50.00",
  withdrawEnabled: true,
  withdrawalInstructions: "",
  cityLabel: "المدينة",
  cityPlaceholder: "أدخل المدينة",
  cityValue: "",
  streetLabel: "الشارع",
  streetPlaceholder: "أدخل الشارع",
  streetValue: "",
  withdrawalCodeLabel: "أدخل كود السحب",
  userIdFieldLabel: "ID المستخدم",
};

const styles = StyleSheet.create({
  tab: { flex: 1, alignItems: "center", borderRadius: 12, paddingVertical: 9 },
  tabActive: { backgroundColor: "#D7A948" },
  tabText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: "#0B1018" },
  input: { minHeight: 44, borderWidth: 1, borderColor: "#273548", borderRadius: 12, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, textAlign: "right", writingDirection: "rtl" },
  inputSmall: { minHeight: 38, borderWidth: 1, borderColor: "#273548", borderRadius: 10, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 9, paddingVertical: 6, fontSize: 12, textAlign: "right", writingDirection: "ltr" },
  label: { color: "#C8D0DB", fontSize: 11.5, fontWeight: "700", textAlign: "right", marginBottom: 5 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 5 },
  rowLabel: { color: MUTED, fontSize: 11.5 },
  rowValue: { color: "#F7F1E3", fontSize: 12, fontWeight: "700", writingDirection: "ltr" },
  mini: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 11, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  miniText: { fontSize: 11.5, fontWeight: "800" },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { fontSize: 11, fontWeight: "700" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#273548", marginVertical: 10 },
  image: { width: 56, height: 56, borderRadius: 14, backgroundColor: "#1A2433" },
});

function fieldInputStyle() {
  return styles.input;
}

function MiniButton({ label, icon, tone = "gold", onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; tone?: "gold" | "green" | "red" | "muted"; onPress: () => void }) {
  const color = tone === "green" ? GREEN : tone === "red" ? RED : tone === "muted" ? MUTED : GOLD;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.mini, { borderColor: `${color}55`, backgroundColor: `${color}12`, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.miniText, { color }]}>{label}</Text>
    </Pressable>
  );
}

async function assetToDataUrl(asset: ImagePicker.ImagePickerAsset): Promise<string | null> {
  if (asset.base64) {
    const mime = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${asset.base64}`;
  }
  try {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function GameTopupAdmin() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"requests" | "games" | "settings">("requests");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["id"]>("pending");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<number, RequestDraft>>({});
  const requestQueryInput = { status, search: search.trim() || undefined, limit: 50 };
  const requests = trpc.gameTopup.adminRequests.useQuery(requestQueryInput, { refetchInterval: 10000 });
  const visibleRequests = requests.data?.requests ?? [];
  const catalog = trpc.gameTopup.adminCatalog.useQuery(undefined, { refetchInterval: 15000 });
  const [editor, setEditor] = useState<GameDraft | null>(null);
  const [packageDrafts, setPackageDrafts] = useState<Record<number, { quantity: string; price: string; label: string }>>({});
  const [newPackage, setNewPackage] = useState({ quantity: "", price: "", label: "" });
  const [funding, setFunding] = useState({ amount: "", source: "" });
  const fundingOperation = useRef<{ fingerprint: string; id: string } | null>(null);
  const [settingsForm, setSettingsForm] = useState({ enabled: true, feeEnabled: true, feeAmount: "5.00", feeMin: "0.00", feeMax: "100.00" });
  const settingsInitialized = useRef(false);
  useEffect(() => {
    if (settingsInitialized.current || !catalog.data?.settings) return;
    const current = catalog.data.settings;
    setSettingsForm({ enabled: Boolean(current.enabled), feeEnabled: Boolean(current.feeEnabled), feeAmount: current.feeAmount, feeMin: current.feeMin, feeMax: current.feeMax });
    settingsInitialized.current = true;
  }, [catalog.data?.settings]);

  const refreshRequests = async () => {
    await Promise.all([
      utils.gameTopup.adminRequests.invalidate(),
      utils.gameTopup.adminCatalog.invalidate(),
      utils.gameTopup.catalog.invalidate(),
      utils.admin.recentOperations.invalidate(),
    ]);
  };
  const refreshCatalog = async () => {
    await Promise.all([utils.gameTopup.adminCatalog.invalidate(), utils.gameTopup.catalog.invalidate(), utils.gameTopup.overview.invalidate()]);
  };

  const review = trpc.gameTopup.review.useMutation({
    onSuccess: async (result) => {
      // The mutation view does not contain joined customer/game labels; keep those from the list.
      const updated = result.request;
      const matchesFilter = status === "all"
        || (status === "pending" && isPendingRecentOperation("gameTopup", updated.status))
        || (status === "archive" && ["approved", "processing", "completed", "rejected", "cancelled"].includes(updated.status))
        || status === updated.status;
      utils.gameTopup.adminRequests.setData(requestQueryInput, (current) => {
        if (!current || !current.requests.some((request) => request.id === updated.id)) return current;
        if (!matchesFilter) return { ...current, total: Math.max(0, current.total - 1), requests: current.requests.filter((request) => request.id !== updated.id) };
        return { ...current, requests: current.requests.map((request) => request.id === updated.id
          ? { ...updated, userName: request.userName, customerId: request.customerId, currencyLabel: request.currencyLabel }
          : request) };
      });
      await refreshRequests();
      showFinancialMessage("تم تحديث الطلب", result.message);
    },
    onError: (error) => showFinancialMessage("تعذر تحديث الطلب", error.message),
  });
  const saveGame = trpc.gameTopup.saveGame.useMutation({
    onSuccess: async (result) => { await refreshCatalog(); showFinancialMessage("تم الحفظ", result.message); setEditor(null); },
    onError: (error) => showFinancialMessage("تعذر حفظ اللعبة", error.message),
  });
  const savePackage = trpc.gameTopup.savePackage.useMutation({
    onSuccess: async (result) => { await refreshCatalog(); showFinancialMessage("تم الحفظ", result.message); },
    onError: (error) => showFinancialMessage("تعذر حفظ الباقة", error.message),
  });
  const deletePackage = trpc.gameTopup.deletePackage.useMutation({
    onSuccess: async (result) => { await refreshCatalog(); showFinancialMessage("تم الحذف", result.message); },
    onError: (error) => showFinancialMessage("تعذر حذف الباقة", error.message),
  });
  const updateSettings = trpc.gameTopup.updateSettings.useMutation({
    onSuccess: async (result) => { settingsInitialized.current = false; await refreshCatalog(); showFinancialMessage("إعدادات الخدمة", result.message); },
    onError: (error) => showFinancialMessage("تعذر تحديث الإعدادات", error.message),
  });
  const addFunding = trpc.gameTopup.addFunding.useMutation({
    onSuccess: async (result) => { fundingOperation.current = null; await refreshCatalog(); setFunding({ amount: "", source: "" }); showFinancialMessage("تم التمويل", result.message); },
    onError: (error) => showFinancialMessage("تعذر إضافة التمويل", error.message),
  });
  const uploadImage = trpc.gameTopup.uploadImage.useMutation({
    onSuccess: async (result) => { await refreshCatalog(); showFinancialMessage("تم تحديث الصورة", result.message); },
    onError: (error) => showFinancialMessage("تعذر رفع الصورة", error.message),
  });
  const clearImage = trpc.gameTopup.clearImage.useMutation({
    onSuccess: async (result) => { await refreshCatalog(); showFinancialMessage("تمت الإزالة", result.message); },
    onError: (error) => showFinancialMessage("تعذر إزالة الصورة", error.message),
  });

  useEffect(() => {
    if (!editor?.id || !catalog.data) return;
    const game = catalog.data.games.find((item) => item.id === editor.id);
    if (!game) return;
    const timer = setTimeout(() => setPackageDrafts(Object.fromEntries(game.packages.map((item) => [item.id, { quantity: String(item.quantity), price: item.price, label: item.label ?? "" }]))), 0);
    return () => clearTimeout(timer);
  }, [editor?.id, catalog.data]);

  const draftFor = (id: number): RequestDraft => drafts[id] ?? { reason: "", reference: "", note: "" };
  const patchDraft = (id: number, patch: Partial<RequestDraft>) => setDrafts((current) => ({ ...current, [id]: { ...draftFor(id), ...patch } }));

  const act = async (request: any, next: "under_review" | "approved" | "processing" | "completed" | "rejected") => {
    const draft = draftFor(request.id);
    if (next === "rejected" && draft.reason.trim().length < 3) { showFinancialMessage("سبب الرفض مطلوب", "اكتب سببًا واضحًا من 3 أحرف على الأقل."); return; }
    if (next === "completed" && draft.reference.trim().length < 3) { showFinancialMessage("مرجع الشحن مطلوب", "أدخل رقم العملية أو مرجع المزود قبل إعلان الاكتمال."); return; }
    if (next === "approved" || next === "rejected") {
      const ok = await confirmFinancialAction(
        next === "approved" ? `اعتماد ${request.kindLabel}` : `رفض ${request.kindLabel}`,
        request.kind === "withdraw"
          ? next === "approved" ? `بعد التحقق من استلام المبلغ من 1xBet، سيُضاف ${formatMoney(request.totalAmount)} ج.م إلى محفظة العميل مرة واحدة.` : "سيُرفض طلب السحب دون إضافة أي مبلغ إلى المحفظة."
          : next === "approved" ? `سيُخصم ${formatMoney(request.totalAmount)} من محفظة العميل مرة واحدة ويُضاف إلى محفظة التمويل.` : `سيُحرر ${formatMoney(request.totalAmount)} المحجوز دون خصم.`,
      );
      if (!ok) return;
    }
    review.mutate({ requestId: request.id, status: next, rejectionReason: draft.reason.trim() || undefined, providerReference: draft.reference.trim() || undefined, adminNote: draft.note.trim() || undefined });
  };

  const pickImage = async (gameId: number) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { showFinancialMessage("إذن الصور مطلوب", "اسمح بالوصول إلى الصور لاختيار صورة اللعبة."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.6, base64: true });
    if (result.canceled || !result.assets?.[0]) return;
    const dataUrl = await assetToDataUrl(result.assets[0]);
    if (!dataUrl) { showFinancialMessage("تعذر قراءة الصورة", "اختر صورة JPEG أو PNG أخرى."); return; }
    if (dataUrl.length > 2_100_000) { showFinancialMessage("الصورة كبيرة", "اختر صورة أصغر من 1.5 ميجابايت."); return; }
    uploadImage.mutate({ gameId, dataUrl });
  };

  const submitEditor = () => {
    if (!editor) return;
    if (!editor.name.trim()) { showFinancialMessage("اسم اللعبة مطلوب", "أدخل اسمًا واضحًا للعبة."); return; }
    if (!editor.fields.length) { showFinancialMessage("بيانات اللاعب مطلوبة", "أضف خانة بيانات واحدة على الأقل."); return; }
    saveGame.mutate({
      id: editor.id,
      slug: editor.slug.trim() || undefined,
      name: editor.name.trim(),
      serviceType: editor.serviceType,
      currencyLabel: editor.currencyLabel.trim(),
      minQuantity: Number(editor.minQuantity),
      unitPrice: editor.serviceType === "deposit_withdraw" ? "0.00" : editor.unitPrice.trim(),
      fields: editor.fields.map((field) => ({ ...field, label: field.label.trim(), placeholder: field.placeholder?.trim() || undefined })),
      sortOrder: Number(editor.sortOrder || 0),
      isActive: editor.isActive,
      depositFeeEnabled: editor.depositFeeEnabled,
      depositFeeAmount: editor.depositFeeAmount.trim() || "0.00",
      depositFeeMin: editor.depositFeeMin.trim() || "0.00",
      depositFeeMax: editor.depositFeeMax.trim() || "0.00",
      minDepositAmount: editor.minDepositAmount.trim() || "50.00",
      minWithdrawAmount: editor.minWithdrawAmount.trim() || "50.00",
      withdrawEnabled: editor.withdrawEnabled,
      withdrawalInstructions: editor.withdrawalInstructions.trim(),
      cityLabel: editor.cityLabel.trim() || undefined,
      cityPlaceholder: editor.cityPlaceholder.trim() || undefined,
      cityValue: editor.cityValue.trim(),
      streetLabel: editor.streetLabel.trim() || undefined,
      streetPlaceholder: editor.streetPlaceholder.trim() || undefined,
      streetValue: editor.streetValue.trim(),
      withdrawalCodeLabel: editor.withdrawalCodeLabel.trim() || undefined,
      userIdFieldLabel: editor.userIdFieldLabel.trim() || undefined,
    });
  };

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 6, borderRadius: 16, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", padding: 4, marginBottom: 14 }}>
        {([
          { id: "requests", label: "الطلبات" },
          { id: "games", label: "الألعاب والباقات" },
          { id: "settings", label: "الإعدادات والتمويل" },
        ] as const).map((item) => (
          <Pressable key={item.id} accessibilityRole="button" onPress={() => setTab(item.id)} style={[styles.tab, tab === item.id && styles.tabActive]}>
            <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "requests" ? (
        <View>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {STATUS_FILTERS.map((item) => {
              const active = status === item.id;
              return (
                <Pressable key={item.id} onPress={() => setStatus(item.id)} style={[styles.chip, { borderColor: active ? GOLD : "#273548", backgroundColor: active ? "#D7A94818" : "#121B28" }]}>
                  <Text style={[styles.chipText, { color: active ? GOLD : MUTED }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput value={search} onChangeText={setSearch} placeholder="ابحث برقم الطلب أو العميل أو اللعبة" placeholderTextColor="#657286" style={[fieldInputStyle(), { marginBottom: 12 }]} />
          {requests.isLoading ? <View style={{ paddingVertical: 30, alignItems: "center" }}><ActivityIndicator color={GOLD} /></View> : requests.isError ? (
            <Card><Text style={{ color: RED, fontSize: 12, textAlign: "center" }}>تعذر تحميل الطلبات. أعد المحاولة.</Text><View style={{ marginTop: 12 }}><ActionButton label="إعادة المحاولة" icon="refresh-outline" secondary onPress={() => void requests.refetch()} /></View></Card>
          ) : !visibleRequests.length ? (
            <EmptyState title="لا توجد طلبات" text="ستظهر طلبات خدمات الألعاب هنا مباشرة بعد إرسالها من العملاء." />
          ) : (
            <View style={{ gap: 12 }}>
              {visibleRequests.map((request) => {
                const draft = draftFor(request.id);
                const reviewable = request.status === "new" || request.status === "under_review";
                const processable = request.status === "approved";
                const completable = request.status === "approved" || request.status === "processing";
                return (
                  <Card key={request.id}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <Pill tone={GAME_TOPUP_STATUS_TONE[request.status] ?? "muted"}>{request.statusLabel}</Pill>
                      <View style={{ flex: 1, alignItems: "flex-end" }}>
                        <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right" }}>{request.gameName} · {request.kindLabel}</Text>
                        <Text style={{ color: MUTED, fontSize: 11, marginTop: 2, textAlign: "right" }}>{request.reference}</Text>
                      </View>
                    </View>
                    <View style={{ marginTop: 8 }}>
                      <View style={styles.row}><Text style={styles.rowValue}>{request.userName ?? "—"} · {request.customerId ?? "—"}</Text><Text style={styles.rowLabel}>العميل</Text></View>
                      {request.kind === "topup" ? <View style={styles.row}><Text style={styles.rowValue}>{formatGameQuantity(request.quantity, request.currencyLabel ?? "وحدة")}</Text><Text style={styles.rowLabel}>الكمية</Text></View> : null}
                      <View style={styles.row}><Text style={styles.rowValue}>{formatMoney(request.subtotalAmount)}</Text><Text style={styles.rowLabel}>{request.kind === "withdraw" ? "مبلغ السحب" : request.kind === "deposit" ? "مبلغ الإيداع" : "قيمة الشحن"}</Text></View>
                      <View style={styles.row}><Text style={styles.rowValue}>{formatMoney(request.feeAmount)}</Text><Text style={styles.rowLabel}>{request.kind === "deposit" ? "رسوم الإيداع" : "رسوم الخدمة"}</Text></View>
                      <View style={styles.row}><Text style={[styles.rowValue, { color: GOLD }]}>{formatMoney(request.totalAmount)}</Text><Text style={styles.rowLabel}>{request.kind === "withdraw" ? "مبلغ السحب" : "الإجمالي المحجوز"}</Text></View>
                      <View style={styles.row}><Text style={styles.rowValue}>{new Date(request.createdAt).toLocaleString("ar-EG")}</Text><Text style={styles.rowLabel}>تاريخ الإرسال</Text></View>
                      {request.reviewedAt ? <View style={styles.row}><Text style={styles.rowValue}>{new Date(request.reviewedAt).toLocaleString("ar-EG")}</Text><Text style={styles.rowLabel}>تاريخ القرار</Text></View> : null}
                    </View>
                    {request.playerData.length ? (
                      <View style={{ marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", padding: 10, gap: 5 }}>
                        {request.playerData.map((field: { key: string; label: string; value: string }) => (
                          <View key={field.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                            <Text selectable style={{ color: "#F7F1E3", fontSize: 12, writingDirection: "ltr" }}>{field.value}</Text>
                            <Text style={{ color: MUTED, fontSize: 11.5 }}>{field.label}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {request.rejectionReason ? <Text style={{ color: RED, fontSize: 11.5, marginTop: 8, textAlign: "right" }}>سبب الرفض: {request.rejectionReason}</Text> : null}
                    {request.providerReference ? <Text style={{ color: GREEN, fontSize: 11.5, marginTop: 8, textAlign: "right" }}>مرجع العملية: {request.providerReference}</Text> : null}
                    {reviewable ? <TextInput value={draft.reason} onChangeText={(value) => patchDraft(request.id, { reason: value })} placeholder="سبب الرفض (إلزامي عند الرفض)" placeholderTextColor="#657286" style={[fieldInputStyle(), { marginTop: 10 }]} /> : null}
                    {completable ? <TextInput value={draft.reference} onChangeText={(value) => patchDraft(request.id, { reference: value })} placeholder="رقم العملية / مرجع مزود الشحن" placeholderTextColor="#657286" style={[fieldInputStyle(), { marginTop: 10 }]} /> : null}
                    <TextInput value={draft.note} onChangeText={(value) => patchDraft(request.id, { note: value })} placeholder="ملاحظة إدارية (اختياري)" placeholderTextColor="#657286" style={[fieldInputStyle(), { marginTop: 8 }]} />
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11 }}>
                      {request.status === "new" ? <MiniButton label="بدء المراجعة" icon="eye-outline" tone="muted" onPress={() => act(request, "under_review")} /> : null}
                      {reviewable ? <MiniButton label={request.kind === "withdraw" ? "اعتماد السحب" : "اعتماد وخصم"} icon="checkmark-circle-outline" tone="green" onPress={() => act(request, "approved")} /> : null}
                      {reviewable ? <MiniButton label="رفض" icon="close-circle-outline" tone="red" onPress={() => act(request, "rejected")} /> : null}
                      {processable ? <MiniButton label="جارٍ التنفيذ" icon="time-outline" onPress={() => act(request, "processing")} /> : null}
                      {completable ? <MiniButton label="إكمال الطلب" icon="checkmark-done-outline" tone="green" onPress={() => act(request, "completed")} /> : null}
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </View>
      ) : null}

      {tab === "games" ? (
        <View>
          {catalog.isLoading ? <View style={{ paddingVertical: 30, alignItems: "center" }}><ActivityIndicator color={GOLD} /></View> : null}
          {editor ? (
            <Card style={{ borderColor: "#5C4A28" }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Pressable onPress={() => setEditor(null)} style={({ pressed }) => [styles.mini, { borderColor: "#273548", backgroundColor: "#121B28", opacity: pressed ? 0.7 : 1 }]}><Ionicons name="close" size={15} color={MUTED} /><Text style={[styles.miniText, { color: MUTED }]}>إغلاق</Text></Pressable>
                <Text style={{ color: "#F7F1E3", fontSize: 16, fontWeight: "800", textAlign: "right" }}>{editor.id ? "تعديل لعبة" : "إضافة لعبة جديدة"}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                {resolveGameImageUrl(catalog.data?.games.find((item) => item.id === editor.id)?.imageUrl ?? null) ? (
                  <Image source={{ uri: resolveGameImageUrl(catalog.data?.games.find((item) => item.id === editor.id)?.imageUrl ?? null) ?? "" }} style={styles.image} contentFit="cover" />
                ) : (
                  <View style={[styles.image, { alignItems: "center", justifyContent: "center" }]}><Ionicons name="image-outline" size={22} color={GOLD} /></View>
                )}
                <View style={{ flex: 1, gap: 6 }}>
                  <MiniButton label={editor.id ? "تغيير صورة اللعبة" : "احفظ اللعبة أولًا لإضافة صورة"} icon="image-outline" tone={editor.id ? "gold" : "muted"} onPress={() => { if (editor.id) void pickImage(editor.id); else showFinancialMessage("احفظ اللعبة أولًا", "أنشئ اللعبة ثم ارجع لتعديل صورتها."); }} />
                  {editor.id ? <MiniButton label="إزالة الصورة" icon="trash-outline" tone="red" onPress={() => clearImage.mutate({ gameId: editor.id! })} /> : null}
                </View>
              </View>
              <View style={{ gap: 9 }}>
                <View><Text style={styles.label}>اسم اللعبة</Text><TextInput value={editor.name} onChangeText={(value) => setEditor({ ...editor, name: value })} placeholder="مثال: PUBG Mobile" placeholderTextColor="#657286" style={fieldInputStyle()} /></View>
                <View><Text style={styles.label}>المعرّف اللاتيني (يُنشأ تلقائيًا إن تُرك فارغًا)</Text><TextInput value={editor.slug} onChangeText={(value) => setEditor({ ...editor, slug: value })} placeholder="pubg-mobile" placeholderTextColor="#657286" autoCapitalize="none" style={fieldInputStyle()} /></View>
                <View>
                  <Text style={styles.label}>نوع الخدمة</Text>
                  <View style={{ flexDirection: "row", gap: 7 }}>
                    <Pressable accessibilityRole="button" onPress={() => setEditor({ ...editor, serviceType: "topup" })} style={[styles.chip, { flex: 1, alignItems: "center", borderColor: editor.serviceType === "topup" ? GOLD : "#273548", backgroundColor: editor.serviceType === "topup" ? "#D7A94818" : "#121B28" }]}><Text style={[styles.chipText, { color: editor.serviceType === "topup" ? GOLD : MUTED }]}>شحن ألعاب</Text></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setEditor({ ...editor, serviceType: "deposit_withdraw" })} style={[styles.chip, { flex: 1, alignItems: "center", borderColor: editor.serviceType === "deposit_withdraw" ? GOLD : "#273548", backgroundColor: editor.serviceType === "deposit_withdraw" ? "#D7A94818" : "#121B28" }]}><Text style={[styles.chipText, { color: editor.serviceType === "deposit_withdraw" ? GOLD : MUTED }]}>إيداع وسحب</Text></Pressable>
                  </View>
                </View>
                {editor.serviceType === "deposit_withdraw" ? (
                  <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#0E1723", padding: 11, gap: 9 }}>
                    <Text style={{ color: GOLD, fontSize: 12.5, fontWeight: "800", textAlign: "right" }}>إعدادات خدمة الإيداع والسحب</Text>
                    <View><Text style={styles.label}>تسمية خانة ID المستخدم</Text><TextInput value={editor.userIdFieldLabel} onChangeText={(value) => setEditor({ ...editor, userIdFieldLabel: value })} placeholder="ID المستخدم" placeholderTextColor="#657286" style={fieldInputStyle()} /></View>
                    <View style={{ flexDirection: "row", gap: 7 }}>
                      <View style={{ flex: 1 }}><Text style={styles.label}>الحد الأدنى للإيداع (ج.م)</Text><TextInput value={editor.minDepositAmount} onChangeText={(value) => setEditor({ ...editor, minDepositAmount: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" placeholder="50.00" placeholderTextColor="#657286" style={fieldInputStyle()} /></View>
                      <View style={{ flex: 1 }}><Text style={styles.label}>الحد الأدنى للسحب (ج.م)</Text><TextInput value={editor.minWithdrawAmount} onChangeText={(value) => setEditor({ ...editor, minWithdrawAmount: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" placeholder="50.00" placeholderTextColor="#657286" style={fieldInputStyle()} /></View>
                    </View>
                    <Text style={{ color: MUTED, fontSize: 10.5, lineHeight: 16, textAlign: "right" }}>يُطبّق الحدان على الطلبات الجديدة فور الحفظ، وكل حد مستقل عن الآخر.</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Switch value={editor.depositFeeEnabled} onValueChange={(value) => setEditor({ ...editor, depositFeeEnabled: value })} trackColor={{ false: "#273548", true: "#D7A94866" }} thumbColor={editor.depositFeeEnabled ? GOLD : "#657286"} />
                      <Text style={{ color: "#F7F1E3", fontSize: 12.5, fontWeight: "700" }}>تفعيل رسوم الإيداع</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 7 }}>
                      <View style={{ flex: 1 }}><Text style={styles.label}>قيمة الرسوم</Text><TextInput value={editor.depositFeeAmount} onChangeText={(value) => setEditor({ ...editor, depositFeeAmount: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" style={fieldInputStyle()} /></View>
                      <View style={{ flex: 1 }}><Text style={styles.label}>أقل رسوم</Text><TextInput value={editor.depositFeeMin} onChangeText={(value) => setEditor({ ...editor, depositFeeMin: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" style={fieldInputStyle()} /></View>
                      <View style={{ flex: 1 }}><Text style={styles.label}>أعلى رسوم</Text><TextInput value={editor.depositFeeMax} onChangeText={(value) => setEditor({ ...editor, depositFeeMax: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" style={fieldInputStyle()} /></View>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Switch value={editor.withdrawEnabled} onValueChange={(value) => setEditor({ ...editor, withdrawEnabled: value })} trackColor={{ false: "#273548", true: "#47D7A566" }} thumbColor={editor.withdrawEnabled ? GREEN : "#657286"} />
                      <Text style={{ color: "#F7F1E3", fontSize: 12.5, fontWeight: "700" }}>تفعيل خدمة السحب</Text>
                    </View>
                    <View><Text style={styles.label}>عنوان المدينة الظاهر للمستخدم</Text><TextInput value={editor.cityLabel} onChangeText={(value) => setEditor({ ...editor, cityLabel: value })} style={fieldInputStyle()} /></View>
                    <View><Text style={styles.label}>نص المدينة الثابت</Text><TextInput value={editor.cityValue} onChangeText={(value) => setEditor({ ...editor, cityValue: value })} placeholder="اكتب المدينة التي ستظهر للمستخدم" placeholderTextColor="#657286" style={fieldInputStyle()} /></View>
                    <View><Text style={styles.label}>عنوان الشارع الظاهر للمستخدم</Text><TextInput value={editor.streetLabel} onChangeText={(value) => setEditor({ ...editor, streetLabel: value })} style={fieldInputStyle()} /></View>
                    <View><Text style={styles.label}>نص الشارع الثابت</Text><TextInput value={editor.streetValue} onChangeText={(value) => setEditor({ ...editor, streetValue: value })} placeholder="اكتب الشارع الذي سيظهر للمستخدم" placeholderTextColor="#657286" style={fieldInputStyle()} /></View>
                    <View><Text style={styles.label}>تسمية خانة كود السحب</Text><TextInput value={editor.withdrawalCodeLabel} onChangeText={(value) => setEditor({ ...editor, withdrawalCodeLabel: value })} style={fieldInputStyle()} /></View>
                    <View><Text style={styles.label}>محرر «كيفية السحب» — كامل النص</Text><TextInput value={editor.withdrawalInstructions} onChangeText={(value) => setEditor({ ...editor, withdrawalInstructions: value })} placeholder="اكتب تعليمات السحب كاملة…" placeholderTextColor="#657286" multiline textAlignVertical="top" style={[fieldInputStyle(), { minHeight: 150, paddingTop: 10 }]} /><Text style={{ color: MUTED, fontSize: 10.5, lineHeight: 16, marginTop: 5, textAlign: "right" }}>يدعم عدة أسطر. اضغط «حفظ اللعبة» لنشر التغييرات للمستخدمين دون تحديث التطبيق.</Text></View>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}><Text style={styles.label}>عملة اللعبة</Text><TextInput value={editor.currencyLabel} onChangeText={(value) => setEditor({ ...editor, currencyLabel: value })} placeholder="شدة / جوهرة" placeholderTextColor="#657286" style={fieldInputStyle()} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.label}>الحد الأدنى للكمية</Text><TextInput value={editor.minQuantity} onChangeText={(value) => setEditor({ ...editor, minQuantity: value.replace(/[^0-9]/g, "") })} keyboardType="number-pad" style={fieldInputStyle()} /></View>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}><Text style={styles.label}>سعر الوحدة (ج.م)</Text><TextInput value={editor.unitPrice} onChangeText={(value) => setEditor({ ...editor, unitPrice: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" style={fieldInputStyle()} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.label}>ترتيب الظهور</Text><TextInput value={editor.sortOrder} onChangeText={(value) => setEditor({ ...editor, sortOrder: value.replace(/[^0-9]/g, "") })} keyboardType="number-pad" style={fieldInputStyle()} /></View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Switch value={editor.isActive} onValueChange={(value) => setEditor({ ...editor, isActive: value })} trackColor={{ false: "#273548", true: "#D7A94866" }} thumbColor={editor.isActive ? GOLD : "#657286"} />
                  <Text style={{ color: "#F7F1E3", fontSize: 13, fontWeight: "700" }}>اللعبة ظاهرة للعملاء</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <MiniButton label="إضافة خانة" icon="add" tone="muted" onPress={() => setEditor({ ...editor, fields: [...editor.fields, { key: `field${editor.fields.length + 1}`, label: "", placeholder: "", required: true }] })} />
                <Text style={{ color: "#F7F1E3", fontSize: 14, fontWeight: "800" }}>خانات بيانات اللاعب</Text>
              </View>
              {editor.fields.map((field, index) => (
                <View key={`${field.key}-${index}`} style={{ borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0E1723", padding: 9, marginBottom: 8, gap: 6 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TextInput value={field.label} onChangeText={(value) => { const fields = [...editor.fields]; fields[index] = { ...field, label: value }; setEditor({ ...editor, fields }); }} placeholder="التسمية الظاهرة" placeholderTextColor="#657286" style={[styles.inputSmall, { flex: 1.3 }]} />
                    <TextInput value={field.key} onChangeText={(value) => { const fields = [...editor.fields]; fields[index] = { ...field, key: value.replace(/[^a-zA-Z0-9_]/g, "") }; setEditor({ ...editor, fields }); }} placeholder="key" placeholderTextColor="#657286" autoCapitalize="none" style={[styles.inputSmall, { flex: 1 }]} />
                    <Pressable accessibilityRole="button" accessibilityLabel="تحريك الخانة لأعلى" disabled={index === 0} onPress={() => { if (index === 0) return; const fields = [...editor.fields]; [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]]; setEditor({ ...editor, fields }); }} style={{ width: 23, alignItems: "center", justifyContent: "center", opacity: index === 0 ? 0.25 : 1 }}><Ionicons name="chevron-up" size={16} color={GOLD} /></Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="تحريك الخانة لأسفل" disabled={index === editor.fields.length - 1} onPress={() => { if (index === editor.fields.length - 1) return; const fields = [...editor.fields]; [fields[index + 1], fields[index]] = [fields[index], fields[index + 1]]; setEditor({ ...editor, fields }); }} style={{ width: 23, alignItems: "center", justifyContent: "center", opacity: index === editor.fields.length - 1 ? 0.25 : 1 }}><Ionicons name="chevron-down" size={16} color={GOLD} /></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setEditor({ ...editor, fields: editor.fields.filter((_, i) => i !== index) })} style={{ width: 34, alignItems: "center", justifyContent: "center" }}><Ionicons name="trash-outline" size={17} color={RED} /></Pressable>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <TextInput value={field.placeholder ?? ""} onChangeText={(value) => { const fields = [...editor.fields]; fields[index] = { ...field, placeholder: value }; setEditor({ ...editor, fields }); }} placeholder="نص إرشادي (اختياري)" placeholderTextColor="#657286" style={[styles.inputSmall, { flex: 1 }]} />
                    <Switch value={field.required} onValueChange={(value) => { const fields = [...editor.fields]; fields[index] = { ...field, required: value }; setEditor({ ...editor, fields }); }} trackColor={{ false: "#273548", true: "#D7A94866" }} thumbColor={field.required ? GOLD : "#657286"} />
                    <Text style={{ color: MUTED, fontSize: 10.5 }}>إلزامي</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                    <Text style={{ color: MUTED, fontSize: 10.5 }}>نوع الإدخال</Text>
                    <Pressable accessibilityRole="button" onPress={() => { const fields = [...editor.fields]; fields[index] = { ...field, type: "text" }; setEditor({ ...editor, fields }); }} style={[styles.chip, { paddingVertical: 4, borderColor: (field.type ?? "text") === "text" ? GOLD : "#273548", backgroundColor: (field.type ?? "text") === "text" ? "#D7A94818" : "transparent" }]}><Text style={[styles.chipText, { color: (field.type ?? "text") === "text" ? GOLD : MUTED }]}>نص</Text></Pressable>
                    <Pressable accessibilityRole="button" onPress={() => { const fields = [...editor.fields]; fields[index] = { ...field, type: "number" }; setEditor({ ...editor, fields }); }} style={[styles.chip, { paddingVertical: 4, borderColor: field.type === "number" ? GOLD : "#273548", backgroundColor: field.type === "number" ? "#D7A94818" : "transparent" }]}><Text style={[styles.chipText, { color: field.type === "number" ? GOLD : MUTED }]}>رقم</Text></Pressable>
                  </View>
                </View>
              ))}
              {editor.id && editor.serviceType === "topup" ? (
                <>
                  <View style={styles.divider} />
                  <Text style={{ color: "#F7F1E3", fontSize: 14, fontWeight: "800", textAlign: "right", marginBottom: 8 }}>الباقات والأسعار</Text>
                  {catalog.data?.games.find((item) => item.id === editor.id)?.packages.map((item) => {
                    const draft = packageDrafts[item.id] ?? { quantity: String(item.quantity), price: item.price, label: item.label ?? "" };
                    return (
                      <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 7 }}>
                        <TextInput value={draft.quantity} onChangeText={(value) => setPackageDrafts((current) => ({ ...current, [item.id]: { ...draft, quantity: value.replace(/[^0-9]/g, "") } }))} keyboardType="number-pad" style={[styles.inputSmall, { width: 64 }]} />
                        <TextInput value={draft.price} onChangeText={(value) => setPackageDrafts((current) => ({ ...current, [item.id]: { ...draft, price: value.replace(/[^0-9.]/g, "") } }))} keyboardType="decimal-pad" style={[styles.inputSmall, { width: 76 }]} />
                        <TextInput value={draft.label} onChangeText={(value) => setPackageDrafts((current) => ({ ...current, [item.id]: { ...draft, label: value } }))} placeholder="تسمية" placeholderTextColor="#657286" style={[styles.inputSmall, { flex: 1 }]} />
                        <Pressable accessibilityRole="button" onPress={() => savePackage.mutate({ id: item.id, gameId: editor.id!, quantity: Number(draft.quantity), price: draft.price, label: draft.label || undefined, sortOrder: item.sortOrder, isActive: item.isActive })} style={{ width: 30, alignItems: "center" }}><Ionicons name="save-outline" size={17} color={GREEN} /></Pressable>
                        <Pressable accessibilityRole="button" onPress={async () => { if (await confirmFinancialAction("حذف الباقة", `سيتم حذف باقة ${item.quantity} نهائيًا.`)) deletePackage.mutate({ packageId: item.id }); }} style={{ width: 30, alignItems: "center" }}><Ionicons name="trash-outline" size={17} color={RED} /></Pressable>
                      </View>
                    );
                  })}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <TextInput value={newPackage.quantity} onChangeText={(value) => setNewPackage({ ...newPackage, quantity: value.replace(/[^0-9]/g, "") })} placeholder="كمية" placeholderTextColor="#657286" keyboardType="number-pad" style={[styles.inputSmall, { width: 64 }]} />
                    <TextInput value={newPackage.price} onChangeText={(value) => setNewPackage({ ...newPackage, price: value.replace(/[^0-9.]/g, "") })} placeholder="السعر" placeholderTextColor="#657286" keyboardType="decimal-pad" style={[styles.inputSmall, { width: 76 }]} />
                    <TextInput value={newPackage.label} onChangeText={(value) => setNewPackage({ ...newPackage, label: value })} placeholder="تسمية الباقة" placeholderTextColor="#657286" style={[styles.inputSmall, { flex: 1 }]} />
                    <Pressable accessibilityRole="button" onPress={() => { if (!Number(newPackage.quantity) || !Number(newPackage.price)) { showFinancialMessage("بيانات ناقصة", "أدخل الكمية والسعر."); return; } savePackage.mutate({ gameId: editor.id!, quantity: Number(newPackage.quantity), price: newPackage.price, label: newPackage.label || undefined, sortOrder: (catalog.data?.games.find((item) => item.id === editor.id)?.packages.length ?? 0) + 1, isActive: true }); setNewPackage({ quantity: "", price: "", label: "" }); }} style={{ width: 32, alignItems: "center" }}><Ionicons name="add-circle" size={22} color={GOLD} /></Pressable>
                  </View>
                </>
              ) : <Text style={{ color: MUTED, fontSize: 11, textAlign: "right", marginTop: 6 }}>{editor.serviceType === "deposit_withdraw" ? "خدمة الإيداع والسحب تعمل بدون باقات؛ استخدم رسوم الإيداع وتعليمات السحب أعلاه." : "بعد حفظ اللعبة يمكنك إضافة الباقات وتعديلها."}</Text>}
              <View style={{ marginTop: 14 }}><ActionButton label={saveGame.isPending ? "جارٍ الحفظ…" : "حفظ اللعبة"} icon="save-outline" onPress={() => { if (!saveGame.isPending) submitEditor(); }} /></View>
            </Card>
          ) : (
            <>
              <ActionButton label="إضافة لعبة جديدة" icon="add-circle-outline" onPress={() => setEditor({ ...EMPTY_GAME, fields: EMPTY_GAME.fields.map((field) => ({ ...field })) })} />
              <View style={{ gap: 10, marginTop: 12 }}>
                {catalog.data?.games.map((game) => (
                  <Card key={game.id}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      {resolveGameImageUrl(game.imageUrl) ? <Image source={{ uri: resolveGameImageUrl(game.imageUrl) ?? "" }} style={styles.image} contentFit="cover" /> : <View style={[styles.image, { alignItems: "center", justifyContent: "center" }]}><Ionicons name="game-controller-outline" size={22} color={GOLD} /></View>}
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Pill tone={game.isActive ? "green" : "muted"}>{game.isActive ? "ظاهرة" : "مخفية"}</Pill>
                          <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right", flex: 1 }}>{game.name}</Text>
                        </View>
                        <Text style={{ color: MUTED, fontSize: 11, marginTop: 3, textAlign: "right" }}>{game.slug} · {game.serviceType === "deposit_withdraw" ? `إيداع وسحب · حد الإيداع ${formatMoney(game.minDepositAmount)} · حد السحب ${formatMoney(game.minWithdrawAmount)}` : `${game.currencyLabel} · أقل كمية ${game.minQuantity} · ${game.packages.length} باقات`}</Text>
                      </View>
                      <MiniButton label="تعديل" icon="create-outline" onPress={() => setEditor({
                        id: game.id,
                        slug: game.slug,
                        name: game.name,
                        serviceType: game.serviceType,
                        currencyLabel: game.currencyLabel,
                        minQuantity: String(game.minQuantity),
                        unitPrice: game.unitPrice,
                        sortOrder: String(game.sortOrder),
                        isActive: game.isActive,
                        fields: game.fields.map((field) => ({ ...field })),
                        depositFeeEnabled: game.depositFeeEnabled,
                        depositFeeAmount: game.depositFeeAmount,
                        depositFeeMin: game.depositFeeMin,
                        depositFeeMax: game.depositFeeMax,
                        minDepositAmount: game.minDepositAmount,
                        minWithdrawAmount: game.minWithdrawAmount,
                        withdrawEnabled: game.withdrawEnabled,
                        withdrawalInstructions: game.withdrawalInstructions ?? "",
                        cityLabel: game.cityLabel,
                        cityPlaceholder: game.cityPlaceholder,
                        cityValue: game.cityValue,
                        streetLabel: game.streetLabel,
                        streetPlaceholder: game.streetPlaceholder,
                        streetValue: game.streetValue,
                        withdrawalCodeLabel: game.withdrawalCodeLabel,
                        userIdFieldLabel: game.userIdFieldLabel,
                      })} />
                    </View>
                  </Card>
                ))}
              </View>
            </>
          )}
        </View>
      ) : null}

      {tab === "settings" ? (
        <View style={{ gap: 12 }}>
          <Card>
            <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right", marginBottom: 10 }}>حالة الخدمة</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Switch value={settingsForm.enabled} onValueChange={(value) => setSettingsForm({ ...settingsForm, enabled: value })} trackColor={{ false: "#273548", true: "#47D7A566" }} thumbColor={settingsForm.enabled ? GREEN : "#657286"} />
              <View style={{ alignItems: "flex-end", flex: 1, marginRight: 12 }}>
                <Text style={{ color: "#F7F1E3", fontSize: 13.5, fontWeight: "700" }}>تفعيل خدمة الألعاب</Text>
                <Text style={{ color: MUTED, fontSize: 11, marginTop: 3, textAlign: "right" }}>عند الإيقاف لا يستطيع العملاء إنشاء طلبات جديدة، وتبقى الطلبات الحالية للمراجعة.</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right", marginBottom: 8 }}>رسوم الخدمة</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Switch value={settingsForm.feeEnabled} onValueChange={(value) => setSettingsForm({ ...settingsForm, feeEnabled: value })} trackColor={{ false: "#273548", true: "#D7A94866" }} thumbColor={settingsForm.feeEnabled ? GOLD : "#657286"} />
              <Text style={{ color: "#F7F1E3", fontSize: 13, fontWeight: "700" }}>تفعيل رسوم الخدمة على كل طلب</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Text style={styles.label}>قيمة الرسوم (ج.م)</Text><TextInput value={settingsForm.feeAmount} onChangeText={(value) => setSettingsForm({ ...settingsForm, feeAmount: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" style={fieldInputStyle()} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>الحد الأدنى</Text><TextInput value={settingsForm.feeMin} onChangeText={(value) => setSettingsForm({ ...settingsForm, feeMin: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" style={fieldInputStyle()} /></View>
              <View style={{ flex: 1 }}><Text style={styles.label}>الحد الأعلى</Text><TextInput value={settingsForm.feeMax} onChangeText={(value) => setSettingsForm({ ...settingsForm, feeMax: value.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" style={fieldInputStyle()} /></View>
            </View>
            <Text style={{ color: MUTED, fontSize: 10.5, marginTop: 7, lineHeight: 16, textAlign: "right" }}>القيمة الافتراضية 5 ج.م. ضع 0 في الحد الأعلى لإلغاء السقف. تُعرض الرسوم منفصلة عن سعر الشحن قبل تأكيد الطلب وتُضاف لمحفظة التمويل عند الاعتماد.</Text>
            <View style={{ marginTop: 10 }}><ActionButton label={updateSettings.isPending ? "جارٍ الحفظ…" : "حفظ إعدادات الخدمة والرسوم"} icon="save-outline" secondary onPress={() => {
              if (settingsForm.feeEnabled && Number(settingsForm.feeAmount || 0) < Number(settingsForm.feeMin || 0)) { showFinancialMessage("رسوم غير صالحة", "قيمة الرسوم أقل من الحد الأدنى."); return; }
              if (Number(settingsForm.feeMax || 0) > 0 && Number(settingsForm.feeMax || 0) < Number(settingsForm.feeMin || 0)) { showFinancialMessage("رسوم غير صالحة", "الحد الأعلى يجب ألا يقل عن الحد الأدنى."); return; }
              updateSettings.mutate({ enabled: settingsForm.enabled, feeEnabled: settingsForm.feeEnabled, feeAmount: settingsForm.feeAmount || "0", feeMin: settingsForm.feeMin || "0", feeMax: settingsForm.feeMax || "0" });
            }} /></View>
          </Card>
          <Card style={{ borderColor: "#5C4A28" }}>
            <Text style={{ color: MUTED, fontSize: 12, textAlign: "right" }}>محفظة تمويل خدمات الألعاب</Text>
            <Text style={{ color: GOLD, fontSize: 30, fontWeight: "900", textAlign: "right", writingDirection: "ltr", marginTop: 4 }}>{formatMoney(catalog.data?.settings.fundingBalance)}</Text>
            <Text style={{ color: MUTED, fontSize: 11, marginTop: 4, textAlign: "right" }}>تُضاف إليها قيمة كل طلب (شحن + رسوم) عند اعتماده. الطلبات قيد المتابعة: {catalog.data?.pendingCount ?? 0}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", padding: 10 }}>
              <Text style={{ color: GOLD, fontSize: 16, fontWeight: "900", writingDirection: "ltr" }}>{formatMoney(catalog.data?.feesCollected)}</Text>
              <Text style={{ color: MUTED, fontSize: 11 }}>إجمالي رسوم الخدمة المحصلة</Text>
            </View>
            <View style={{ marginTop: 12, gap: 8 }}>
              <TextInput value={funding.amount} onChangeText={(value) => setFunding({ ...funding, amount: value.replace(/[^0-9.]/g, "") })} placeholder="مبلغ التمويل (ج.م)" placeholderTextColor="#657286" keyboardType="decimal-pad" style={fieldInputStyle()} />
              <TextInput value={funding.source} onChangeText={(value) => setFunding({ ...funding, source: value })} placeholder="مصدر التمويل أو ملاحظة" placeholderTextColor="#657286" style={fieldInputStyle()} />
              <ActionButton label={addFunding.isPending ? "جارٍ التسجيل…" : "إضافة تمويل"} icon="wallet-outline" secondary onPress={() => {
                const fingerprint = `${funding.amount}|${funding.source}`;
                if (!fundingOperation.current || fundingOperation.current.fingerprint !== fingerprint) fundingOperation.current = { fingerprint, id: `GT-FUND-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` };
                if (!Number(funding.amount)) { showFinancialMessage("مبلغ غير صالح", "أدخل مبلغًا أكبر من صفر."); return; }
                if (funding.source.trim().length < 2) { showFinancialMessage("المصدر مطلوب", "أدخل مصدر التمويل."); return; }
                addFunding.mutate({ amount: funding.amount, source: funding.source.trim(), operationId: fundingOperation.current.id });
              }} />
            </View>
          </Card>
          <Card>
            <Text style={{ color: "#F7F1E3", fontSize: 15, fontWeight: "800", textAlign: "right", marginBottom: 8 }}>سجل حركات التمويل</Text>
            {!catalog.data?.fundingEntries.length ? <Text style={{ color: MUTED, fontSize: 12, textAlign: "center", paddingVertical: 12 }}>لا توجد حركات تمويل بعد.</Text> : catalog.data.fundingEntries.map((entry) => (
              <View key={entry.id} style={styles.row}>
                <Text style={{ color: entry.direction === "credit" ? GREEN : RED, fontSize: 12.5, fontWeight: "800" }}>{entry.direction === "credit" ? "+" : "-"}{formatMoney(entry.amount)}</Text>
                <Text numberOfLines={2} style={{ color: MUTED, fontSize: 11, flex: 1, textAlign: "right", marginLeft: 10 }}>{entry.note ?? "—"}{Number(entry.feeAmount) > 0 ? ` · رسوم ${formatMoney(entry.feeAmount)}` : ""} · الرصيد {formatMoney(entry.balanceAfter)}</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </View>
  );
}
