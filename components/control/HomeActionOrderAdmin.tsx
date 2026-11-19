import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Card } from "@/components/atheer-ui";
import { ButtonLayoutCanvas } from "@/components/ButtonLayoutCanvas";
import { trpc } from "@/lib/trpc";
import { defaultButtonLayout, isValidButtonLayout, moveButton, type ButtonLayout, type ButtonPosition, type LayoutSurface } from "@/shared/button-layout";

export function HomeActionOrderAdmin() {
  const [surface, setSurface] = useState<LayoutSurface>("home");
  return <View>
    <Card className="mb-4">
      <Text style={{ color: "#F7F1E3", fontSize: 16, fontWeight: "700", textAlign: "right" }}>إدارة مواضع أزرار التطبيق</Text>
      <Text style={{ color: "#9BA8B8", fontSize: 12, lineHeight: 20, marginTop: 6, textAlign: "right" }}>حرّك أزرار الخدمات والدعم في الرئيسية أو المحفظة بالإصبع أو الماوس داخل مساحة المعاينة، ثم احفظ. لا تشمل هذه اللوحة أزرار الصفحات الأخرى والنماذج.</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>{(["home", "wallet"] as const).map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setSurface(item)} style={{ flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: surface === item ? "#D7A948" : "#273548", backgroundColor: surface === item ? "#D7A94822" : "#121B28" }}><Text style={{ color: surface === item ? "#D7A948" : "#9BA8B8", textAlign: "center", fontWeight: "700" }}>{item === "home" ? "الرئيسية" : "المحفظة"}</Text></Pressable>)}</View>
      <Text style={{ color: "#9BA8B8", fontSize: 11, lineHeight: 18, marginTop: 8, textAlign: "right" }}>عند تغيير الشاشة تُلغى التعديلات غير المحفوظة. لا يمكن إسقاط زر فوق زر آخر.</Text>
    </Card>
    <SurfaceEditor key={surface} surface={surface} />
    <LayoutAudit />
  </View>;
}

function SurfaceEditor({ surface }: { surface: LayoutSurface }) {
  const utils = trpc.useUtils();
  const query = trpc.buttonLayout.get.useQuery({ surface }, { refetchOnWindowFocus: true });
  const oldOrder = trpc.homeActionOrder.get.useQuery(undefined, { enabled: surface === "home" });
  const save = trpc.admin.buttonLayout.save.useMutation();
  const reset = trpc.admin.buttonLayout.reset.useMutation();
  const serverLayout = query.data ?? defaultButtonLayout(surface, oldOrder.data);
  const base = JSON.stringify({ serverLayout, custom: query.data !== null });
  const [draft, setDraft] = useState<{ base: string; layout: ButtonLayout } | null>(null);
  const [message, setMessage] = useState("");
  const layout = draft?.base === base ? draft.layout : serverLayout;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const busy = save.isPending || reset.isPending;
  const ready = query.isSuccess && (surface !== "home" || oldOrder.isSuccess);
  const dirty = JSON.stringify(layout) !== JSON.stringify(serverLayout);
  const update = (next: ButtonLayout) => { layoutRef.current = next; setDraft({ base, layout: next }); };
  const move = (id: string, x: number, y: number) => update(moveButton(layoutRef.current, id, x, y));
  const drop = (id: string, x: number, y: number, origin: ButtonPosition) => {
    const candidate = moveButton(layoutRef.current, id, x, y);
    if (isValidButtonLayout(surface, candidate)) { update(candidate); setMessage(""); }
    else { update(moveButton(candidate, id, origin.x, origin.y)); setMessage("المكان مشغول؛ أُعيد الزر إلى موضعه السابق."); }
  };
  const refresh = async () => {
    await Promise.all([utils.buttonLayout.get.invalidate({ surface }), utils.homeActionOrder.get.invalidate(), utils.uiButtonVisibility.mine.invalidate(), utils.admin.buttonLayout.audit.invalidate()]);
  };
  return <Card className="mb-4">
    <Text style={{ color: "#D7A948", textAlign: "right", fontWeight: "700" }}>معاينة {surface === "home" ? "خدمات الرئيسية" : "خدمات المحفظة"}</Text>
    <Text style={{ color: "#9BA8B8", fontSize: 11, lineHeight: 18, textAlign: "right", marginTop: 5 }}>المعاينة لمساحة الخدمات وليست الشاشة كلها. بعد الحفظ يظهر زر الدعم هنا بدلاً من موضعه العلوي؛ الأزرار المخفية بإعدادات الظهور تبقى مخفية للمستخدم.</Text>
    {surface === "home" ? <Text style={{ color: "#C7B98D", fontSize: 11, lineHeight: 18, textAlign: "right", marginTop: 5 }}>التصميم المحفوظ يطبق على الجميع ويتقدم مؤقتاً على ترتيب الأربعة أزرار المخصص للعميل. بعد الإعادة يعود التخصيص الفردي القديم إن وُجد.</Text> : null}
    {ready ? <View pointerEvents={busy ? "none" : "auto"} style={{ marginTop: 12, borderWidth: 1, borderColor: "#273548", borderRadius: 16, overflow: "hidden" }}><View style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: "#273548", backgroundColor: "#121B28" }}><Text style={{ color: "#E6E0D5", fontSize: 12, textAlign: "right" }}>رصيد المحفظة   •   الخدمات</Text></View><ButtonLayoutCanvas surface={surface} layout={layout} editable onMove={move} onDrop={drop} /></View> : query.isError || oldOrder.isError ? <Text style={{ color: "#FF7D8D", textAlign: "right", marginTop: 12 }}>تعذر تحميل الإعداد الحالي؛ لن يمكن الحفظ قبل إعادة المحاولة.</Text> : <ActivityIndicator color="#D7A948" style={{ marginTop: 14 }} />}
    {message ? <Text accessibilityRole="alert" style={{ color: "#FFB98D", textAlign: "right", marginTop: 8, fontSize: 12 }}>{message}</Text> : null}
    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
      <Pressable accessibilityRole="button" disabled={!ready || !dirty || busy || !isValidButtonLayout(surface, layout)} onPress={() => { setMessage(""); save.mutate({ surface, layout }, { onSuccess: (saved) => { utils.buttonLayout.get.setData({ surface }, saved); setDraft(null); setMessage("تم حفظ المواضع. تظهر للمستخدمين عند التحديث التالي."); void refresh(); } }); }} style={{ flex: 1, padding: 12, alignItems: "center", borderRadius: 12, backgroundColor: ready && dirty && !busy ? "#D7A948" : "#343B46" }}><Text style={{ color: "#11151B", fontWeight: "700" }}>{save.isPending ? "جارٍ الحفظ…" : "حفظ المواضع"}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={!ready || busy} onPress={() => { setMessage(""); reset.mutate({ surface }, { onSuccess: () => { utils.buttonLayout.get.setData({ surface }, null); setDraft(null); setMessage("أُعيد التصميم العام الأصلي."); void refresh(); } }); }} style={{ padding: 12, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#5C4A28" }}><Text style={{ color: "#D7A948", fontWeight: "700" }}>{reset.isPending ? "جارٍ الإعادة…" : "إعادة للافتراضي"}</Text></Pressable>
    </View>
    {save.isError || reset.isError ? <Text accessibilityRole="alert" style={{ color: "#FF7D8D", textAlign: "right", marginTop: 8, fontSize: 12 }}>تعذر حفظ التغيير أو تسجيله. تحقق من قاعدة البيانات ثم أعد المحاولة.</Text> : null}
  </Card>;
}

function LayoutAudit() {
  const audit = trpc.admin.buttonLayout.audit.useQuery(undefined, { refetchOnWindowFocus: true });
  const labels = { save: "حفظ مواضع", reset: "إعادة للافتراضي", "legacy-global": "تغيير الترتيب العام القديم", "legacy-customer": "تغيير الترتيب الفردي القديم", "legacy-customer-reset": "إلغاء الترتيب الفردي القديم" };
  return <Card className="mb-4"><Text style={{ color: "#F7F1E3", fontWeight: "700", textAlign: "right" }}>سجل تغييرات المواضع</Text>{audit.isError ? <Text style={{ color: "#FF7D8D", textAlign: "right", marginTop: 8 }}>تعذر تحميل السجل.</Text> : audit.isLoading ? <ActivityIndicator color="#D7A948" /> : audit.data?.length ? audit.data.map((entry, index) => <Text key={`${entry.at}-${index}`} style={{ color: "#9BA8B8", textAlign: "right", fontSize: 11, lineHeight: 19, marginTop: 5 }}>{labels[entry.action] ?? "تغيير"} · {entry.surface === "home" ? "الرئيسية" : "المحفظة"}{entry.targetUserId ? ` · العميل #${entry.targetUserId}` : ""} · المدير #{entry.actorId} · {new Date(entry.at).toLocaleString("ar-EG")}</Text>) : <Text style={{ color: "#9BA8B8", textAlign: "right", marginTop: 8 }}>لا توجد تغييرات مسجلة بعد.</Text>}</Card>;
}
