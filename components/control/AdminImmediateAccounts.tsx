import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { ActionButton, Card, EmptyState, Pill } from "@/components/atheer-ui";
import { DateOnlyField } from "@/components/DateOnlyField";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { adminImmediateCreateSchema, adminImmediateStateLabel, type AdminImmediateAccountView } from "@/shared/admin-immediate-accounts";
import { EGYPTIAN_GOVERNORATES } from "@/shared/registration";

const inputClass = "mb-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]";
const blank = { name: "", email: "", phoneNumber: "", birthDate: "", governorate: "", password: "", confirmPassword: "" };

type Form = typeof blank;
export function AdminImmediateAccounts() {
  const [form, setForm] = useState<Form>(blank);
  const [records, setRecords] = useState<AdminImmediateAccountView[]>([]);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [governoratesOpen, setGovernoratesOpen] = useState(false);
  const alive = useRef(false);
  const loadVersion = useRef(0);
  const create = useEphemeralMutation(manualAuthClient.adminCreatedAccounts.createImmediate.mutate);
  const update = (key: keyof Form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const rows = await manualAuthClient.adminCreatedAccounts.listImmediate.query();
      if (alive.current && version === loadVersion.current) { setRecords(rows); setLoaded(true); }
    } catch {
      if (alive.current && version === loadVersion.current) { setMessage("تعذر تحديث الحسابات؛ تحقق من الاتصال والصلاحية."); setLoaded(true); }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => { alive.current = false; ++loadVersion.current; clearInterval(timer); };
  }, [load]);
  async function submit() {
    if (create.isPending) return;
    setMessage("");
    const parsed = adminImmediateCreateSchema.safeParse(form);
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "راجع بيانات الحساب."); return; }
    try {
      const result = await create.mutateAsync(parsed.data);
      setForm(blank);
      setMessage(`تم إنشاء الحساب مباشرة. رقم العميل: ${result.customerId}. على العميل تغيير كلمة المرور عند أول دخول.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر إنشاء الحساب."); }
  }
  return <View>
    <Text className="mb-1 text-right text-lg font-bold text-[#F7F1E3]">إنشاء الحسابات</Text>
    <Text className="mb-4 text-right text-xs leading-5 text-[#9BA8B8]">يُنشأ الحساب فورًا بواسطة الإدارة دون إرسال رمز بريد. يُطلب من العميل تغيير كلمة المرور عند أول دخول. لا يُعد البريد متحققًا منه تلقائيًا.</Text>
    <Card className="mb-4">
      <Text className="mb-3 text-right font-bold text-[#F7F1E3]">إنشاء حساب جديد</Text>
      <TextInput accessibilityLabel="الاسم بالكامل" value={form.name} onChangeText={value => update("name", value)} placeholder="الاسم بالكامل" placeholderTextColor="#657286" maxLength={120} className={inputClass} />
      <TextInput accessibilityLabel="البريد الإلكتروني" value={form.email} onChangeText={value => update("email", value)} placeholder="البريد الإلكتروني" placeholderTextColor="#657286" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={320} className={inputClass} />
      <TextInput accessibilityLabel="رقم الهاتف" value={form.phoneNumber} onChangeText={value => update("phoneNumber", value)} placeholder="رقم الهاتف" placeholderTextColor="#657286" keyboardType="phone-pad" maxLength={20} className={inputClass} />
      <DateOnlyField value={form.birthDate} onChange={value => update("birthDate", value)} />
      <Text className="mb-2 mt-4 text-right text-sm font-semibold text-[#C7B98D]">المحافظة</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="اختيار المحافظة" onPress={() => setGovernoratesOpen(true)} className={inputClass}><Text className="text-right text-[#9BA8B8]">{form.governorate || "اختر المحافظة"}</Text></Pressable>
      <TextInput accessibilityLabel="كلمة المرور المبدئية" value={form.password} onChangeText={value => update("password", value)} placeholder="كلمة المرور المبدئية (12 حرفًا على الأقل)" placeholderTextColor="#657286" secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} className={inputClass} />
      <TextInput accessibilityLabel="تأكيد كلمة المرور المبدئية" value={form.confirmPassword} onChangeText={value => update("confirmPassword", value)} placeholder="تأكيد كلمة المرور" placeholderTextColor="#657286" secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={128} className={inputClass} />
      <ActionButton label={create.isPending ? "جارٍ إنشاء الحساب…" : "إنشاء حساب جديد"} icon="person-add-outline" onPress={() => void submit()} />
    </Card>
    {!!message && <Text accessibilityRole="alert" className="mb-4 text-right text-xs leading-5 text-[#D7A948]">{message}</Text>}
    {!loaded ? <ActivityIndicator color="#D7A948" /> : !records.length ? <EmptyState title="لا توجد حسابات" text="ستظهر الحسابات التي أنشأتها الإدارة هنا." /> : records.map(row => <Card key={row.id} className="mb-3">
      <View className="flex-row items-center justify-between gap-2"><Pill tone={row.state === "password_changed" ? "green" : "gold"}>{adminImmediateStateLabel[row.state]}</Pill><Text className="flex-1 text-right font-bold text-[#F7F1E3]">{row.name}</Text></View>
      <Text className="mt-2 text-right text-xs text-[#9BA8B8]">{row.email} · {row.phoneNumber}</Text>
      <Text className="mt-1 text-right text-xs text-[#D7A948]">رقم العميل: {row.customerId}</Text>
      <Text className="mt-1 text-right text-xs text-[#9BA8B8]">أنشأه {row.createdByName} · {new Date(row.createdAt).toLocaleString("ar-EG")}</Text>
      <Text className="mt-1 text-right text-xs text-[#9BA8B8]">أول دخول: {row.firstLoginAt ? new Date(row.firstLoginAt).toLocaleString("ar-EG") : "لم يحدث بعد"}</Text>
      {row.passwordChangedAt && <Text className="mt-1 text-right text-xs text-[#9BA8B8]">تغيير كلمة المرور: {new Date(row.passwordChangedAt).toLocaleString("ar-EG")}</Text>}
    </Card>)}
    <Modal visible={governoratesOpen} transparent animationType="slide" onRequestClose={() => setGovernoratesOpen(false)}><View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" }}><View style={{ maxHeight: "78%", borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: "#111722", padding: 20 }}><Text className="mb-4 text-right text-xl font-bold text-[#F7F1E3]">اختر المحافظة</Text><FlatList data={EGYPTIAN_GOVERNORATES} keyExtractor={item => item} renderItem={({ item }) => <Pressable onPress={() => { update("governorate", item); setGovernoratesOpen(false); }} style={{ borderBottomWidth: 1, borderBottomColor: "#273548", paddingVertical: 15 }}><Text className="text-right text-base text-[#F7F1E3]">{item}</Text></Pressable>} /></View></View></Modal>
  </View>;
}
