import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, Switch, Text, TextInput, View } from "react-native";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { manualVerificationClient } from "@/lib/manual-verification-client";
import { confirmFinancialAction, showFinancialMessage } from "@/lib/financial-feedback";
import { issueManualVerificationSchema } from "@/shared/manual-verification";

const api = manualVerificationClient.verificationAssistance;
type History = Awaited<ReturnType<typeof api.list.query>>;
const inputStyle = { minHeight: 46, borderWidth: 1, borderColor: "#273548", borderRadius: 13, backgroundColor: "#0B1018", color: "#F7F1E3", paddingHorizontal: 12, fontSize: 14, textAlign: "right" as const };
const statusLabels: Record<string, string> = { active: "صالح", used: "مستخدم", revoked: "ملغى", expired: "منتهي", locked: "موقوف بالمحاولات" };
function date(value: Date | string | null) { return value ? new Date(value).toLocaleString("ar-EG") : "—"; }

export function ManualVerificationAdmin() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState<"register" | "password_reset">("register");
  const [validity, setValidity] = useState("10");
  const [attempts, setAttempts] = useState("5");
  const [method, setMethod] = useState<"in_person" | "approved_review">("in_person");
  const [caseRef, setCaseRef] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [issued, setIssued] = useState<Awaited<ReturnType<typeof api.issue.mutate>> | null>(null);
  const [rows, setRows] = useState<History>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const issue = useEphemeralMutation(api.issue.mutate);
  const revoke = useEphemeralMutation(api.revoke.mutate);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await api.list.query()); } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل السجل."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let alive = true;
    void api.list.query().then((items) => { if (alive) setRows(items); }, (e) => { if (alive) setError(e instanceof Error ? e.message : "تعذر تحميل السجل."); }).finally(() => { if (alive) setLoading(false); });
    const listener = AppState.addEventListener("change", (state) => { if (state !== "active") setIssued(null); });
    return () => { alive = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (!issued) return;
    const timeout = setTimeout(() => setIssued(null), Math.max(0, new Date(issued.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timeout);
  }, [issued]);
  const submit = async () => {
    if (issue.isPending) return;
    setIssued(null);
    const parsed = issueManualVerificationSchema.safeParse({ email, purpose, ...(purpose === "register" ? { phoneNumber: phone } : {}), validityMinutes: Number(validity), maxAttempts: Number(attempts), ownershipConfirmed: confirmed, ownershipMethod: method, ownershipCaseRef: caseRef });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "راجع بيانات الرمز وتأكيد الملكية."); return; }
    if (!await confirmFinancialAction("إصدار رمز يدوي", `البريد: ${parsed.data.email}\nالغرض: ${purpose === "register" ? "تسجيل جديد" : "استعادة كلمة المرور"}\nمرجع المراجعة: ${caseRef}\n\nأكد فقط بعد التحقق الفعلي من ملكية البريد وإثباتها في المرجع.`)) return;
    try { const result = await issue.mutateAsync(parsed.data); setIssued(result); setConfirmed(false); setError(""); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر إصدار الرمز."); }
  };
  const cancel = async (id: string) => {
    if (revoke.isPending || !await confirmFinancialAction("إلغاء الرمز", "سيُمنع الرمز وأي منحة يدوية لم تُستهلك بعد من العمل.")) return;
    try { await revoke.mutateAsync({ id }); if (issued?.id === id) setIssued(null); await refresh(); }
    catch (e) { showFinancialMessage("تعذر الإلغاء", e instanceof Error ? e.message : "حاول مجددًا."); }
  };
  return <View className="gap-4">
    <Card>
      <View className="flex-row items-center justify-between"><Pill tone="gold">إجراء موثق</Pill><Text className="text-base font-bold text-[#F7F1E3]">إدارة رموز التحقق والحسابات</Text></View>
      <Text className="mt-3 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>لا تُصدر الرمز قبل التحقق الفعلي من ملكية البريد وفق إجراء الإدارة وتوثيق النتيجة في قضية مستقلة. التأكيد هنا إقرار مسؤول وليس تحققًا آليًا. الرمز لا يصلح لحساب الإدارة ولا يُرسل بالبريد.</Text>
      <TextInput accessibilityLabel="البريد المقصود" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="البريد المقصود" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 14, writingDirection: "ltr", textAlign: "left" }} />
      <View className="mt-3 flex-row gap-2">{(["register", "password_reset"] as const).map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => { setPurpose(item); setIssued(null); }} style={{ flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: purpose === item ? "#D7A948" : "#273548" }}><Text className="text-xs font-bold text-[#F7F1E3]" style={{ textAlign: "center" }}>{item === "register" ? "تسجيل جديد" : "استعادة كلمة المرور"}</Text></Pressable>)}</View>
      {purpose === "register" ? <TextInput accessibilityLabel="هاتف التسجيل" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="رقم الهاتف للتسجيل" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 10 }} /> : null}
      <View className="mt-3 flex-row gap-2"><View style={{ flex: 1 }}><Text className="mb-1 text-xs text-[#C7B98D]" style={{ textAlign: "right" }}>الصلاحية بالدقائق (1–15)</Text><TextInput accessibilityLabel="الصلاحية بالدقائق" value={validity} onChangeText={setValidity} keyboardType="number-pad" style={inputStyle} /></View><View style={{ flex: 1 }}><Text className="mb-1 text-xs text-[#C7B98D]" style={{ textAlign: "right" }}>المحاولات (1–5)</Text><TextInput accessibilityLabel="عدد المحاولات" value={attempts} onChangeText={setAttempts} keyboardType="number-pad" style={inputStyle} /></View></View>
      <Text className="mt-3 text-xs text-[#C7B98D]" style={{ textAlign: "right" }}>طريقة مراجعة الملكية</Text><View className="mt-2 flex-row gap-2">{(["in_person", "approved_review"] as const).map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setMethod(item)} style={{ flex: 1, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: method === item ? "#D7A948" : "#273548" }}><Text className="text-xs text-[#F7F1E3]" style={{ textAlign: "center" }}>{item === "in_person" ? "مراجعة حضورية" : "إجراء معتمد آخر"}</Text></Pressable>)}</View>
      <TextInput accessibilityLabel="مرجع قضية إثبات الملكية" value={caseRef} onChangeText={setCaseRef} autoCapitalize="none" autoCorrect={false} maxLength={80} placeholder="مرجع قضية المراجعة، بلا مستندات أو بيانات سرية" placeholderTextColor="#657286" style={{ ...inputStyle, marginTop: 10 }} />
      <View className="mt-3 flex-row items-center"><Switch value={confirmed} onValueChange={setConfirmed} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={confirmed ? "#D7A948" : "#9BA8B8"} /><Text className="flex-1 text-xs leading-5 text-[#C7B98D]" style={{ textAlign: "right" }}>تحققت فعليًا من ملكية البريد ووثّقت المراجعة في القضية المذكورة.</Text></View>
      <View className="mt-4"><ActionButton label={issue.isPending ? "جارٍ الإصدار..." : "إصدار رمز لمرة واحدة"} icon="key-outline" onPress={() => void submit()} /></View>
      {error ? <Text accessibilityRole="alert" className="mt-3 text-xs text-[#FF7D8D]" style={{ textAlign: "right" }}>{error}</Text> : null}
      {issued ? <View className="mt-4 rounded-xl border border-[#D7A948] bg-[#171D27] p-3"><Text className="text-xs leading-5 text-[#F7F1E3]" style={{ textAlign: "right" }}>يظهر مرة واحدة فقط. سلّم رقم الطلب والرمز للمالك بعد التحقق من هويته عبر قناة آمنة، ولا تحفظهما في السجل.</Text><Text selectable className="mt-2 text-sm font-bold text-[#D7A948]" style={{ textAlign: "center" }}>{issued.id}</Text><Text selectable className="mt-2 text-2xl font-bold text-[#F7F1E3]" style={{ textAlign: "center", letterSpacing: 5 }}>{issued.code}</Text><Text className="mt-2 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>ينتهي: {date(issued.expiresAt)}</Text><Pressable accessibilityRole="button" onPress={() => setIssued(null)}><Text className="mt-3 text-xs font-bold text-[#D7A948]" style={{ textAlign: "right" }}>إخفاء الآن</Text></Pressable></View> : null}
    </Card>
    <Card><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" onPress={() => void refresh()}><Text className="text-xs text-[#D7A948]">تحديث</Text></Pressable><Text className="text-base font-bold text-[#F7F1E3]">السجل (آخر 100)</Text></View>
      {loading ? <ActivityIndicator color="#D7A948" /> : null}
      {!loading && !rows.length ? <Text className="mt-3 text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>لا توجد سجلات.</Text> : null}
      {rows.map((row) => <View key={row.id} className="mt-3 rounded-xl border border-[#273548] bg-[#0B1018] p-3"><View className="flex-row items-center justify-between"><Pill tone={row.status === "active" ? "green" : "muted"}>{statusLabels[row.status]}</Pill><Text className="text-xs font-bold text-[#F7F1E3]">{row.email}</Text></View><Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>الغرض: {row.purpose === "register" ? "تسجيل" : "استعادة"} · الإصدار: {date(row.createdAt)} · المسؤول: {row.issuedByName}{"\n"}ينتهي: {date(row.expiresAt)} · المحاولات: {row.attemptCount}/{row.maxAttempts}{"\n"}القضية: {row.ownershipCaseRef} · الطريقة: {row.ownershipMethod === "in_person" ? "حضوري" : "إجراء معتمد"}{"\n"}الاستخدام: {date(row.usedAt)} · الإلغاء: {date(row.revokedAt)}{row.revokedAt ? ` · بواسطة ${row.revokedByName || "—"} (${row.revokeReason === "replacement" ? "استبدال" : "إلغاء إداري"})` : ""}</Text>{!row.revokedAt && (row.status === "active" || row.status === "used") ? <Pressable accessibilityRole="button" onPress={() => void cancel(row.id)}><Text className="mt-3 text-xs font-bold text-[#FF7D8D]" style={{ textAlign: "right" }}>إلغاء الرمز والمنحة غير المستخدمة</Text></Pressable> : null}</View>)}
    </Card>
  </View>;
}
