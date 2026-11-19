import { useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import { FontAwesome, Ionicons } from "@expo/vector-icons";
import type { ContactButton, ContactButtonType } from "@/shared/contact-buttons";
import { trpc } from "@/lib/trpc";
import { confirmFinancialAction } from "@/lib/financial-feedback";

type Draft = Pick<ContactButton, "type" | "name" | "target" | "visible">;
type Feedback = { tone: "success" | "error"; text: string } | null;
const EMPTY_DRAFT: Draft = { type: "whatsapp", name: "", target: "", visible: true };
const TYPE_OPTIONS: { id: ContactButtonType; label: string }[] = [
  { id: "whatsapp", label: "واتساب" },
  { id: "telegram", label: "تليجرام" },
  { id: "custom", label: "رابط مخصص" },
];

function BrandIcon({ type, size = 17, color = "#D7A948" }: { type: ContactButtonType; size?: number; color?: string }) {
  if (type === "whatsapp") return <FontAwesome name="whatsapp" size={size} color={color === "#D7A948" ? "#47D7A5" : color} />;
  if (type === "telegram") return <FontAwesome name="telegram" size={size} color={color === "#D7A948" ? "#72B9FF" : color} />;
  return <Ionicons name="link-outline" size={size} color={color} />;
}

function targetLabel(type: ContactButtonType) {
  if (type === "whatsapp") return "رقم الهاتف أو رابط محادثة WhatsApp";
  if (type === "telegram") return "اسم الحساب أو رابط Telegram";
  return "رابط HTTPS";
}
function targetHint(type: ContactButtonType) {
  if (type === "whatsapp") return "يمكن إدخال رقم مصري مثل 01012345678 أو رابط wa.me. حوّل الأرقام الدولية إلى رمز الدولة المناسب.";
  if (type === "telegram") return "أدخل @اسم_الحساب أو رابط t.me للمستخدم أو المجموعة.";
  return "استخدم رابطًا عامًا آمنًا يبدأ بـ https:// مثل https://example.com/help.";
}

function ContactButtonEditor({
  draft,
  onPatch,
  onSave,
  onDelete,
  saving,
  isNew = false,
}: {
  draft: Draft;
  onPatch: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  isNew?: boolean;
}) {
  return <View style={{ marginTop: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: "#273548", backgroundColor: "#0B1018" }}>
    <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}><BrandIcon type={draft.type} /><Text style={{ color: "#F7F1E3", fontWeight: "800" }}>{isNew ? "زر تواصل جديد" : draft.name || "زر تواصل"}</Text></View>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 5 }}><Text style={{ color: "#9BA8B8", fontSize: 11 }}>{draft.visible ? "ظاهر" : "مخفي"}</Text><Switch value={draft.visible} onValueChange={(visible) => onPatch({ visible })} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={draft.visible ? "#D7A948" : "#9BA8B8"} /></View>
    </View>
    <Text style={{ marginTop: 12, color: "#9BA8B8", fontSize: 11, textAlign: "right" }}>نوع الزر</Text>
    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 7, marginTop: 7 }}>
      {TYPE_OPTIONS.map((option) => <Pressable key={option.id} onPress={() => onPatch({ type: option.id, target: "" })} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: draft.type === option.id ? "#D7A948" : "#273548", backgroundColor: draft.type === option.id ? "#211D12" : "#121B28" }}>
        <BrandIcon type={option.id} size={15} />
        <Text style={{ color: draft.type === option.id ? "#D7A948" : "#9BA8B8", fontSize: 11, fontWeight: "700" }}>{option.label}</Text>
      </Pressable>)}
    </View>
    <TextInput value={draft.name} onChangeText={(name) => onPatch({ name })} maxLength={48} placeholder="اسم الزر الذي يراه المستخدم" placeholderTextColor="#657286" style={{ marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28", color: "#F7F1E3", paddingHorizontal: 12, paddingVertical: 11, textAlign: "right" }} />
    <TextInput value={draft.target} onChangeText={(target) => onPatch({ target })} maxLength={500} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={targetLabel(draft.type)} placeholderTextColor="#657286" style={{ marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28", color: "#F7F1E3", paddingHorizontal: 12, paddingVertical: 11, textAlign: "left" }} />
    <Text style={{ marginTop: 6, color: "#657286", fontSize: 10, lineHeight: 16, textAlign: "right" }}>{targetHint(draft.type)}</Text>
    <Pressable disabled={saving} onPress={onSave} style={({ pressed }) => ({ minHeight: 43, marginTop: 10, borderRadius: 12, backgroundColor: "#D7A948", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 7, opacity: saving || pressed ? 0.7 : 1 })}>
      <Ionicons name="save-outline" size={17} color="#0B1018" />
      <Text style={{ color: "#0B1018", fontWeight: "800" }}>{saving ? "جارٍ الحفظ" : isNew ? "إضافة زر التواصل" : "حفظ التعديلات"}</Text>
    </Pressable>
    {onDelete ? <Pressable disabled={saving} onPress={onDelete} style={{ minHeight: 40, marginTop: 7, borderRadius: 12, borderWidth: 1, borderColor: "#6B3942", alignItems: "center", justifyContent: "center", opacity: saving ? 0.6 : 1 }}><Text style={{ color: "#FF7D8D", fontWeight: "700" }}>حذف زر التواصل</Text></Pressable> : null}
  </View>;
}

export function ContactButtonsAdmin() {
  const utils = trpc.useUtils();
  const query = trpc.admin.contactButtonsAdmin.useQuery();
  const create = trpc.admin.createContactButton.useMutation();
  const update = trpc.admin.updateContactButton.useMutation();
  const remove = trpc.admin.deleteContactButton.useMutation();
  const reorder = trpc.admin.reorderContactButtons.useMutation();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const buttons = query.data ?? [];

  const draftFor = (button: ContactButton): Draft => drafts[button.id] ?? ({ type: button.type, name: button.name, target: button.target, visible: button.visible });
  const patchExisting = (button: ContactButton, patch: Partial<Draft>) => setDrafts((previous) => ({ ...previous, [button.id]: { ...draftFor(button), ...patch } }));
  const refresh = () => { void query.refetch(); void utils.payment.contactButtons.invalidate(); };

  const createButton = () => {
    setFeedback(null);
    create.mutate(newDraft, {
      onSuccess: () => { setNewDraft(EMPTY_DRAFT); setFeedback({ tone: "success", text: "تمت إضافة زر التواصل وحفظه." }); refresh(); },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذرت إضافة زر التواصل." }),
    });
  };

  const saveButton = (button: ContactButton) => {
    setFeedback(null);
    update.mutate({ id: button.id, ...draftFor(button) }, {
      onSuccess: () => { setDrafts((previous) => { const next = { ...previous }; delete next[button.id]; return next; }); setFeedback({ tone: "success", text: "تم حفظ زر التواصل." }); refresh(); },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذر حفظ زر التواصل." }),
    });
  };

  const deleteButton = async (button: ContactButton) => {
    if (!(await confirmFinancialAction("حذف زر التواصل", `سيُحذف «${button.name}» من وسائل الدفع. هل تريد المتابعة؟`))) return;
    remove.mutate({ id: button.id }, {
      onSuccess: () => { setFeedback({ tone: "success", text: "تم حذف زر التواصل." }); refresh(); },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذر حذف زر التواصل." }),
    });
  };

  const moveButton = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= buttons.length || reorder.isPending) return;
    const ids = buttons.map((button) => button.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    setFeedback(null);
    reorder.mutate({ ids }, {
      onSuccess: () => { setFeedback({ tone: "success", text: "تم حفظ ترتيب أزرار التواصل." }); refresh(); },
      onError: (error) => setFeedback({ tone: "error", text: error.message || "تعذر تغيير الترتيب." }),
    });
  };

  return <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: "#273548", paddingTop: 15 }}>
    <Text style={{ color: "#F7F1E3", fontSize: 16, fontWeight: "800", textAlign: "right" }}>أزرار التواصل ضمن وسائل الدفع</Text>
    <Text style={{ marginTop: 4, color: "#9BA8B8", fontSize: 11, lineHeight: 18, textAlign: "right" }}>أضف واتساب أو تليجرام أو رابطًا مخصصًا، وحدد ظهوره وترتيبه. تبقى الإعدادات محفوظة في قاعدة البيانات.</Text>
    {feedback ? <Text style={{ marginTop: 8, color: feedback.tone === "error" ? "#FF7D8D" : "#47D7A5", fontSize: 12, textAlign: "right" }}>{feedback.text}</Text> : null}
    {query.isLoading ? <ActivityIndicator style={{ marginTop: 12 }} color="#D7A948" /> : query.isError ? <Text style={{ marginTop: 10, color: "#FF7D8D", fontSize: 12, textAlign: "right" }}>تعذر تحميل أزرار التواصل.</Text> : buttons.length === 0 ? <Text style={{ marginTop: 10, color: "#657286", fontSize: 12, textAlign: "right" }}>لا توجد أزرار تواصل مضافة بعد.</Text> : buttons.map((button, index) => {
      const draft = draftFor(button);
      const saving = update.isPending || remove.isPending || reorder.isPending;
      return <View key={button.id} style={{ marginTop: 10, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28" }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, flex: 1 }}><BrandIcon type={draft.type} /><Text numberOfLines={1} style={{ flex: 1, color: "#F7F1E3", fontSize: 13, fontWeight: "800", textAlign: "right" }}>{draft.name || button.name}</Text><Text style={{ color: "#657286", fontSize: 10 }}>#{index + 1}</Text></View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable accessibilityRole="button" accessibilityLabel="رفع ترتيب الزر" disabled={index === 0 || reorder.isPending} onPress={() => moveButton(index, -1)} style={{ padding: 7, opacity: index === 0 || reorder.isPending ? 0.35 : 1 }}><Ionicons name="arrow-up" size={17} color="#D7A948" /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="خفض ترتيب الزر" disabled={index === buttons.length - 1 || reorder.isPending} onPress={() => moveButton(index, 1)} style={{ padding: 7, opacity: index === buttons.length - 1 || reorder.isPending ? 0.35 : 1 }}><Ionicons name="arrow-down" size={17} color="#D7A948" /></Pressable>
          </View>
        </View>
        <ContactButtonEditor draft={draft} onPatch={(patch) => patchExisting(button, patch)} onSave={() => saveButton(button)} onDelete={() => void deleteButton(button)} saving={saving} />
      </View>;
    })}
    <ContactButtonEditor draft={newDraft} onPatch={(patch) => setNewDraft((previous) => ({ ...previous, ...patch }))} onSave={createButton} saving={create.isPending} isNew />
  </View>;
}
