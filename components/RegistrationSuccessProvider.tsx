import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ActionButton, Card } from "@/components/atheer-ui";
import { copyText } from "@/lib/copy";
import { authSessionState } from "@/shared/auth-session-state";
import type { AuthenticatedHomeRoute } from "@/shared/auth-routing";
import type { RegistrationReceipt } from "@/shared/registration-progress";

type RegistrationSuccessData = RegistrationReceipt & {
  password: string;
  securityPin: string;
  homeRoute: AuthenticatedHomeRoute;
};

type CredentialField = "account" | "password" | "pin" | "all";
const ReceiptContext = createContext<((receipt: RegistrationSuccessData) => void) | null>(null);

export function useRegistrationSuccess() {
  const present = useContext(ReceiptContext);
  if (!present) throw new Error("Registration success provider is missing");
  return present;
}

export function RegistrationSuccessProvider({ children }: { children: ReactNode }) {
  // Credentials exist only in this transient React state until the user closes the receipt.
  const [receipt, setReceipt] = useState<RegistrationSuccessData | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [copiedField, setCopiedField] = useState<CredentialField | null>(null);
  const [copyError, setCopyError] = useState("");
  const router = useRouter();

  const dismiss = () => {
    const destination = receipt?.homeRoute;
    setReceipt(null);
    setPasswordVisible(false);
    setPinVisible(false);
    setCopiedField(null);
    setCopyError("");
    authSessionState.setRegistrationReceiptActive(false);
    if (destination) router.replace(destination);
  };

  useEffect(() => {
    let generation = authSessionState.getSnapshot().generation;
    const unsubscribe = authSessionState.subscribe(() => {
      const next = authSessionState.getSnapshot();
      const loggedOut = next.generation !== generation && next.signedOut;
      generation = next.generation;
      if (loggedOut) {
        setReceipt(null);
        setPasswordVisible(false);
        setPinVisible(false);
        setCopiedField(null);
        setCopyError("");
      }
    });
    return () => {
      unsubscribe();
      authSessionState.setRegistrationReceiptActive(false);
    };
  }, []);

  const present = (data: RegistrationSuccessData) => {
    setPasswordVisible(false);
    setPinVisible(false);
    setCopiedField(null);
    setCopyError("");
    setReceipt({
      customerId: data.customerId,
      password: data.password,
      securityPin: data.securityPin,
      homeRoute: data.homeRoute,
    });
    authSessionState.setRegistrationReceiptActive(true);
  };

  const copyCredential = async (field: CredentialField, value: string) => {
    try {
      await copyText(value);
      setCopiedField(field);
      setCopyError("");
    } catch {
      setCopiedField(null);
      setCopyError("تعذر النسخ. يمكنك تحديد القيمة ونسخها يدويًا.");
    }
  };

  const copyAllCredentials = async () => {
    if (!receipt) return;
    try {
      await copyText(`رقم الحساب: ${receipt.customerId}\nكلمة المرور: ${receipt.password}\nرمز الأمان: ${receipt.securityPin}`);
      setCopiedField("all");
      setCopyError("");
    } catch {
      setCopiedField(null);
      setCopyError("تعذر النسخ. يمكنك تحديد القيم ونسخها يدويًا.");
    }
  };

  return (
    <ReceiptContext.Provider value={present}>
      {children}
      <Modal visible={Boolean(receipt)} transparent animationType="fade" onRequestClose={dismiss}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,0.82)" }}>
          <ScrollView style={{ width: "100%", maxHeight: "94%" }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }} keyboardShouldPersistTaps="handled">
            {receipt ? (
              <Card className="w-full max-w-[440px] self-center border-[#5C4A28] bg-[#111B28] p-4">
                <View className="mb-3 h-12 w-12 self-center items-center justify-center rounded-2xl border border-[#5C4A28] bg-[#D7A948]/10">
                  <Ionicons name="checkmark-circle" size={28} color="#47D7A5" />
                </View>
                <Text accessibilityRole="header" className="text-xl font-bold text-[#47D7A5]" style={{ textAlign: "center" }}>تم إنشاء حسابك بنجاح</Text>
                <Text className="mt-2 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "center" }}>احتفظ ببيانات الدخول في مكان آمن، ولا تشارك كلمة المرور أو رمز الأمان مع أي شخص. لن تظهر هذه البيانات مرة أخرى بعد إغلاق النافذة.</Text>

                <CredentialRow label="رقم الحساب (ID)" value={receipt.customerId} displayValue={receipt.customerId} field="account" copiedField={copiedField} onCopy={copyCredential} />
                <CredentialRow label="كلمة المرور" value={receipt.password} displayValue={passwordVisible ? receipt.password : "••••••••••••"} field="password" copiedField={copiedField} onCopy={copyCredential} visible={passwordVisible} onToggle={() => setPasswordVisible((value) => !value)} />
                <CredentialRow label="رمز الأمان (PIN)" value={receipt.securityPin} displayValue={pinVisible ? receipt.securityPin : "••••"} field="pin" copiedField={copiedField} onCopy={copyCredential} visible={pinVisible} onToggle={() => setPinVisible((value) => !value)} />

                <View className="mt-4"><ActionButton label={copiedField === "all" ? "تم نسخ جميع البيانات" : "نسخ جميع البيانات"} icon="copy-outline" secondary onPress={() => void copyAllCredentials()} /></View>

                {copyError ? <Text accessibilityRole="alert" className="mt-3 text-xs leading-5 text-[#FF9BA7]" style={{ textAlign: "right" }}>{copyError}</Text> : null}
                <View className="mt-5"><ActionButton label="الدخول إلى المحفظة" icon="wallet-outline" onPress={dismiss} /></View>
              </Card>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </ReceiptContext.Provider>
  );
}

function CredentialRow({
  label,
  value,
  displayValue,
  field,
  copiedField,
  onCopy,
  visible,
  onToggle,
}: {
  label: string;
  value: string;
  displayValue: string;
  field: CredentialField;
  copiedField: CredentialField | null;
  onCopy: (field: CredentialField, value: string) => void;
  visible?: boolean;
  onToggle?: () => void;
}) {
  return (
    <View className="mt-3 rounded-2xl border border-[#273548] bg-[#0B1018] p-3">
      <Text className="text-xs font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>{label}</Text>
      <View className="mt-2 flex-row items-center gap-2">
        <Text selectable numberOfLines={2} className="min-w-0 flex-1 text-base font-bold text-[#F7F1E3]" style={{ writingDirection: "ltr", textAlign: "left" }}>{displayValue}</Text>
        {onToggle ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${visible ? "إخفاء" : "إظهار"} ${label}`} onPress={onToggle} hitSlop={8} className="items-center rounded-xl border border-[#273548] px-2.5 py-2">
            <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={17} color="#D7A948" />
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`نسخ ${label}`} onPress={() => void onCopy(field, value)} hitSlop={8} className="flex-row items-center gap-1 rounded-xl border border-[#5C4A28] bg-[#D7A948]/10 px-2.5 py-2">
          <Ionicons name={copiedField === field ? "checkmark-outline" : "copy-outline"} size={15} color="#D7A948" />
          <Text className="text-xs font-bold text-[#D7A948]">{copiedField === field ? "تم النسخ" : "نسخ"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
