import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { ActionButton, Card } from "@/components/atheer-ui";

/** Render only on the mailbox owner's secure invitation route, never in admin. */
export function AdminCreatedAccountClaim({ token, claim }: { token: string; claim(input: { token: string; password: string; confirmPassword: string }): Promise<{ success: true; customerId: string }> }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function submit() {
    if (busy || done) return;
    setBusy(true); setMessage("");
    try {
      const result = await claim({ token, password, confirmPassword });
      setPassword(""); setConfirmPassword(""); setDone(true);
      setMessage(`اكتمل إنشاء الحساب. رقم العميل: ${result.customerId}. يمكنك الآن تسجيل الدخول وإكمال البيانات المطلوبة.`);
    } catch { setMessage("تعذر استخدام الدعوة أو كلمة المرور؛ تأكد من الرابط والبيانات أو تواصل مع الدعم."); }
    finally { setBusy(false); }
  }
  return <Card>
    <Text className="mb-2 text-right text-lg font-bold text-[#F7F1E3]">إعداد كلمة المرور</Text>
    <Text className="mb-4 text-right text-xs leading-5 text-[#9BA8B8]">هذه الدعوة شخصية ولمرة واحدة. لا تشارك الرابط مع أحد. اختر كلمة مرور من 12 إلى 128 حرفًا.</Text>
    {!done && <View>
      <TextInput accessibilityLabel="كلمة المرور" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" placeholder="كلمة المرور الجديدة" placeholderTextColor="#657286" maxLength={128} className="mb-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]" />
      <TextInput accessibilityLabel="تأكيد كلمة المرور" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" placeholder="تأكيد كلمة المرور" placeholderTextColor="#657286" maxLength={128} className="mb-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]" />
      <ActionButton label={busy ? "يرجى الانتظار…" : "تأكيد وإنشاء الحساب"} icon="lock-closed-outline" onPress={() => void submit()} />
    </View>}
    {!!message && <Text accessibilityRole="alert" className="mt-3 text-right text-xs leading-5 text-[#D7A948]">{message}</Text>}
  </Card>;
}
