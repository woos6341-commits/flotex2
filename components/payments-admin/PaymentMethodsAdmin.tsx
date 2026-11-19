import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, Switch, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { resolvePaymentImageUrl } from "@/lib/payment-client";
import { PAYMENT_METHOD_IDS, PAYMENT_METHOD_LABELS, type PaymentMethod, type PaymentMethodId } from "./types";
import { PAYMENT_METHOD_FIELD_KINDS, type PaymentMethodField, type PaymentMethodFieldKind } from "@/shared/payment-method-fields";
import { ContactButtonsAdmin } from "./ContactButtonsAdmin";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FIELD_KIND_LABELS: Record<PaymentMethodFieldKind, string> = { text: "نص", number: "رقم", phone: "هاتف", reference: "مرجع", note: "ملاحظة" };
const DEFAULT_METHOD_IMAGES: Record<string, number> = {
  vodafone: require("@/assets/images/payments/vodafone.png"),
  orange: require("@/assets/images/payments/orange.png"),
  etisalat: require("@/assets/images/payments/etisalat.png"),
  instapay: require("@/assets/images/payments/instapay.png"),
};

type PaymentDirection = "deposit" | "withdrawal";
type MethodDraft = { name: string; transferNumber: string; imageData?: string; imageUrl?: string | null; localImageUri?: string; defaultImage?: number; depositFields: PaymentMethodField[]; withdrawalFields: PaymentMethodField[]; enabled: boolean; deleted?: boolean };
type Feedback = { tone: "success" | "error"; text: string } | null;

function imageMime(base64: string) {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  return null;
}

function FieldList({ fields, direction, onChange }: { fields: PaymentMethodField[]; direction: PaymentDirection; onChange: (fields: PaymentMethodField[]) => void }) {
  const addField = () => {
    if (fields.length >= 8) return;
    const key = `field_${Date.now().toString(36)}_${fields.length}`;
    onChange([...fields, { key, label: "حقل جديد", kind: "text", required: false, enabled: true, placeholder: "" }]);
  };
  const patchField = (index: number, patch: Partial<PaymentMethodField>) => onChange(fields.map((field, i) => i === index ? { ...field, ...patch } : field));
  const removeField = (index: number) => onChange(fields.filter((_, i) => i !== index));
  const moveField = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: "#273548", paddingTop: 12 }}>
    <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: "#F7F1E3", fontWeight: "800" }}>حقول {direction === "deposit" ? "الإيداع" : "السحب"} ({fields.length}/8)</Text>
      <Pressable onPress={addField} disabled={fields.length >= 8} style={{ borderColor: "#5C4A28", borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, opacity: fields.length >= 8 ? 0.45 : 1 }}><Text style={{ color: "#D7A948", fontWeight: "700" }}>إضافة حقل</Text></Pressable>
    </View>
    <Text style={{ color: "#9BA8B8", fontSize: 11, textAlign: "right", lineHeight: 18, marginTop: 5 }}>المبلغ ورقم المرسل/المستفيد والإيصال تبقى حقولًا مالية أساسية لا يمكن حذفها.</Text>
    {fields.map((field, index) => <View key={field.key} style={{ marginTop: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018" }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }}>
        <TextInput value={field.label} onChangeText={(label) => patchField(index, { label })} maxLength={48} placeholder="اسم الحقل" placeholderTextColor="#657286" style={{ flex: 1, marginLeft: 8, borderRadius: 10, borderWidth: 1, borderColor: "#273548", paddingHorizontal: 10, paddingVertical: 8, color: "#F7F1E3", textAlign: "right" }} />
        <View style={{ flexDirection: "row-reverse", alignItems: "center" }}>
          <Pressable onPress={() => moveField(index, -1)} disabled={index === 0} accessibilityRole="button" accessibilityLabel="تحريك الحقل لأعلى" style={{ padding: 7, opacity: index === 0 ? 0.35 : 1 }}><Text style={{ color: "#D7A948", fontSize: 11 }}>أعلى</Text></Pressable>
          <Pressable onPress={() => moveField(index, 1)} disabled={index === fields.length - 1} accessibilityRole="button" accessibilityLabel="تحريك الحقل لأسفل" style={{ padding: 7, opacity: index === fields.length - 1 ? 0.35 : 1 }}><Text style={{ color: "#D7A948", fontSize: 11 }}>أسفل</Text></Pressable>
          <Pressable onPress={() => removeField(index)} accessibilityRole="button" accessibilityLabel="حذف الحقل" style={{ padding: 7 }}><Text style={{ color: "#FF7D8D", fontWeight: "700" }}>حذف</Text></Pressable>
        </View>
      </View>
      <TextInput value={field.placeholder || ""} onChangeText={(placeholder) => patchField(index, { placeholder })} maxLength={80} placeholder="النص الإرشادي (اختياري)" placeholderTextColor="#657286" style={{ marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: "#273548", paddingHorizontal: 10, paddingVertical: 8, color: "#F7F1E3", textAlign: "right" }} />
      <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", marginTop: 9 }}>
        <Pressable onPress={() => { const current = PAYMENT_METHOD_FIELD_KINDS.indexOf(field.kind); const next = PAYMENT_METHOD_FIELD_KINDS[(current + 1) % PAYMENT_METHOD_FIELD_KINDS.length]; patchField(index, { kind: next }); }} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: "#273548" }}><Text style={{ color: "#D7A948", fontSize: 12 }}>النوع: {FIELD_KIND_LABELS[field.kind]} · اضغط للتغيير</Text></Pressable>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6 }}><Text style={{ color: "#9BA8B8", fontSize: 12 }}>مطلوب</Text><Switch value={field.required} onValueChange={(required) => patchField(index, { required })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={field.required ? "#D7A948" : "#9BA8B8"} /></View>
      </View>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", marginTop: 5 }}><Text style={{ color: "#9BA8B8", fontSize: 12 }}>{field.enabled === false ? "مخفي عن العميل" : "ظاهر للعميل"}</Text><View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6 }}><Text style={{ color: "#9BA8B8", fontSize: 12 }}>مفعّل</Text><Switch value={field.enabled !== false} onValueChange={(enabled) => patchField(index, { enabled })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={field.enabled !== false ? "#D7A948" : "#9BA8B8"} /></View></View>
    </View>)}
  </View>;
}

function MethodEditor({
  draft,
  direction,
  onPatch,
  onFieldsChange,
  onChooseLogo,
  onSave,
  onDelete,
  saving,
  isNew = false,
}: {
  draft: MethodDraft;
  direction: PaymentDirection;
  onPatch: (patch: Partial<MethodDraft>) => void;
  onFieldsChange: (fields: PaymentMethodField[]) => void;
  onChooseLogo: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  isNew?: boolean;
}) {
  const imageSource = draft.localImageUri || draft.imageData
    ? { uri: draft.localImageUri || draft.imageData }
    : draft.imageUrl
      ? { uri: resolvePaymentImageUrl(draft.imageUrl) || draft.imageUrl }
      : draft.defaultImage;
  return <View style={{ marginTop: 14, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018" }}>
    <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: "#F7F1E3", fontWeight: "800", flex: 1, textAlign: "right" }}>{isNew ? "وسيلة دفع جديدة" : draft.name}</Text>
      {!isNew && <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 5 }}><Text style={{ color: "#9BA8B8", fontSize: 11 }}>{draft.enabled ? "ظاهرة" : "مخفية"}</Text><Switch value={draft.enabled} onValueChange={(enabled) => onPatch({ enabled })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={draft.enabled ? "#D7A948" : "#9BA8B8"} /></View>}
    </View>
    {imageSource ? <Image source={imageSource} resizeMode="contain" style={{ width: 76, height: 64, borderRadius: 12, backgroundColor: "#121B28", marginTop: 10 }} /> : <View style={{ width: 76, height: 64, borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28", marginTop: 10, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#657286", fontSize: 10 }}>لا يوجد شعار</Text></View>}
    <TextInput value={draft.name} onChangeText={(name) => onPatch({ name })} maxLength={40} placeholder="اسم وسيلة الدفع" placeholderTextColor="#657286" style={{ marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28", color: "#F7F1E3", paddingHorizontal: 12, paddingVertical: 11, textAlign: "right" }} />
    <TextInput value={draft.transferNumber} onChangeText={(transferNumber) => onPatch({ transferNumber })} maxLength={120} placeholder="رقم التحويل / الحساب" placeholderTextColor="#657286" style={{ marginTop: 9, borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28", color: "#F7F1E3", paddingHorizontal: 12, paddingVertical: 11, textAlign: "right" }} />
    <FieldList fields={direction === "deposit" ? draft.depositFields : draft.withdrawalFields} direction={direction} onChange={onFieldsChange} />
    <View style={{ marginTop: 12, padding: 11, borderRadius: 14, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#121B28" }}>
      <Text style={{ color: "#D7A948", fontWeight: "800", textAlign: "right" }}>معاينة {direction === "deposit" ? "صفحة الإيداع" : "صفحة السحب"} قبل النشر</Text>
      {(direction === "deposit" ? draft.depositFields : draft.withdrawalFields).filter((field) => field.enabled !== false).length ? (direction === "deposit" ? draft.depositFields : draft.withdrawalFields).filter((field) => field.enabled !== false).map((field) => <View key={field.key} style={{ marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018", padding: 9 }}><Text style={{ color: "#F7F1E3", textAlign: "right", fontSize: 12 }}>{field.label}{field.required ? " · مطلوب" : " · اختياري"}</Text><Text style={{ marginTop: 4, color: "#657286", textAlign: "right", fontSize: 11 }}>{field.placeholder || `أدخل ${field.label}`}</Text></View>) : <Text style={{ color: "#9BA8B8", textAlign: "right", fontSize: 12, marginTop: 8 }}>لا توجد خانات إضافية مفعّلة.</Text>}
    </View>
    <View style={{ flexDirection: "row-reverse", gap: 8, marginTop: 12 }}>
      <View style={{ flex: 1 }}><ActionButton label="اختيار شعار" icon="image-outline" secondary onPress={onChooseLogo} /></View>
      <View style={{ flex: 1 }}><ActionButton label={saving ? "جارٍ الحفظ" : isNew ? "إضافة الوسيلة" : "حفظ التعديلات"} icon="save-outline" onPress={onSave} /></View>
    </View>
    {onDelete ? <Pressable disabled={saving} onPress={onDelete} style={{ marginTop: 9, padding: 11, alignItems: "center", borderRadius: 12, borderColor: draft.deleted ? "#2E6657" : "#6B3942", borderWidth: 1 }}><Text style={{ color: draft.deleted ? "#47D7A5" : "#FF7D8D", fontWeight: "700" }}>{draft.deleted ? "استعادة الوسيلة مع إعداداتها" : "حذف من قائمة العملاء مع حفظ الإعدادات"}</Text></Pressable> : null}
  </View>;
}

const emptyDraft = (): MethodDraft => ({ name: "", transferNumber: "", depositFields: [], withdrawalFields: [], enabled: true });

export function PaymentMethodsAdmin() {
  const methodsQuery = trpc.admin.paymentMethodsAdmin.useQuery();
  const serviceStatusQuery = trpc.admin.paymentServiceStatus.useQuery();
  const updateServiceStatus = trpc.admin.updatePaymentServiceStatus.useMutation({ onSuccess: () => { void serviceStatusQuery.refetch(); } });
  const createMethod = trpc.admin.createPaymentMethod.useMutation();
  const updateMethod = trpc.admin.updatePaymentMethod.useMutation();
  const deleteMethod = trpc.admin.deletePaymentMethod.useMutation();
  const [drafts, setDrafts] = useState<Record<string, MethodDraft>>({});
  const [newDraft, setNewDraft] = useState<MethodDraft>(emptyDraft());
  const [direction, setDirection] = useState<PaymentDirection>("deposit");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const methods = (methodsQuery.data ?? []) as PaymentMethod[];

  const draftFor = (method: PaymentMethod): MethodDraft => drafts[method.id] ?? ({
    name: method.name || PAYMENT_METHOD_LABELS[method.id as PaymentMethodId] || method.id,
    transferNumber: method.transferNumber || "",
    imageUrl: method.imageUrl,
    defaultImage: DEFAULT_METHOD_IMAGES[method.id],
    depositFields: method.depositFields || method.fields || [],
    withdrawalFields: method.withdrawalFields || method.fields || [],
    enabled: method.enabled !== false,
    deleted: method.deleted === true,
  } as MethodDraft);

  const chooseLogo = async (onPicked: (data: string, uri: string) => void) => {
    setFeedback(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.85, base64: true });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const base64 = asset.base64?.replace(/\s/g, "");
      const bytes = asset.fileSize ?? (base64 ? Math.ceil(base64.length * 3 / 4) : 0);
      if (!base64 || bytes > MAX_IMAGE_BYTES) throw new Error(bytes > MAX_IMAGE_BYTES ? "حجم الشعار يجب ألا يتجاوز 8 ميجابايت." : "تعذر قراءة الصورة المختارة.");
      const mime = imageMime(base64);
      if (!mime) throw new Error("اختر شعارًا بصيغة JPEG أو PNG أو WebP.");
      onPicked(`data:${mime};base64,${base64}`, asset.uri);
    } catch (error) {
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : "تعذر اختيار الشعار." });
    }
  };

  const saveNew = () => {
    setFeedback(null);
    if (newDraft.name.trim().length < 2) { setFeedback({ tone: "error", text: "أدخل اسم وسيلة الدفع." }); return; }
    createMethod.mutate({ name: newDraft.name.trim(), transferNumber: newDraft.transferNumber.trim(), depositFields: newDraft.depositFields, withdrawalFields: newDraft.withdrawalFields, ...(newDraft.imageData ? { imageData: newDraft.imageData } : {}) }, {
      onSuccess: () => { setNewDraft(emptyDraft()); setFeedback({ tone: "success", text: "تمت إضافة وسيلة الدفع وحفظها." }); void methodsQuery.refetch(); },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذرت إضافة وسيلة الدفع." }),
    });
  };

  const save = (method: PaymentMethod) => {
    setFeedback(null);
    const draft = draftFor(method);
    if (draft.name.trim().length < 2) { setFeedback({ tone: "error", text: "أدخل اسمًا واضحًا لوسيلة الدفع." }); return; }
    updateMethod.mutate({ id: method.id, name: draft.name.trim(), transferNumber: draft.transferNumber.trim(), depositFields: draft.depositFields, withdrawalFields: draft.withdrawalFields, enabled: draft.enabled, ...(draft.imageData ? { imageData: draft.imageData } : {}) }, {
      onSuccess: () => { setDrafts((previous) => { const next = { ...previous }; delete next[method.id]; return next; }); setFeedback({ tone: "success", text: `تم حفظ إعداد ${draft.name}.` }); void methodsQuery.refetch(); },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذر حفظ وسيلة الدفع." }),
    });
  };

  const remove = (method: PaymentMethod) => Alert.alert("حذف وسيلة الدفع", `هل تريد حذف ${method.name}؟ لا يؤثر ذلك في الطلبات السابقة المحفوظة باسم الوسيلة.`, [
    { text: "إلغاء", style: "cancel" },
    { text: "إخفاء", style: "destructive", onPress: () => deleteMethod.mutate({ id: method.id }, { onSuccess: () => { setFeedback({ tone: "success", text: "أُخفيت الوسيلة عن العملاء مع الاحتفاظ بالشعار والرقم والحقول لإمكان استعادتها." }); void methodsQuery.refetch(); }, onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذر إخفاء الوسيلة." }) }) },
  ]);

  const restore = (method: PaymentMethod) => {
    updateMethod.mutate({ id: method.id, name: method.name, transferNumber: method.transferNumber || "", depositFields: method.depositFields || method.fields || [], withdrawalFields: method.withdrawalFields || method.fields || [], enabled: true }, {
      onSuccess: () => { setFeedback({ tone: "success", text: "استُعيدت الوسيلة مع إعداداتها المحفوظة." }); void methodsQuery.refetch(); },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذرت استعادة الوسيلة." }),
    });
  };

  return <Card className="mb-4">
    <Text className="text-lg font-bold text-[#F7F1E3]">وسائل الدفع وحقولها</Text>
    <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">أضف الوسائل، وعدّل الشعار ورقم الاستقبال والحقول الاختيارية. تبقى حقول المبلغ والمستفيد/المرسل والإيصال المالية أساسية ولا يمكن تجاوزها.</Text>
    <View className="mt-4 rounded-2xl border border-[#5C4A28] bg-[#0B1018] p-3">
      <Text className="text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>حالة خدمات العمليات</Text>
      <Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تحكم مستقل: إيقاف إحدى الخدمتين لا يوقف الخدمة الأخرى، بينما إخفاء وسيلة دفع يظل مستقلًا عن حالة الخدمة.</Text>
      {serviceStatusQuery.isLoading ? <ActivityIndicator className="mt-3" color="#D7A948" /> : serviceStatusQuery.isError ? <Text className="mt-3 text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل حالة الإيداع والسحب.</Text> : <View className="mt-3 gap-2">
        <View className="flex-row items-center justify-between rounded-xl border border-[#273548] bg-[#121B28] px-3 py-2"><Text className="text-xs text-[#9BA8B8]">{serviceStatusQuery.data?.depositEnabled ? "الإيداع يعمل" : "الإيداع متوقف"}</Text><View className="flex-row items-center gap-2"><Text className="text-sm font-bold text-[#F7F1E3]">الإيداع</Text><Switch value={serviceStatusQuery.data?.depositEnabled !== false} disabled={updateServiceStatus.isPending} onValueChange={(depositEnabled) => updateServiceStatus.mutate({ depositEnabled })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={serviceStatusQuery.data?.depositEnabled !== false ? "#D7A948" : "#9BA8B8"} /></View></View>
        <View className="flex-row items-center justify-between rounded-xl border border-[#273548] bg-[#121B28] px-3 py-2"><Text className="text-xs text-[#9BA8B8]">{serviceStatusQuery.data?.withdrawalEnabled ? "السحب يعمل" : "السحب متوقف"}</Text><View className="flex-row items-center gap-2"><Text className="text-sm font-bold text-[#F7F1E3]">السحب</Text><Switch value={serviceStatusQuery.data?.withdrawalEnabled !== false} disabled={updateServiceStatus.isPending} onValueChange={(withdrawalEnabled) => updateServiceStatus.mutate({ withdrawalEnabled })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={serviceStatusQuery.data?.withdrawalEnabled !== false ? "#D7A948" : "#9BA8B8"} /></View></View>
      </View>}
    </View>
    <View className="mt-4 flex-row gap-2">
      {([{ id: "deposit", label: "إعدادات خانات الإيداع" }, { id: "withdrawal", label: "إعدادات خانات السحب" }] as const).map((item) => <Pressable key={item.id} onPress={() => setDirection(item.id)} className={`flex-1 items-center rounded-2xl border px-2 py-3 ${direction === item.id ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#121B28]"}`}><Text className={`text-center text-xs font-bold ${direction === item.id ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>{item.label}</Text></Pressable>)}
    </View>
    <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>كل قائمة مستقلة؛ تعديل خانات أحد الاتجاهين لا يغيّر الاتجاه الآخر. تُحفظ التغييرات بعد الضغط على حفظ التعديلات، ويمكن معاينة الحقول المفعّلة قبل ذلك.</Text>
    {feedback ? <Text className={`mt-3 text-sm ${feedback.tone === "error" ? "text-[#FF7D8D]" : "text-[#47D7A5]"}`}>{feedback.text}</Text> : null}
    {methodsQuery.isLoading ? <ActivityIndicator className="mt-5" color="#D7A948" /> : methodsQuery.isError ? <Text className="mt-4 text-sm text-[#FF7D8D]">تعذر تحميل وسائل الدفع.</Text> : methods.map((method) => {
      const draft = draftFor(method);
      const fallbackName = PAYMENT_METHOD_LABELS[method.id as PaymentMethodId];
      return <View key={method.id} className="mt-4 rounded-2xl border border-[#273548] bg-[#121B28] p-3">
        <View className="flex-row items-center justify-between"><Text className="font-bold text-[#F7F1E3]">{draft.name || fallbackName || method.id}</Text><Pill tone={draft.deleted ? "muted" : draft.enabled ? (draft.transferNumber ? "green" : "muted") : "muted"}>{draft.deleted ? "محذوفة من العرض · الإعدادات محفوظة" : draft.enabled ? (draft.transferNumber ? "مفعّلة" : "تحتاج رقم استقبال") : "مخفية"}</Pill></View>
        <MethodEditor
          draft={draft}
          direction={direction}
          onPatch={(patch) => setDrafts((previous) => ({ ...previous, [method.id]: { ...draft, ...patch } }))}
          onFieldsChange={(fields) => setDrafts((previous) => ({ ...previous, [method.id]: { ...draft, [direction === "deposit" ? "depositFields" : "withdrawalFields"]: fields } }))}
          onChooseLogo={() => void chooseLogo((imageData, localImageUri) => setDrafts((previous) => ({ ...previous, [method.id]: { ...draft, imageData, localImageUri } })))}
          onSave={() => save(method)}
          onDelete={PAYMENT_METHOD_IDS.includes(method.id) ? undefined : () => method.deleted ? restore(method) : remove(method)}
          saving={updateMethod.isPending || deleteMethod.isPending}
        />
      </View>;
    })}
    <MethodEditor
      draft={newDraft}
      direction={direction}
      onPatch={(patch) => setNewDraft((previous) => ({ ...previous, ...patch }))}
      onFieldsChange={(fields) => setNewDraft((previous) => ({ ...previous, [direction === "deposit" ? "depositFields" : "withdrawalFields"]: fields }))}
      onChooseLogo={() => void chooseLogo((imageData, localImageUri) => setNewDraft((previous) => ({ ...previous, imageData, localImageUri })))}
      onSave={saveNew}
      saving={createMethod.isPending}
      isNew
    />
    <ContactButtonsAdmin />
  </Card>;
}
