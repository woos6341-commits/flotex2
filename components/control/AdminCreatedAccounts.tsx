import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { ActionButton, Card, EmptyState, Pill } from "@/components/atheer-ui";
import { adminCreatedAccountStateLabel, type AdminCreatedAccountCreateInput, type AdminCreatedAccountView } from "@/shared/admin-created-accounts";

/** The parent binds these methods to the separately mounted, administrator-only tRPC router. */
export type AdminCreatedAccountsApi = {
  list(): Promise<AdminCreatedAccountView[]>;
  create(input: AdminCreatedAccountCreateInput): Promise<unknown>;
  submit(input: { id: string }): Promise<unknown>;
  recordIdentity(input: { id: string; evidenceRef: string }): Promise<unknown>;
  issueInvitation(input: { id: string }): Promise<unknown>;
  suspend(input: { id: string; suspended: boolean; reason: string }): Promise<unknown>;
};

const inputClass = "mb-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]";

export function AdminCreatedAccounts({ api, invitationsEnabled = false }: { api: AdminCreatedAccountsApi; invitationsEnabled?: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [records, setRecords] = useState<AdminCreatedAccountView[]>([]);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => { const result = await api.list(); setRecords(result); setLoaded(true); }, [api]);
  useEffect(() => {
    let alive = true;
    void api.list().then((rows) => { if (alive) { setRecords(rows); setLoaded(true); } }, () => { if (alive) { setMessage("تعذر تحميل الطلبات. تحقق من الصلاحيات والاتصال."); setLoaded(true); } });
    return () => { alive = false; };
  }, [api]);
  async function perform(work: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await work(); await load(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "تعذر إتمام العملية."); }
    finally { setBusy(false); }
  }
  return <View>
    <Text className="mb-1 text-right text-lg font-bold text-[#F7F1E3]">إنشاء حساب عميل</Text>
    <Text className="mb-4 text-right text-xs leading-5 text-[#9BA8B8]">يُحفظ طلب غير قابل للدخول؛ لا يُرسل رمز عند الإنشاء. يلزم مراجعة هوية موثّقة، ثم دعوة خاصة لصاحب البريد. لا تمنح هذه الصفحة صلاحية مالية أو تطّلع على كلمة المرور.</Text>
    <Card className="mb-4">
      <Text className="mb-2 text-right font-bold text-[#F7F1E3]">البيانات الأساسية</Text>
      <TextInput accessibilityLabel="الاسم الكامل" value={name} onChangeText={setName} placeholder="الاسم الكامل" placeholderTextColor="#657286" maxLength={120} className={inputClass} />
      <TextInput accessibilityLabel="البريد الإلكتروني" value={email} onChangeText={setEmail} placeholder="البريد الإلكتروني" placeholderTextColor="#657286" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={320} className={inputClass} />
      <TextInput accessibilityLabel="رقم الهاتف اختياري" value={phone} onChangeText={setPhone} placeholder="رقم الهاتف (اختياري)" placeholderTextColor="#657286" keyboardType="phone-pad" maxLength={20} className={inputClass} />
      <ActionButton label={busy ? "يرجى الانتظار…" : "حفظ طلب الحساب"} icon="person-add-outline" onPress={() => { void perform(async () => { await api.create({ name, email, ...(phone.trim() ? { phoneNumber: phone } : {}) }); setName(""); setEmail(""); setPhone(""); }, "حُفظ الطلب قيد الإنشاء؛ لم يُنشأ تسجيل دخول بعد."); }} />
    </Card>
    {!!message && <Text accessibilityRole="alert" className="mb-4 text-right text-xs leading-5 text-[#D7A948]">{message}</Text>}
    {!loaded ? <ActivityIndicator color="#D7A948" /> : !records.length ? <EmptyState title="لا توجد طلبات" text="ستظهر طلبات إنشاء الحسابات هنا بعد حفظها." /> : records.map(row => <Card key={row.id} className="mb-3">
      <View className="flex-row items-center justify-between gap-2"><Pill tone={row.state === "active" ? "green" : row.state === "suspended" ? "red" : "gold"}>{adminCreatedAccountStateLabel[row.state]}</Pill><Text className="flex-1 text-right font-bold text-[#F7F1E3]">{row.name}</Text></View>
      <Text className="mt-2 text-right text-xs text-[#9BA8B8]">{row.email}{row.phoneNumber ? ` · ${row.phoneNumber}` : ""}</Text>
      <Text className="mt-1 text-right text-xs text-[#9BA8B8]">رقم الطلب: {row.id}</Text>
      <Text className="mt-1 text-right text-xs text-[#D7A948]">{row.customerId ? `رقم العميل: ${row.customerId}` : "رقم العميل يصدر بعد اكتمال التحقق"}</Text>
      <Text className="mt-1 text-right text-xs text-[#9BA8B8]">أنشأه {row.createdByName} · {new Date(row.createdAt).toLocaleString("ar-EG")}</Text>
      <Text className="mt-1 text-right text-xs text-[#9BA8B8]">مراجعة الهوية: {row.identityReviewedAt ? `${row.identityReviewedByName} · ${row.identityEvidenceRef}` : "لم تُسجّل"} · البريد: {row.emailVerifiedAt ? "تأكد عبر الدعوة" : "لم يُتحقق منه"}</Text>
      {row.state === "draft" && <View className="mt-3"><ActionButton label="إرسال للمراجعة" icon="shield-checkmark-outline" secondary onPress={() => void perform(() => api.submit({ id: row.id }), "الطلب يحتاج إلى التحقق قبل التفعيل.")} /></View>}
      {row.state === "verification_required" && <View className="mt-3">
        <Text className="mb-2 text-right text-xs leading-5 text-[#9BA8B8]">بعد التحقق الفعلي من الهوية، أدخل مرجع ملف المراجعة فقط؛ لا تكتب رقم هوية أو كلمة مرور.</Text>
        <TextInput accessibilityLabel="مرجع مراجعة الهوية" value={evidence[row.id] ?? ""} onChangeText={value => setEvidence(prev => ({ ...prev, [row.id]: value }))} placeholder="مرجع المراجعة مثل CASE-1234" placeholderTextColor="#657286" autoCapitalize="characters" maxLength={120} className={inputClass} />
        <ActionButton label="توثيق مراجعة الهوية" icon="document-text-outline" secondary onPress={() => void perform(() => api.recordIdentity({ id: row.id, evidenceRef: evidence[row.id] ?? "" }), "سُجّلت مراجعة الهوية؛ لم يثبت البريد بعد.")} />
        {invitationsEnabled ? <View className="mt-2"><ActionButton label="إرسال دعوة خاصة لصاحب البريد" icon="mail-outline" secondary onPress={() => void perform(() => api.issueInvitation({ id: row.id }), "تمت الدعوة؛ تبقى ملكية البريد غير مؤكدة حتى يستخدمها صاحبه.")} /></View> : <Text className="mt-2 text-right text-xs leading-5 text-[#D7A948]">إرسال الدعوات وتفعيل الدخول غير متاحين بعد، لحين اكتمال متطلبات الأمان والتوثيق المالي.</Text>}
      </View>}
      {row.state !== "active" && !row.customerId && <View className="mt-3">
        <TextInput accessibilityLabel="سبب إيقاف الطلب أو استئنافه" value={reason[row.id] ?? ""} onChangeText={value => setReason(prev => ({ ...prev, [row.id]: value }))} placeholder="سبب الإيقاف أو الاستئناف" placeholderTextColor="#657286" maxLength={250} className={inputClass} />
        <ActionButton label={row.state === "suspended" ? "استئناف الطلب" : "إيقاف الطلب"} icon={row.state === "suspended" ? "play-outline" : "pause-outline"} secondary onPress={() => void perform(() => api.suspend({ id: row.id, suspended: row.state !== "suspended", reason: reason[row.id] ?? "" }), "تم تحديث حالة الطلب وتسجيل القرار.")} />
      </View>}
      {row.customerId && row.state === "suspended" && <Text className="mt-2 text-right text-xs text-[#9BA8B8]">هذا حساب قائم؛ أدر تجميده من ملف العميل المعتاد.</Text>}
    </Card>)}
  </View>;
}
