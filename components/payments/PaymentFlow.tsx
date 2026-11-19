import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { type ComponentProps, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { manualAuthClient } from "@/lib/manual-auth-client";
import { useEphemeralMutation } from "@/hooks/use-ephemeral-mutation";
import { CustomerSupportCard } from "@/components/CustomerSupportCard";
import { PaymentContactButtons } from "@/components/payments/PaymentContactButtons";
import { copyText } from "@/lib/copy";
import {
  type PaymentMethod,
  type PaymentMethodId,
  createPaymentOperationId,
  formatPaymentAmount,
  isPaymentAmountValid,
  normalizePaymentAmountText,
  paymentErrorMessage,
  detectPaymentImageMimeType,
  resolvePaymentImageUrl,
} from "@/lib/payment-client";
import { getWithdrawalFeeMinorUnits } from "@/shared/fee-policy";
import { ACCOUNT_VERIFICATION_ACTION_LABEL, ACCOUNT_VERIFICATION_REQUIRED_MESSAGE, ACCOUNT_VERIFICATION_ROUTE, getMoneyRequestAccessState, getMoneyRequestVerificationPrompt } from "@/shared/account-verification-policy";
import { formatMoneyMinorUnits, tryParseMoneyMinorUnits } from "@/shared/transactions";

const COLORS = {
  background: "#0B1018",
  panel: "#121B28",
  field: "#0B1018",
  border: "#273548",
  accent: "#D7A948",
  gold: "#D7A948",
  text: "#F7F1E3",
  muted: "#9BA8B8",
  dim: "#657286",
  red: "#FF7D8D",
};
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const LOCAL_PAYMENT_IMAGES: Record<PaymentMethodId, number> = {
  vodafone: require("@/assets/images/payments/vodafone.png"),
  orange: require("@/assets/images/payments/orange.png"),
  etisalat: require("@/assets/images/payments/etisalat.png"),
  instapay: require("@/assets/images/payments/instapay.png"),
};

type FlowType = "deposit" | "withdrawal";
type Receipt = { uri: string; data: string; mimeType: string };
type RequestPayload = {
  type: FlowType;
  amount: string;
  paymentMethodId: PaymentMethodId;
  operationId: string;
  senderReference?: string;
  receiptImageData?: string;
  destination?: string;
  customFields?: Record<string, string>;
  securityPin?: string;
};

function MethodBadge({ method, large = false }: { method: PaymentMethod; large?: boolean }) {
  const imageUrl = resolvePaymentImageUrl(method.imageUrl);
  const localImage = (LOCAL_PAYMENT_IMAGES as Record<string, number>)[method.id];
  const imageSource = imageUrl ? { uri: imageUrl } : localImage ? localImage : null;
  if (imageSource) return <Image source={imageSource} style={large ? styles.methodImageLarge : styles.methodImage} resizeMode="contain" accessibilityLabel={method.name} />;
  return <View style={large ? styles.methodIconFallbackLarge : styles.methodIconFallback}><Ionicons name="wallet-outline" size={large ? 30 : 23} color={COLORS.gold} /></View>;
}

function InlineError({ children }: { children: string }) {
  return <Text style={styles.errorText}>{children}</Text>;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  keyboardType = "default",
  multiline = false,
  maxLength,
  compact = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  icon?: ComponentProps<typeof Ionicons>["name"];
  keyboardType?: "default" | "decimal-pad" | "phone-pad";
  multiline?: boolean;
  maxLength?: number;
  compact?: boolean;
  }) {
  return (
    <View style={[styles.fieldGroup, compact && styles.depositFieldGroup]}>
      <View style={styles.fieldLabelRow}>
        {icon ? <Ionicons name={icon} size={compact ? 14 : 17} color={COLORS.accent} /> : null}
        <Text style={[styles.fieldLabel, compact && styles.depositFieldLabel]}>{label}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.dim}
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        textAlign="right"
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, compact && styles.depositInput, multiline && styles.multilineInput, compact && multiline && styles.compactMultilineInput]}
      />
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled, compact = false }: { label: string; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, compact && styles.depositPrimaryButton, disabled && styles.disabledButton, pressed && !disabled && styles.pressedButton]}
    >
      <Ionicons name="send-outline" size={compact ? 16 : 18} color={disabled ? COLORS.dim : COLORS.background} />
      <Text style={[styles.primaryButtonText, compact && styles.depositPrimaryButtonText, disabled && styles.disabledButtonText]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, compact = false }: { label: string; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.secondaryButton, compact && styles.compactSecondaryButton, pressed && styles.pressedButton]}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function PaymentFlow({ type }: { type: FlowType }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [selectedMethodId, setSelectedMethodId] = useState<PaymentMethodId | null>(null);
  const [amount, setAmount] = useState("");
  const [senderReference, setSenderReference] = useState("");
  const [destination, setDestination] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [customerIdCopyMessage, setCustomerIdCopyMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [serverVerificationBlockedAfterUpdate, setServerVerificationBlockedAfterUpdate] = useState<number | null>(null);
  const [successReference, setSuccessReference] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasRequestSnapshot, setHasRequestSnapshot] = useState(false);
  const [securityPin, setSecurityPin] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [pinError, setPinError] = useState("");
  const submittingRef = useRef(false);
  const payloadRef = useRef<{ signature: string; payload: RequestPayload } | null>(null);

  const authMe = trpc.auth.me.useQuery(undefined, { staleTime: 60_000, refetchOnMount: true, retry: false });
  const isAdmin = authMe.data?.role === "admin";
  const verificationStatus = trpc.accountVerification.status.useQuery(undefined, { enabled: Boolean(authMe.data) && !isAdmin, retry: false, refetchOnWindowFocus: true, refetchInterval: 10_000 });
  const verificationPrompt = authMe.data && authMe.data.role !== "admin"
    ? getMoneyRequestVerificationPrompt(Boolean(verificationStatus.data?.requiredBeforeMoney), verificationStatus.data?.status)
    : null;
  const serverVerificationBlocked = !isAdmin && serverVerificationBlockedAfterUpdate !== null && verificationStatus.dataUpdatedAt <= serverVerificationBlockedAfterUpdate;
  const forcedVerificationPrompt = serverVerificationBlocked
    ? { message: ACCOUNT_VERIFICATION_REQUIRED_MESSAGE, actionLabel: ACCOUNT_VERIFICATION_ACTION_LABEL, route: ACCOUNT_VERIFICATION_ROUTE }
    : null;
  const activeVerificationPrompt = verificationPrompt ?? forcedVerificationPrompt;
  const verificationAccessState = getMoneyRequestAccessState({
    checking: authMe.isLoading || Boolean(authMe.data && !isAdmin && verificationStatus.isLoading),
    unavailable: authMe.isError || Boolean(authMe.data && !isAdmin && verificationStatus.isError),
    requiredBeforeMoney: !isAdmin && Boolean(verificationStatus.data?.requiredBeforeMoney),
    status: verificationStatus.data?.status,
    serverBlocked: !isAdmin && serverVerificationBlocked,
  });
  const paymentAccessReady = verificationAccessState === "allowed";
  const methodsQuery = trpc.payment.methods.useQuery({ direction: type }, { enabled: paymentAccessReady, refetchInterval: 10000 });
  const serviceStatusQuery = trpc.payment.serviceStatus.useQuery(undefined, { enabled: paymentAccessReady, refetchInterval: 10000 });
  const limitsQuery = trpc.payment.limits.useQuery(undefined, { enabled: paymentAccessReady, refetchInterval: 10000 });
  const feePolicyQuery = trpc.payment.fees.useQuery(undefined, { enabled: paymentAccessReady && type === "withdrawal", refetchInterval: 30000 });
  const portfolioQuery = trpc.portfolio.get.useQuery(undefined, { enabled: paymentAccessReady && type === "withdrawal", refetchInterval: 10000 });
  const requestMutation = useEphemeralMutation(manualAuthClient.portfolio.request.mutate);

  const methods = Array.isArray(methodsQuery.data) ? methodsQuery.data : [];
  const selectedMethod = selectedMethodId ? methods.find((method) => method.id === selectedMethodId) ?? null : null;
  const compactFlow = Boolean(selectedMethod) && !successReference;
  const compactDeposit = type === "deposit" && compactFlow;
  const veryCompactFlow = compactFlow && windowHeight <= 720;
  const limits = limitsQuery.data;
  const available = Number(portfolioQuery.data?.available?.available ?? 0);
  const reservedWithdrawals = Number(portfolioQuery.data?.available?.reservedWithdrawals ?? 0);
  const reservedOrders = Number(portfolioQuery.data?.available?.reservedOrders ?? 0);
  const normalizedAmount = normalizePaymentAmountText(amount);
  const parsedAmountMinor = tryParseMoneyMinorUnits(normalizedAmount);
  const amountMinor = parsedAmountMinor !== null && parsedAmountMinor > 0 ? parsedAmountMinor : 0;
  const numericAmount = amountMinor / 100;
  const availableMinor = tryParseMoneyMinorUnits(String(portfolioQuery.data?.available?.available ?? "0")) ?? 0;
  const feeMinor = type === "withdrawal" && amountMinor > 0 && feePolicyQuery.data ? getWithdrawalFeeMinorUnits(normalizedAmount, feePolicyQuery.data) : 0;
  const feeAmount = formatMoneyMinorUnits(feeMinor);
  const totalDebit = formatMoneyMinorUnits(amountMinor + feeMinor);
  const configuredMinAmount = type === "deposit" ? limits?.minDepositAmount : limits?.minWithdrawalAmount;
  const minAmount = configuredMinAmount === undefined || configuredMinAmount === null ? null : Number(configuredMinAmount);
  const serviceEnabled = type === "deposit" ? serviceStatusQuery.data?.depositEnabled !== false : serviceStatusQuery.data?.withdrawalEnabled !== false;

  const goToWallet = () => router.push("/(tabs)/wallet");
  const goBack = () => {
    if (selectedMethodId && !successReference) {
      setSelectedMethodId(null);
      setCustomFieldValues({});
      setFormError("");
      setCopyMessage("");
      return;
    }
    goToWallet();
  };
  const maxAmount = type === "deposit" ? limits?.maxDepositAmount : limits?.maxWithdrawalAmount;

  const copyCustomerId = async () => {
    const customerId = authMe.data?.customerId;
    if (!customerId || !/^\d{10}$/.test(customerId)) {
      setCustomerIdCopyMessage("رقم العميل غير جاهز بعد.");
      return;
    }
    try {
      await copyText(customerId);
      setCustomerIdCopyMessage("تم نسخ رقم العميل.");
    } catch {
      setCustomerIdCopyMessage("تعذر النسخ؛ حاول مرة أخرى.");
    }
  };

  const pickReceipt = async () => {
    setFormError("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, base64: true, quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        setFormError("تعذر قراءة صورة التحويل. اختر الصورة مرة أخرى.");
        return;
      }
      const base64 = asset.base64.replace(/\s/g, "");
      const mimeType = detectPaymentImageMimeType(base64);
      if (!mimeType) {
        setFormError("اختر صورة بصيغة PNG أو JPEG أو WebP فقط.");
        return;
      }
      const byteSize = asset.fileSize ?? Math.ceil((base64.length * 3) / 4);
      if (byteSize > MAX_RECEIPT_BYTES) {
        setFormError("حجم صورة التحويل يجب ألا يتجاوز 8 ميجابايت.");
        return;
      }
      setReceipt({ uri: `data:${mimeType};base64,${base64}`, data: `data:${mimeType};base64,${base64}`, mimeType });
    } catch (error) {
      setFormError(paymentErrorMessage(error, "تعذر اختيار صورة التحويل. حاول مرة أخرى."));
    }
  };

  const resetRequestIdentity = () => {
    payloadRef.current = null;
    setHasRequestSnapshot(false);
    setFormError("");
    setCopyMessage("");
  };

  const submit = async () => {
    if (submittingRef.current || requestMutation.isPending || successReference) return;
    setFormError("");
    if (authMe.data && authMe.data.role !== "admin") {
      if (verificationStatus.isLoading) { setFormError("جارٍ التحقق من شرط التوثيق؛ انتظر لحظة ثم أعد المحاولة."); return; }
      if (verificationStatus.isError) { setFormError("تعذر التحقق من شرط التوثيق. أعد المحاولة قبل متابعة الطلب المالي."); return; }
      if (activeVerificationPrompt) {
        const latest = await verificationStatus.refetch();
        if (latest.isError || !latest.data) { setFormError("تعذر التحقق من شرط التوثيق. أعد المحاولة قبل متابعة الطلب المالي."); return; }
        const latestPrompt = getMoneyRequestVerificationPrompt(Boolean(latest.data.requiredBeforeMoney), latest.data.status);
        if (latestPrompt) { setFormError(latestPrompt.message); return; }
        setFormError("");
      }
    }
    if (!selectedMethod) {
      setFormError("اختر وسيلة الدفع أولًا.");
      return;
    }
    if (!amount.trim() || !isPaymentAmountValid(amount) || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError("أدخل مبلغًا صحيحًا حتى خانتين عشريتين بالجنيه المصري.");
      return;
    }
    if (minAmount === null || !Number.isFinite(minAmount) || minAmount <= 0) {
      setFormError("لم تُحمّل حدود العملية بعد. حاول مرة أخرى.");
      return;
    }
    if (numericAmount < minAmount) {
      setFormError(`الحد الأدنى لـ${type === "deposit" ? "الإيداع" : "السحب"} هو ${formatPaymentAmount(minAmount)}.`);
      return;
    }
    if (type === "withdrawal" && !feePolicyQuery.data) {
      setFormError("تعذر تحميل سياسة رسوم السحب من الخادم. حاول مرة أخرى قبل تقديم الطلب.");
      return;
    }
    if (maxAmount !== null && maxAmount !== undefined && numericAmount > Number(maxAmount)) {
      setFormError(`الحد الأقصى المسموح به هو ${formatPaymentAmount(Number(maxAmount))}.`);
      return;
    }
    if (type === "withdrawal" && amountMinor + feeMinor > availableMinor) {
      setFormError(`الرصيد غير كافٍ لمبلغ السحب والرسوم. المطلوب ${formatPaymentAmount((amountMinor + feeMinor) / 100)} والمتاح ${formatPaymentAmount(available)}.`);
      return;
    }
    if (type === "deposit" && !receipt) {
      setFormError("أرفق صورة التحويل قبل تأكيد الإيداع.");
      return;
    }
    if (type === "deposit" && !senderReference.trim()) {
      setFormError("أدخل رقم المرسل أو مرجع التحويل.");
      return;
    }
    if (type === "withdrawal" && !destination.trim()) {
      setFormError("أدخل رقم المحفظة أو الحساب المستلم.");
      return;
    }
    if (type === "withdrawal" && !/^\d{4}$/.test(securityPin)) {
      setPinError("أدخل رمز الأمان المكون من 4 أرقام لتأكيد السحب.");
      setPinVisible(true);
      return;
    }
    const methodFields = (selectedMethod.fields ?? []).filter((field) => field.enabled !== false);
    for (const field of methodFields) {
      const value = customFieldValues[field.key]?.trim() ?? "";
      if (field.required && !value) {
        setFormError(`أكمل الحقل «${field.label}» قبل الإرسال.`);
        return;
      }
      if (field.kind === "number" && value && !/^\d+(?:\.\d{1,2})?$/.test(value)) {
        setFormError(`أدخل قيمة رقمية صحيحة في «${field.label}».`);
        return;
      }
    }

    const draft: Omit<RequestPayload, "operationId"> = {
      type,
      amount: normalizedAmount,
      paymentMethodId: selectedMethod.id,
      ...(type === "deposit" ? { senderReference: senderReference.trim(), receiptImageData: receipt!.data } : { destination: destination.trim() }),
      ...(methodFields.length ? { customFields: Object.fromEntries(methodFields.map((field) => [field.key, customFieldValues[field.key]?.trim() ?? ""])) } : {}),
    };
    const signature = JSON.stringify(draft);
    if (payloadRef.current && payloadRef.current.signature !== signature) {
      setFormError("تم تثبيت بيانات المحاولة السابقة لحمايتك من تكرار الطلب. اضغط بدء طلب جديد بعد مراجعة البيانات.");
      return;
    }
    const retryPayload: RequestPayload = payloadRef.current?.payload ?? { ...draft, operationId: createPaymentOperationId(type) };
    const payload: RequestPayload = {
      ...retryPayload,
      ...(type === "withdrawal" ? { securityPin } : {}),
    };
    payloadRef.current = { signature, payload: retryPayload };
    setHasRequestSnapshot(true);
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const reference = await requestMutation.mutateAsync(payload);
      setSuccessReference(reference);
      setFormError("");
      payloadRef.current = null;
      setHasRequestSnapshot(false);
      setReceipt(null);
      void portfolioQuery.refetch();
    } catch (error) {
      const message = (error as { message?: unknown } | null)?.message;
      if (typeof message === "string" && message.includes(ACCOUNT_VERIFICATION_REQUIRED_MESSAGE)) {
        setServerVerificationBlockedAfterUpdate(verificationStatus.dataUpdatedAt);
        setSelectedMethodId(null);
        setAmount("");
        setSenderReference("");
        setDestination("");
        setCustomFieldValues({});
        setReceipt(null);
        setFormError("");
        setCopyMessage("");
        payloadRef.current = null;
        setHasRequestSnapshot(false);
        void verificationStatus.refetch();
      } else {
        setFormError(paymentErrorMessage(error, "تعذر إرسال الطلب الآن. يمكنك إعادة المحاولة بالبيانات نفسها."));
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      setSecurityPin("");
      setPinVisible(false);
    }
  };

  const isLoading = serviceStatusQuery.isLoading || methodsQuery.isLoading || limitsQuery.isLoading || (type === "withdrawal" && feePolicyQuery.isLoading);
  const hasMethodContractError = methodsQuery.isError;
  const hasLimitError = limitsQuery.isError;
  const hasFeeError = type === "withdrawal" && feePolicyQuery.isError;

  if (verificationAccessState === "checking") {
    return <View style={[styles.flex, { justifyContent: "center", alignItems: "center", padding: 24 }]}><ActivityIndicator color={COLORS.gold} size="large" /><Text style={[styles.loadingText, { marginTop: 16 }]}>جارٍ التحقق من حالة التوثيق قبل عرض وسائل الدفع...</Text></View>;
  }

  if (verificationAccessState === "unavailable") {
    return <View style={[styles.flex, { justifyContent: "center", padding: 20 }]}><View style={{ width: "100%", maxWidth: 520, alignSelf: "center", alignItems: "center", gap: 14, padding: 24, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel }}><Ionicons name="warning-outline" size={42} color={COLORS.gold} /><Text style={styles.verificationNoticeTitle}>تعذر التحقق من حالة التوثيق</Text><Text style={styles.verificationNoticeText}>للحفاظ على أمان عملياتك، لن تظهر وسائل الدفع حتى نتمكن من التحقق من حالة الحساب. أعد المحاولة بعد لحظة.</Text><View style={{ width: "100%" }}><PrimaryButton label="إعادة التحقق" onPress={() => { void authMe.refetch(); if (authMe.data && !isAdmin) void verificationStatus.refetch(); }} /></View><View style={{ width: "100%" }}><SecondaryButton label="العودة إلى المحفظة" onPress={goToWallet} /></View></View></View>;
  }

  if (verificationAccessState === "verification_required" && activeVerificationPrompt && !isAdmin) {
    return <View style={[styles.flex, { backgroundColor: COLORS.background }]}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.scroll} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 18, paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }}><View style={{ width: "100%", maxWidth: 520, alignSelf: "center", alignItems: "center", gap: 16, paddingHorizontal: 24, paddingVertical: 30, borderRadius: 26, borderWidth: 1, borderColor: "#D7A94888", backgroundColor: COLORS.panel }}><View style={{ width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: "#D7A94866", backgroundColor: "#D7A94818" }}><Ionicons name="shield-checkmark-outline" size={38} color={COLORS.gold} /></View><Text accessibilityRole="alert" style={[styles.verificationNoticeTitle, { fontSize: 20, lineHeight: 30 }]}>{activeVerificationPrompt.message}</Text><Text style={[styles.verificationNoticeText, { textAlign: "center", fontSize: 14, lineHeight: 23 }]}>يجب توثيق الحساب وانتظار قبول المدير قبل متابعة {type === "deposit" ? "الإيداع" : "السحب"}. لن تظهر أو تُتاح أي وسيلة دفع قبل قبول طلبك.</Text><View style={{ width: "100%" }}><PrimaryButton label={activeVerificationPrompt.actionLabel} onPress={() => router.push(activeVerificationPrompt.route)} /></View><View style={{ width: "100%" }}><SecondaryButton label="العودة إلى المحفظة" onPress={goToWallet} /></View></View></ScrollView></View>;
  }

  if (!serviceStatusQuery.isLoading && !serviceStatusQuery.isError && !serviceEnabled) {
    return <View style={[styles.flex, { backgroundColor: COLORS.background }]}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.scroll} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 18, paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }}><View style={{ width: "100%", maxWidth: 520, alignSelf: "center", alignItems: "center", gap: 14, padding: 24, borderRadius: 26, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: COLORS.panel }}><Ionicons name="pause-circle-outline" size={48} color={COLORS.gold} /><Text style={styles.verificationNoticeTitle}>{type === "deposit" ? "الإيداع متوقف مؤقتًا" : "السحب متوقف مؤقتًا"}</Text><Text style={styles.verificationNoticeText}>أوقف المدير هذه الخدمة مؤقتًا. {type === "deposit" ? "يمكنك استخدام السحب إذا كان متاحًا." : "يمكنك استخدام الإيداع إذا كان متاحًا."}</Text><SecondaryButton label="العودة إلى المحفظة" onPress={goToWallet} /></View><CustomerSupportCard customerId={authMe.data?.customerId} operation={type} requestId={null} /></ScrollView></View>;
  }

  if (serviceStatusQuery.isError) {
    return <View style={[styles.flex, { backgroundColor: COLORS.background }]}><View style={{ flex: 1, justifyContent: "center", padding: 24 }}><View style={{ width: "100%", maxWidth: 520, alignSelf: "center", alignItems: "center", gap: 14, padding: 24, borderRadius: 26, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel }}><Ionicons name="cloud-offline-outline" size={44} color={COLORS.gold} /><Text style={styles.verificationNoticeTitle}>تعذر التحقق من حالة الخدمة</Text><Text style={styles.verificationNoticeText}>لن نعرض وسائل الدفع أو نرسل أي طلب حتى تصل حالة الإيداع والسحب من الخادم بشكل آمن.</Text><PrimaryButton label="إعادة المحاولة" onPress={() => void serviceStatusQuery.refetch()} /><SecondaryButton label="العودة إلى المحفظة" onPress={goToWallet} /></View></View></View>;
  }

  return (
    <View style={styles.flex}>
      <ScrollView keyboardDismissMode="on-drag" style={styles.scroll} contentContainerStyle={[styles.scrollContent, compactFlow && styles.depositScrollContent, veryCompactFlow && styles.depositScrollContentTight, compactFlow && { paddingTop: Math.max(insets.top, 4), paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <View style={[styles.header, compactFlow && styles.depositHeader]}>
          <View style={[styles.headerIcon, compactFlow && styles.depositHeaderIcon]}>
            <Ionicons name={type === "deposit" ? "arrow-down-circle-outline" : "arrow-up-circle-outline"} size={compactFlow ? 22 : 27} color={COLORS.accent} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.screenTitle, compactFlow && styles.depositScreenTitle]}>{successReference ? "تم إرسال الطلب" : type === "deposit" ? "الإيداع" : "السحب"}</Text>
            <Text style={[styles.screenSubtitle, compactFlow && styles.depositScreenSubtitle]}>{type === "deposit" ? "أرسل بيانات التحويل للمراجعة الآمنة" : "تحقق من الرصيد والرسوم قبل التأكيد"}</Text>
            <Text style={[styles.brandName, compactFlow && styles.depositBrandName]}>FLOTEX EGP</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={selectedMethodId ? "العودة لاختيار وسيلة الدفع" : "العودة إلى المحفظة"} onPress={goBack} style={({ pressed }) => [styles.backButton, compactFlow && styles.depositBackButton, pressed && styles.pressedButton]}>
            <Ionicons name="arrow-back" size={compactFlow ? 18 : 21} color={COLORS.accent} />
          </Pressable>
        </View>
        <View style={[styles.customerIdRow, compactFlow && styles.depositCustomerIdRow]}>
          <View style={styles.customerIdCopy}>
            <Text style={[styles.customerIdLabel, compactFlow && styles.depositCustomerIdLabel]}>رقم المستخدم (ID)</Text>
            <Text selectable style={styles.customerIdValue}>{authMe.data?.customerId || "جارٍ جلب الرقم..."}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="نسخ رقم العميل" onPress={() => void copyCustomerId()} style={({ pressed }) => [styles.customerIdButton, compactFlow && styles.depositCustomerIdButton, pressed && styles.pressedButton]}>
            <Ionicons name="copy-outline" size={compactFlow ? 15 : 17} color={COLORS.gold} />
            <Text style={[styles.customerIdButtonText, compactFlow && styles.depositCustomerIdButtonText]}>نسخ</Text>
          </Pressable>
        </View>
        {customerIdCopyMessage ? <Text style={[styles.customerIdFeedback, compactFlow && styles.depositCustomerIdFeedback]}>{customerIdCopyMessage}</Text> : null}
        {successReference ? (
          <View style={styles.successPanel}>
            <View style={styles.successIcon}><Ionicons name="checkmark" size={24} color={COLORS.background} /></View>
            <Text style={styles.successTitle}>{type === "deposit" ? "تم إرسال طلب الإيداع" : "تم إرسال طلب السحب"}</Text>
            {type === "deposit" ? <Text style={styles.successBody}>المدة التقديرية لمراجعة الإيداع من 10 إلى 30 دقيقة.</Text> : <Text style={styles.successBody}>سيبقى الطلب قيد المراجعة حتى التحقق من بيانات التحويل.</Text>}
            {successReference ? <Text style={styles.referenceText}>مرجع الطلب: {successReference}</Text> : null}
            <Text style={styles.pendingText}>تم حفظ الطلب بحالة قيد المراجعة، ولم يتم تأكيد الرصيد تلقائيًا.</Text>
            <SecondaryButton label="العودة إلى المحفظة" onPress={goToWallet} />
          </View>
        ) : isLoading ? (
          <View style={styles.loadingPanel}><ActivityIndicator color={COLORS.gold} /><Text style={styles.loadingText}>جارٍ تحميل وسائل الدفع والحدود...</Text></View>
        ) : selectedMethod ? (
          <View style={[styles.formCard, compactFlow && styles.depositFormCard]}>
            <Pressable onPress={() => { setSelectedMethodId(null); setCustomFieldValues({}); setFormError(""); setCopyMessage(""); }} style={({ pressed }) => [styles.changeMethod, compactFlow && styles.depositChangeMethod, pressed && styles.pressedButton]}>
              <Ionicons name="arrow-forward" size={compactFlow ? 15 : 18} color={COLORS.gold} />
              <Text style={[styles.changeMethodText, compactFlow && styles.depositChangeMethodText]}>تغيير وسيلة الدفع</Text>
            </Pressable>
            <View style={[styles.selectedMethod, compactFlow && styles.depositSelectedMethod, veryCompactFlow && styles.depositSelectedMethodTight]}>
              <MethodBadge method={selectedMethod} large />
              <View style={[styles.selectedMethodCopy, compactFlow && styles.depositSelectedMethodCopy]}><Text style={[styles.selectedMethodName, compactFlow && styles.depositSelectedMethodName]}>{selectedMethod.name}</Text><Text style={[styles.selectedMethodHint, compactFlow && styles.depositSelectedMethodHint]}>وسيلة الدفع المختارة</Text></View>
            </View>

            {type === "deposit" ? (
              <>
                <View style={[styles.transferCard, compactDeposit && styles.depositTransferCard]}>
                  <View style={[styles.transferHeading, compactDeposit && styles.depositTransferHeading]}>
                    <Ionicons name="card-outline" size={compactDeposit ? 15 : 18} color={COLORS.accent} />
                    <Text style={[styles.fieldLabel, styles.transferLabel, compactDeposit && styles.depositFieldLabel]}>رقم التحويل المعتمد</Text>
                    <View style={[styles.freeDepositBadge, compactDeposit && styles.depositFreeDepositBadge]}><Text style={[styles.freeDepositText, compactDeposit && styles.depositFreeDepositText]}>الإيداع مجاني</Text></View>
                  </View>
                  {selectedMethod.transferNumber ? (
                    <View style={[styles.transferBox, compactDeposit && styles.depositTransferBox]}>
                      <Text selectable style={[styles.transferNumber, compactDeposit && styles.depositTransferNumber]}>{selectedMethod.transferNumber}</Text>
                      <Pressable accessibilityRole="button" onPress={async () => { try { await copyText(selectedMethod.transferNumber ?? ""); setCopyMessage("تم نسخ رقم التحويل."); } catch { setCopyMessage("تعذر النسخ، حاول مرة أخرى."); } }} style={[styles.copyButton, compactDeposit && styles.depositCopyButton]}><Ionicons name="copy-outline" size={compactDeposit ? 15 : 18} color={COLORS.accent} /><Text style={[styles.copyButtonText, compactDeposit && styles.depositCopyButtonText]}>نسخ</Text></Pressable>
                    </View>
                  ) : <Text style={styles.warningBox}>لم يحدد المالك رقم تحويل لهذه الوسيلة بعد. لا ترسل أموالًا قبل ظهور الرقم المعتمد.</Text>}
                  {copyMessage ? <Text style={styles.feedbackText}>{copyMessage}</Text> : null}
                  <Text style={[styles.helperText, compactDeposit && styles.depositHelperText]}>تحقق من اسم المستفيد والرقم قبل التحويل. ظهور الرقم لا يعني اعتماد الرصيد تلقائيًا.</Text>
                </View>
              </>
            ) : (
              <>
              <View style={[styles.balanceBox, compactFlow && styles.compactBalanceBox]}>
                <View style={[styles.balanceRow, compactFlow && styles.compactBalanceRow]}><View style={styles.balanceInfo}><Ionicons name="wallet-outline" size={compactFlow ? 16 : 19} color={COLORS.accent} /><Text style={[styles.balanceLabel, compactFlow && styles.compactBalanceLabel]}>الرصيد المتاح للسحب</Text></View><Text style={[styles.balanceValue, compactFlow && styles.compactBalanceValue]}>{formatPaymentAmount(available)} ج.م</Text></View>
                <View style={[styles.reservationRow, compactFlow && styles.compactReservationRow]}><Text style={[styles.reservationText, compactFlow && styles.compactReservationText]}>محجوز للسحوبات</Text><Text style={[styles.reservationValue, compactFlow && styles.compactReservationValue]}>{formatPaymentAmount(reservedWithdrawals)}</Text></View>
                <View style={[styles.reservationRow, compactFlow && styles.compactReservationRow]}><Text style={[styles.reservationText, compactFlow && styles.compactReservationText]}>محجوز للأوامر</Text><Text style={[styles.reservationValue, compactFlow && styles.compactReservationValue]}>{formatPaymentAmount(reservedOrders)}</Text></View>
              </View>
              </>
            )}

            <Field
              label={type === "deposit" ? "المبلغ المراد إيداعه بالجنيه المصري" : "المبلغ الذي تريد سحبه بالجنيه المصري"}
              value={amount}
              onChangeText={setAmount}
              placeholder={type === "deposit"
                ? `الحد الأدنى ${minAmount !== null && Number.isFinite(minAmount) && minAmount > 0 ? formatPaymentAmount(minAmount) : "من الحدود"}`
                : `المتاح ${formatPaymentAmount(available)}`}
              icon="cash-outline"
              keyboardType="decimal-pad"
              compact={compactFlow}
            />
            {type === "withdrawal" && feePolicyQuery.data ? <View style={[styles.feeSummary, compactFlow && styles.compactFeeSummary]}>
              <View style={[styles.feeSummaryRow, compactFlow && styles.compactFeeSummaryRow]}><Text style={[styles.reservationText, compactFlow && styles.compactReservationText]}>مبلغ السحب المطلوب</Text><Text style={[styles.reservationValue, compactFlow && styles.compactReservationValue]}>{formatMoneyMinorUnits(amountMinor)} ج.م</Text></View>
              <View style={[styles.feeSummaryRow, compactFlow && styles.compactFeeSummaryRow]}><Text style={[styles.reservationText, compactFlow && styles.compactReservationText]}>رسوم السحب</Text><Text style={[styles.reservationValue, compactFlow && styles.compactReservationValue]}>{feeAmount} ج.م</Text></View>
              <View style={[styles.feeSummaryTotal, compactFlow && styles.compactFeeSummaryTotal]}><Text style={[styles.feeSummaryTotalLabel, compactFlow && styles.compactFeeSummaryTotalLabel]}>إجمالي المخصوم من رصيدك</Text><Text style={[styles.feeSummaryTotalValue, compactFlow && styles.compactFeeSummaryTotalValue]}>{totalDebit} ج.م</Text></View>
            </View> : null}
            {type === "deposit" ? <Field label="رقم المرسل / مرجع التحويل" value={senderReference} onChangeText={setSenderReference} placeholder="رقم الهاتف أو مرجع العملية" icon="person-outline" keyboardType="default" maxLength={150} compact={compactFlow} /> : <Field label="رقم الحساب أو المحفظة المستلمة" value={destination} onChangeText={setDestination} placeholder="رقم المحفظة أو الحساب" icon="wallet-outline" keyboardType="phone-pad" maxLength={180} compact={compactFlow} />}
            {type === "deposit" ? (
              <View style={[styles.uploadGroup, compactDeposit && styles.depositUploadGroup]}>
                <View style={[styles.uploadHeading, compactDeposit && styles.depositUploadHeading]}><Ionicons name="image-outline" size={compactDeposit ? 15 : 18} color={COLORS.accent} /><Text style={[styles.fieldLabel, compactDeposit && styles.depositFieldLabel]}>صورة إيصال التحويل</Text></View>
                {receipt ? <>
                  <Image source={{ uri: receipt.uri }} style={[styles.receiptPreview, compactDeposit && styles.depositReceiptPreview]} resizeMode="contain" />
                  <Pressable accessibilityRole="button" onPress={() => void pickReceipt()} style={[styles.receiptChangeButton, compactDeposit && styles.depositReceiptChangeButton]}><Ionicons name="camera-outline" size={compactDeposit ? 15 : 17} color={COLORS.accent} /><Text style={[styles.uploadButtonText, compactDeposit && styles.depositUploadButtonText]}>تغيير صورة الإيصال</Text></Pressable>
                </> : <Pressable accessibilityRole="button" onPress={() => void pickReceipt()} style={({ pressed }) => [styles.receiptDropzone, compactDeposit && styles.depositReceiptDropzone, pressed && styles.pressedButton]}>
                  <Ionicons name="camera-outline" size={compactDeposit ? 23 : 32} color={COLORS.accent} />
                  <View style={compactDeposit && styles.depositReceiptDropzoneCopy}>
                    <Text style={[styles.dropzoneTitle, compactDeposit && styles.depositDropzoneTitle]}>اضغط لإضافة صورة</Text>
                    <Text style={[styles.dropzoneSubtitle, compactDeposit && styles.depositDropzoneSubtitle]}>صورة التحويل أو الإيصال</Text>
                  </View>
                </Pressable>}
                <Text style={[styles.helperText, compactDeposit && styles.depositHelperText]}>الصيغ المقبولة PNG وJPEG وWebP، والحد الأقصى 8 ميجابايت.</Text>
              </View>
            ) : null}
            {selectedMethod.fields?.filter((field) => field.enabled !== false).map((field) => (
              <Field
                key={field.key}
                label={`${field.label}${field.required ? " *" : " (اختياري)"}`}
                value={customFieldValues[field.key] ?? ""}
                onChangeText={(value) => setCustomFieldValues((previous) => ({ ...previous, [field.key]: value }))}
                placeholder={field.placeholder || field.label}
                keyboardType={field.kind === "phone" ? "phone-pad" : field.kind === "number" ? "decimal-pad" : "default"}
                multiline={field.kind === "note"}
                maxLength={500}
                compact={compactFlow}
              />
            ))}
            {type === "withdrawal" && available <= 0 ? <View style={[styles.insufficientBox, compactFlow && styles.compactInsufficientBox]}><Text style={[styles.insufficientTitle, compactFlow && styles.compactInsufficientTitle]}>لا يوجد رصيد كافٍ للسحب</Text><Text style={[styles.insufficientBody, compactFlow && styles.compactInsufficientBody]}>أودع الأموال أولًا ليظهر رصيد متاح للسحب.</Text><SecondaryButton label="إيداع الأموال" onPress={() => router.push("/deposit")} compact={compactFlow} /></View> : null}
          </View>
        ) : (
          <View style={styles.methodsCard}>
            <Text style={styles.cardTitle}>اختر وسيلة الدفع</Text>
            <Text style={styles.cardSubtitle}>تظهر هنا وسائل الدفع المتاحة لحسابك.</Text>
            {hasMethodContractError ? <View style={styles.errorPanel}><Text style={styles.errorText}>تعذر تحميل وسائل الدفع المعتمدة. حاول مرة أخرى.</Text></View> : null}
            {!hasMethodContractError && methods.length === 0 ? <Text style={styles.warningBox}>لا توجد وسيلة دفع متاحة لهذا الحساب حاليًا. تواصل مع الإدارة للمساعدة.</Text> : null}
            <View style={styles.methodGrid}>
              {!hasMethodContractError ? methods.map((method) => <Pressable key={method.id} onPress={() => { setSelectedMethodId(method.id); setCustomFieldValues({}); setFormError(""); setCopyMessage(""); }} style={({ pressed }) => [styles.methodCard, pressed && styles.pressedButton]}><MethodBadge method={method} /><Text numberOfLines={2} style={styles.methodName}>{method.name}</Text><Ionicons name="chevron-back" size={17} color={COLORS.dim} /></Pressable>) : null}
              <PaymentContactButtons />
            </View>
            <SecondaryButton label="العودة إلى المحفظة" onPress={goToWallet} />
          </View>
        )}
        {selectedMethod && !successReference && !isLoading ? (
          <View style={[styles.confirmSection, compactFlow && styles.depositConfirmSection]}>
            {hasLimitError ? <InlineError>تعذر تحميل حدود العملية. أعد فتح الشاشة وحاول مرة أخرى.</InlineError> : null}
            {hasFeeError ? <InlineError>تعذر تحميل إعدادات الرسوم من الخادم. لا يمكن تأكيد السحب قبل إعادة المحاولة.</InlineError> : null}
            {type === "withdrawal" && portfolioQuery.isError ? <InlineError>تعذر تحميل الرصيد المتاح. حاول مرة أخرى.</InlineError> : null}
            {type === "withdrawal" && available <= 0 ? <InlineError>لا يوجد رصيد متاح للسحب حاليًا.</InlineError> : null}
            {type === "deposit" && !selectedMethod.transferNumber ? <InlineError>لا يمكن تأكيد الإيداع قبل تحديد رقم تحويل معتمد.</InlineError> : null}
            {formError ? <InlineError>{formError}</InlineError> : null}
            {hasRequestSnapshot && formError ? <SecondaryButton label="بدء طلب جديد" onPress={resetRequestIdentity} /> : null}
            <PrimaryButton label={requestMutation.isPending || isSubmitting ? "جارٍ الإرسال" : type === "deposit" ? "تأكيد الإيداع" : "تأكيد السحب"} onPress={submit} disabled={requestMutation.isPending || isSubmitting || !selectedMethod || (type === "deposit" && !selectedMethod.transferNumber) || hasFeeError || hasLimitError || (type === "withdrawal" && (available <= 0 || portfolioQuery.isError))} compact={compactFlow} />
          </View>
        ) : null}
        <CustomerSupportCard customerId={authMe.data?.customerId} operation={type} requestId={successReference || null} />
      </ScrollView>
      {type === "withdrawal" ? <Modal transparent animationType="fade" visible={pinVisible} onRequestClose={() => !isSubmitting && setPinVisible(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)" }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}><View style={styles.pinCard}>
          <Text style={styles.pinTitle}>رمز الأمان</Text>
          <Text style={styles.pinBody}>أدخل رمز الأمان المكوّن من 4 أرقام لتأكيد السحب. لا يُطلب الرمز عند فتح الصفحة أو إدخال البيانات.</Text>
          <TextInput value={securityPin} onChangeText={(value) => { setSecurityPin(value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="••••" placeholderTextColor={COLORS.dim} style={styles.pinInput} />
          {pinError ? <Text style={styles.errorText}>{pinError}</Text> : null}
          <View style={styles.pinActions}><SecondaryButton label="إلغاء" onPress={() => setPinVisible(false)} compact={compactFlow} /><PrimaryButton label="متابعة السحب" onPress={() => { setPinVisible(false); void submit(); }} disabled={isSubmitting} compact={compactFlow} /></View>
        </View></ScrollView>
      </Modal> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30 },
  header: { flexDirection: "row-reverse", alignItems: "center", gap: 9, marginBottom: 12, padding: 12, borderRadius: 19, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel, shadowColor: COLORS.accent, shadowOpacity: 0.2, shadowRadius: 11, elevation: 4 },
  headerIcon: { width: 48, height: 48, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, alignItems: "flex-end" },
  screenTitle: { color: COLORS.text, fontSize: 24, fontWeight: "900", textAlign: "right" },
  screenSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 2, textAlign: "right" },
  brandName: { color: COLORS.accent, fontSize: 9, fontWeight: "900", letterSpacing: 2, marginTop: 4 },
  backButton: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field, alignItems: "center", justifyContent: "center" },
  customerIdRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field, shadowColor: COLORS.accent, shadowOpacity: 0.12, shadowRadius: 8, elevation: 2 },
  customerIdCopy: { flex: 1, alignItems: "flex-end" },
  customerIdLabel: { color: COLORS.dim, fontSize: 10, fontWeight: "600" },
  customerIdValue: { color: COLORS.gold, fontSize: 13, fontWeight: "800", letterSpacing: 1, writingDirection: "ltr" },
  customerIdButton: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 5, minWidth: 56, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, marginRight: 10 },
  customerIdButtonText: { color: COLORS.gold, fontSize: 11, fontWeight: "700" },
  pinBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.72)", paddingHorizontal: 20 },
  pinCard: { width: "100%", maxWidth: 520, borderRadius: 24, borderWidth: 1, borderColor: COLORS.accent, backgroundColor: COLORS.panel, padding: 20 },
  pinTitle: { color: COLORS.text, fontSize: 20, fontWeight: "800", textAlign: "right" },
  pinBody: { color: COLORS.muted, fontSize: 13, lineHeight: 21, marginTop: 10, textAlign: "right" },
  pinInput: { marginTop: 16, minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field, color: COLORS.text, fontSize: 24, fontWeight: "800", letterSpacing: 9, textAlign: "center" },
  pinActions: { flexDirection: "row-reverse", alignItems: "center", gap: 10, marginTop: 18 },
  customerIdFeedback: { color: COLORS.gold, fontSize: 10, textAlign: "right", marginBottom: 6, marginTop: -5 },
  verificationNotice: { marginBottom: 12, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: "#D7A94877", backgroundColor: "#D7A94812", gap: 8 },
  verificationNoticeTitle: { color: COLORS.text, fontSize: 14, lineHeight: 22, fontWeight: "800", textAlign: "center" },
  verificationNoticeText: { color: COLORS.muted, fontSize: 12, lineHeight: 19, textAlign: "right" },
  methodsCard: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderWidth: 1, borderRadius: 18, padding: 10 },
  cardTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800", textAlign: "right" },
  cardSubtitle: { color: COLORS.muted, fontSize: 11, marginTop: 3, marginBottom: 8, textAlign: "right" },
  methodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodCard: { width: "47%", minHeight: 106, borderRadius: 16, backgroundColor: COLORS.field, borderColor: COLORS.border, borderWidth: 1, padding: 10, alignItems: "flex-end", justifyContent: "space-between", shadowColor: COLORS.accent, shadowOpacity: 0.12, shadowRadius: 7, elevation: 2 },
  methodName: { width: "100%", color: COLORS.text, fontSize: 13, fontWeight: "700", textAlign: "right", marginTop: 4 },
  methodImage: { width: "100%", height: 40, borderRadius: 10, backgroundColor: "#FFFFFF" },
  methodImageLarge: { width: 62, height: 38, borderRadius: 9, backgroundColor: "#FFFFFF" },
  methodIconFallback: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field },
  methodIconFallbackLarge: { width: 46, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field },
  formCard: { backgroundColor: COLORS.panel, borderColor: COLORS.border, borderWidth: 1, borderRadius: 22, padding: 12, shadowColor: COLORS.accent, shadowOpacity: 0.16, shadowRadius: 12, elevation: 4 },
  changeMethod: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  changeMethodText: { color: COLORS.accent, fontSize: 13, fontWeight: "800" },
  selectedMethod: { flexDirection: "column", alignItems: "flex-end", borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, backgroundColor: COLORS.field, padding: 11, marginBottom: 12, marginTop: 5, shadowColor: COLORS.accent, shadowOpacity: 0.13, shadowRadius: 8, elevation: 2 },
  selectedMethodCopy: { alignItems: "flex-end", marginTop: 6 },
  selectedMethodName: { color: COLORS.text, fontSize: 15, fontWeight: "800", textAlign: "right" },
  selectedMethodHint: { color: COLORS.muted, fontSize: 11, marginTop: 2, textAlign: "right" },
  fieldGroup: { marginTop: 10, padding: 11, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel, shadowColor: COLORS.accent, shadowOpacity: 0.1, shadowRadius: 7, elevation: 2 },
  fieldLabelRow: { flexDirection: "row-reverse", alignItems: "center", gap: 7, marginBottom: 5 },
  fieldLabel: { color: COLORS.muted, fontSize: 12, fontWeight: "700", textAlign: "right", marginBottom: 0 },
  input: { minHeight: 46, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.field, color: COLORS.text, fontSize: 15, paddingHorizontal: 13, paddingVertical: 10 },
  multilineInput: { minHeight: 92 },
  compactMultilineInput: { minHeight: 60, paddingVertical: 7 },
  transferCard: { marginTop: 10, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#171D27", shadowColor: COLORS.accent, shadowOpacity: 0.16, shadowRadius: 9, elevation: 3 },
  transferHeading: { flexDirection: "row-reverse", alignItems: "center", gap: 7, marginBottom: 8 },
  transferLabel: { marginBottom: 0 },
  freeDepositBadge: { marginRight: "auto", borderRadius: 10, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#171D27", paddingHorizontal: 9, paddingVertical: 5 },
  freeDepositText: { color: COLORS.gold, fontSize: 10, fontWeight: "800" },
  transferBox: { minHeight: 58, borderRadius: 15, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: COLORS.field, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10 },
  transferNumber: { flex: 1, minWidth: 0, flexShrink: 1, color: COLORS.gold, fontSize: 20, fontWeight: "900", letterSpacing: 1.2, textAlign: "left" },
  copyButton: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 8, flexShrink: 0 },
  copyButtonText: { color: COLORS.gold, fontWeight: "700", fontSize: 13 },
  feedbackText: { color: COLORS.gold, fontSize: 12, textAlign: "right", marginTop: 7 },
  warningBox: { borderRadius: 16, borderWidth: 1, borderColor: "#6B3942", backgroundColor: "#321D25", color: "#FFB4BE", padding: 13, fontSize: 13, lineHeight: 21, textAlign: "right" },
  helperText: { color: COLORS.dim, fontSize: 11, lineHeight: 18, textAlign: "right", marginTop: 8 },
  uploadGroup: { marginTop: 12, padding: 11, borderRadius: 17, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel },
  uploadHeading: { flexDirection: "row-reverse", alignItems: "center", gap: 7 },
  receiptDropzone: { minHeight: 142, marginTop: 8, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: COLORS.accent, backgroundColor: COLORS.field, alignItems: "center", justifyContent: "center", gap: 6 },
  dropzoneTitle: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  dropzoneSubtitle: { color: COLORS.muted, fontSize: 11 },
  receiptChangeButton: { minHeight: 42, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 7 },
  uploadButtonText: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  receiptPreview: { width: "100%", height: 180, borderRadius: 14, marginTop: 10, backgroundColor: COLORS.field, borderWidth: 1, borderColor: COLORS.border },
  balanceBox: { borderRadius: 18, borderWidth: 1, borderColor: "#273548", backgroundColor: "#121B28", padding: 14, shadowColor: COLORS.accent, shadowOpacity: 0.12, shadowRadius: 7, elevation: 2 },
  balanceInfo: { flexDirection: "row-reverse", alignItems: "center", gap: 7 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  balanceLabel: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  balanceValue: { color: COLORS.gold, fontSize: 21, fontWeight: "900" },
  compactBalanceBox: { padding: 9, borderRadius: 14 },
  compactBalanceRow: { paddingBottom: 6 },
  compactBalanceLabel: { fontSize: 11 },
  compactBalanceValue: { fontSize: 17 },
  compactReservationRow: { marginTop: 5 },
  compactReservationText: { fontSize: 10 },
  compactReservationValue: { fontSize: 11 },
  reservationRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 9 },
  reservationText: { color: COLORS.dim, fontSize: 12 },
  reservationValue: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  insufficientBox: { borderRadius: 17, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#211D12", padding: 14, marginTop: 17 },
  compactInsufficientBox: { padding: 9, borderRadius: 13, marginTop: 8 },
  insufficientTitle: { color: COLORS.accent, fontSize: 14, fontWeight: "800", textAlign: "right" },
  compactInsufficientTitle: { fontSize: 12 },
  insufficientBody: { color: "#C7B98D", fontSize: 12, lineHeight: 19, marginTop: 4, textAlign: "right" },
  compactInsufficientBody: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  primaryButton: { minHeight: 50, marginTop: 0, borderRadius: 16, borderWidth: 1, borderColor: COLORS.gold, backgroundColor: COLORS.gold, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, shadowColor: COLORS.accent, shadowOpacity: 0.12, shadowRadius: 6, elevation: 2 },
  primaryButtonText: { color: COLORS.background, fontSize: 15, fontWeight: "800" },
  secondaryButton: { minHeight: 44, marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  compactSecondaryButton: { minHeight: 36, marginTop: 6, borderRadius: 11, paddingHorizontal: 10 },
  secondaryButtonText: { color: COLORS.gold, fontSize: 14, fontWeight: "700" },
  disabledButton: { backgroundColor: "#384252", borderColor: "#384252" },
  disabledButtonText: { color: COLORS.dim },
  pressedButton: { opacity: 0.78 },
  errorText: { color: COLORS.red, fontSize: 13, lineHeight: 20, textAlign: "right", marginTop: 12 },
  errorPanel: { borderRadius: 16, borderWidth: 1, borderColor: "#6B3942", backgroundColor: "#321D25", padding: 13 },
  feeSummary: { marginTop: 8, borderRadius: 16, borderWidth: 1, borderColor: "#5C4A28", backgroundColor: "#171D27", padding: 13, shadowColor: COLORS.accent, shadowOpacity: 0.12, shadowRadius: 6, elevation: 2 },
  compactFeeSummary: { marginTop: 5, borderRadius: 13, padding: 8 },
  feeSummaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  compactFeeSummaryRow: { marginBottom: 3 },
  feeSummaryTotal: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8, marginTop: 3 },
  compactFeeSummaryTotal: { paddingTop: 6, marginTop: 2 },
  feeSummaryTotalLabel: { color: COLORS.gold, fontSize: 12, fontWeight: "900" },
  compactFeeSummaryTotalLabel: { fontSize: 11 },
  feeSummaryTotalValue: { color: COLORS.gold, fontSize: 14, fontWeight: "900" },
  compactFeeSummaryTotalValue: { fontSize: 12 },
  confirmSection: { width: "100%", marginTop: 12, gap: 4 },
  depositConfirmSection: { marginTop: 8 },
  depositScrollContent: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 8 },
  depositScrollContentTight: { paddingHorizontal: 8, paddingBottom: 6 },
  depositHeader: { gap: 7, marginBottom: 6, padding: 8, borderRadius: 15 },
  depositHeaderIcon: { width: 36, height: 36, borderRadius: 11 },
  depositScreenTitle: { fontSize: 20 },
  depositScreenSubtitle: { fontSize: 10, marginTop: 1 },
  depositBrandName: { marginTop: 2 },
  depositBackButton: { width: 36, height: 36, borderRadius: 11 },
  depositCustomerIdRow: { marginBottom: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12 },
  depositCustomerIdLabel: { fontSize: 9 },
  depositCustomerIdButton: { minWidth: 48, gap: 4, marginRight: 7, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 9 },
  depositCustomerIdButtonText: { fontSize: 10 },
  depositCustomerIdFeedback: { fontSize: 9, marginBottom: 3, marginTop: -3 },
  depositFormCard: { padding: 8, borderRadius: 16 },
  depositChangeMethod: { gap: 4, paddingVertical: 3, paddingHorizontal: 5, borderRadius: 8 },
  depositChangeMethodText: { fontSize: 11 },
  depositSelectedMethod: { flexDirection: "row-reverse", alignItems: "center", gap: 8, padding: 7, borderRadius: 12, marginBottom: 7, marginTop: 4 },
  depositSelectedMethodTight: { paddingVertical: 5, marginBottom: 5 },
  depositSelectedMethodCopy: { flex: 1, marginTop: 0 },
  depositSelectedMethodName: { fontSize: 13 },
  depositSelectedMethodHint: { fontSize: 9, marginTop: 1 },
  depositTransferCard: { marginTop: 6, padding: 8, borderRadius: 14 },
  depositTransferHeading: { gap: 5, marginBottom: 4 },
  depositFieldLabel: { fontSize: 11 },
  depositFreeDepositBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  depositFreeDepositText: { fontSize: 9 },
  depositTransferBox: { minHeight: 42, borderRadius: 11, paddingHorizontal: 7 },
  depositTransferNumber: { fontSize: 16, letterSpacing: 0.4 },
  depositCopyButton: { gap: 4, paddingHorizontal: 6, paddingVertical: 5 },
  depositCopyButtonText: { fontSize: 11 },
  depositHelperText: { fontSize: 9, lineHeight: 14, marginTop: 5 },
  depositFieldGroup: { marginTop: 5, padding: 7, borderRadius: 12, shadowOpacity: 0.08, shadowRadius: 5, elevation: 1 },
  depositInput: { minHeight: 36, borderRadius: 11, fontSize: 14, paddingHorizontal: 10, paddingVertical: 5 },
  depositUploadGroup: { marginTop: 7, padding: 7, borderRadius: 13 },
  depositUploadHeading: { gap: 5 },
  depositReceiptDropzone: { minHeight: 50, flexDirection: "row-reverse", justifyContent: "flex-start", gap: 9, marginTop: 5, paddingHorizontal: 10, borderRadius: 12 },
  depositReceiptDropzoneCopy: { flex: 1, alignItems: "flex-end" },
  depositDropzoneTitle: { fontSize: 12 },
  depositDropzoneSubtitle: { fontSize: 9 },
  depositReceiptPreview: { height: 72, marginTop: 6 },
  depositReceiptChangeButton: { minHeight: 32, marginTop: 5, borderRadius: 10 },
  depositUploadButtonText: { fontSize: 11 },
  depositPrimaryButton: { minHeight: 46, borderRadius: 14, gap: 6, paddingHorizontal: 12 },
  depositPrimaryButtonText: { fontSize: 14 },
  loadingPanel: { minHeight: 180, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: COLORS.muted, fontSize: 13 },
  successPanel: { borderRadius: 24, borderWidth: 1, borderColor: COLORS.accent, backgroundColor: "#171D27", padding: 22, alignItems: "center", shadowColor: COLORS.accent, shadowOpacity: 0.16, shadowRadius: 8, elevation: 3 },
  successIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.gold, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  successTitle: { color: COLORS.text, fontSize: 19, fontWeight: "800", textAlign: "center" },
  successBody: { color: COLORS.muted, fontSize: 14, lineHeight: 23, textAlign: "center", marginTop: 9 },
  referenceText: { color: COLORS.gold, fontSize: 12, textAlign: "center", marginTop: 14 },
  pendingText: { color: COLORS.muted, fontSize: 12, lineHeight: 19, textAlign: "center", marginTop: 12 },
});
