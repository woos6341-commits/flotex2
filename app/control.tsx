import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen, BrandMark, Card, EmptyState, ActionButton } from "@/components/atheer-ui";
import { FeesAdmin, LimitsAdmin, PaymentMethodsAdmin, RequestsReview } from "@/components/payments-admin";
import { AccountVerificationAdmin, CoinAdmin, CustomerManagement, CustomerSupportSettings, CustomerTopUp, OperationsSummary, OwnerOverview, PhoneVerificationAdmin, ReadinessSection, SavingsAdmin, SavingsSettingsAdmin, PhoneChangeAdmin, AdminNotifications, SupportMessagingAdmin, AdminRequestsCenter, GoldAdmin, ExternalTransfersAdmin, GameTopupAdmin, HomeActionOrderAdmin, UiButtonVisibilityAdmin, ShareFileAdmin, ServiceControlsAdmin, SectionHeader, type ControlSection } from "@/components/control";
import { MoneyTransferRequestsAdmin } from "@/components/money-transfers";
import { AppUpdateAdmin } from "@/components/control/AppUpdateAdmin";
import { AdminRequestDetails } from "@/components/control/AdminRequestDetails";
import { AdminCreatedAccountsConnected } from "@/components/control/AdminCreatedAccountsConnected";
import { ManualVerificationAdmin } from "@/components/control/ManualVerificationAdmin";
import { GuestSupportAdmin } from "@/components/guest-support/GuestSupportAdmin";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { ADMIN_EMAIL } from "@/shared/admin";
import type { SupportCategory } from "@/shared/support-categories";

export default function ControlScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [section, setSection] = useState<ControlSection>("overview");
  const [supportUserId, setSupportUserId] = useState<number | null>(null);
  const [supportCategory, setSupportCategory] = useState<SupportCategory>("account");
  const [guestTicketId, setGuestTicketId] = useState<number | null>(null);
  const [detailsKey, setDetailsKey] = useState<string | null>(null);
  const [requestTab, setRequestTab] = useState<"payments" | "transfers">("payments");
  const [selectedPaymentRequestId, setSelectedPaymentRequestId] = useState<number | null>(null);
  // The server remains the authorization boundary; this email check only avoids hiding the UI for a stale cached role.
  const isAdmin = user?.email?.trim().toLowerCase() === ADMIN_EMAIL;
  const stats = trpc.admin.stats.useQuery(undefined, { enabled: isAdmin });
  const readiness = trpc.readiness.useQuery();
  const recentOperations = trpc.admin.recentOperations.useQuery({ limit: 100, pendingOnly: true }, { enabled: isAdmin, refetchInterval: 7000, refetchOnWindowFocus: true });
  const requestDetails = trpc.admin.requestDetails.useQuery({ key: detailsKey ?? "payment-1" }, { enabled: isAdmin && detailsKey !== null, retry: false, gcTime: 0 });
  const customers = trpc.admin.customers.useQuery({ search: "" }, { enabled: isAdmin });
  const utils = trpc.useUtils();

  if (loading) return <Screen title="Flotex EGP Control"><View className="flex-1 items-center justify-center"><ActivityIndicator color="#D7A948" /></View></Screen>;
  if (!user) {
    return (
      <Screen title="Flotex EGP Control" subtitle="تسجيل الإدارة بالبريد وكلمة المرور">
        <Card>
          <BrandMark />
          <Text className="mt-5 text-xl font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>سجّل الدخول للمتابعة</Text>
          <Text className="mt-2 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>استخدم البريد الإلكتروني وكلمة المرور من شاشة تسجيل الدخول. صلاحية الإدارة مرتبطة بالحساب الموثق المخصص.</Text>
          <View className="mt-6"><ActionButton label="العودة إلى تسجيل الدخول" icon="log-in-outline" onPress={() => router.replace("/(tabs)")} /></View>
        </Card>
      </Screen>
    );
  }
  if (!isAdmin) {
    return <Screen title="Flotex EGP Control"><View className="w-full"><EmptyState title="وصول الإدارة فقط" text="هذا الحساب غير مصرح له بفتح لوحة الإدارة." /></View></Screen>;
  }

  const refreshAfterRequest = () => {
    void recentOperations.refetch();
    void utils.admin.recentOperations.invalidate();
    void stats.refetch();
    void customers.refetch();
    void utils.admin.customers.invalidate();
    void utils.admin.customerDetails.invalidate();
    void utils.portfolio.get.invalidate();
    void utils.portfolio.transactions.invalidate();
    void utils.admin.moneyTransfers.invalidate();
    void utils.transfers.mine.invalidate();
  };
  const openReview = (target: ControlSection, tab?: "payments" | "transfers", userId?: number, category?: SupportCategory, ticketId?: number) => {
    setDetailsKey(null);
    setSelectedPaymentRequestId(null);
    if (tab) setRequestTab(tab);
    if (userId && category) { setSupportUserId(userId); setSupportCategory(category); }
    setGuestTicketId(ticketId ?? null);
    setSection(target);
  };
  const selectRequest = (target: ControlSection, tab?: "payments" | "transfers", userId?: number, category?: SupportCategory, ticketId?: number, key?: string) => {
    if (target === "guestSupport" && ticketId) openReview(target, tab, userId, category, ticketId);
    else if (key) setDetailsKey(key);
    else openReview(target, tab, userId, category, ticketId);
  };
  const sectionTitle: Record<Exclude<ControlSection, "overview">, string> = {
    payments: "وسائل الدفع",
    fees: "إدارة الرسوم",
    requests: "مراجعة الإيداعات والسحوبات",
    savings: "مراجعة عمليات الإدخار",
    gold: "إدارة الذهب",
    coin: "محفظة كوين فولتكس",
    topup: "شحن رصيد العملاء",
    customers: "العملاء والبحث والتدقيق",
    readiness: "جاهزية التكاملات",
    updates: "تحديث التطبيق",
    customerSupport: "إعدادات خدمة العملاء",
    phoneVerification: "توثيق أرقام الهواتف",
    accountVerification: "توثيق الحساب",
    phoneChange: "طلبات تغيير أرقام الهاتف",
    notifications: "الإشعارات الإدارية",
    supportMessaging: "المراسلة والدعم",
    guestSupport: "مراسلات الزوار",
    verificationCodes: "إدارة رموز التحقق والحسابات",
    adminAccounts: "إنشاء الحسابات",
    externalTransfers: "طلبات المعاملات الخارجية",
    gameTopup: "إدارة خدمات الألعاب",
    homeActionOrder: "مواضع أزرار الخدمات",
    buttonVisibility: "إدارة ظهور الأزرار",
    shareFile: "ملف المشاركة",
    serviceControls: "إدارة الخدمات",
  };

  return (
    <Screen title="Flotex EGP Control" subtitle={detailsKey ? "تفاصيل الطلب" : section === "overview" ? "مركز الإدارة المنظم" : sectionTitle[section]}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 140 }}>
        {detailsKey ? <AdminRequestDetails requestKey={detailsKey} details={requestDetails} onBack={() => setDetailsKey(null)} onOpenReview={(target) => { openReview(target.section, target.tab, target.userId, target.category, target.guestTicketId); if (target.section === "requests" && target.tab === "payments" && target.key === `payment-${target.id}`) setSelectedPaymentRequestId(target.id); }} /> : section === "overview" ? <><AdminRequestsCenter onSelect={selectRequest} /><OperationsSummary operations={recentOperations} onOpen={selectRequest} /><OwnerOverview stats={stats} readiness={readiness} onSelect={setSection} /></> : (
          <>
            <SectionHeader title={sectionTitle[section]} subtitle="ارجع إلى القائمة الرئيسية لاختيار قسم آخر" onBack={() => { setSelectedPaymentRequestId(null); setSection("overview"); }} />
            {section === "payments" ? <><PaymentMethodsAdmin /><LimitsAdmin /></> : null}
            {section === "fees" ? <FeesAdmin /> : null}
            {section === "requests" ? <>
              <View className="mb-4 flex-row gap-2">
                <Pressable onPress={() => { setSelectedPaymentRequestId(null); setRequestTab("payments"); }} className={`flex-1 items-center rounded-2xl border px-3 py-3 ${requestTab === "payments" ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#121B28]"}`}><Text className={`text-xs font-bold ${requestTab === "payments" ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>الإيداعات والسحوبات</Text></Pressable>
                <Pressable onPress={() => { setSelectedPaymentRequestId(null); setRequestTab("transfers"); }} className={`flex-1 items-center rounded-2xl border px-3 py-3 ${requestTab === "transfers" ? "border-[#D7A948] bg-[#D7A94822]" : "border-[#273548] bg-[#121B28]"}`}><Text className={`text-xs font-bold ${requestTab === "transfers" ? "text-[#D7A948]" : "text-[#9BA8B8]"}`}>طلبات إرسال الأموال</Text></Pressable>
              </View>
              {requestTab === "payments" ? <RequestsReview selectedRequestId={selectedPaymentRequestId} onUpdated={refreshAfterRequest} /> : <MoneyTransferRequestsAdmin onUpdated={refreshAfterRequest} />}
            </> : null}
            {section === "savings" ? <><SavingsSettingsAdmin /><SavingsAdmin /></> : null}
            {section === "gold" ? <GoldAdmin /> : null}
            {section === "coin" ? <CoinAdmin /> : null}
            {section === "topup" ? <CustomerTopUp onUpdated={refreshAfterRequest} /> : null}
            {section === "customers" ? <CustomerManagement /> : null}
            {section === "readiness" ? <ReadinessSection readiness={readiness} /> : null}
            {section === "updates" ? <AppUpdateAdmin /> : null}
            {section === "customerSupport" ? <CustomerSupportSettings /> : null}
            {section === "phoneVerification" ? <PhoneVerificationAdmin /> : null}
            {section === "accountVerification" ? <AccountVerificationAdmin /> : null}
            {section === "phoneChange" ? <PhoneChangeAdmin /> : null}
            {section === "notifications" ? <AdminNotifications /> : null}
            {section === "supportMessaging" ? <SupportMessagingAdmin initialUserId={supportUserId} initialCategory={supportCategory} onOpenGuest={(ticketId) => openReview("guestSupport", undefined, undefined, undefined, ticketId)} /> : null}
            {section === "guestSupport" ? <GuestSupportAdmin initialTicketId={guestTicketId} /> : null}
            {section === "verificationCodes" ? <ManualVerificationAdmin /> : null}
            {section === "adminAccounts" ? <AdminCreatedAccountsConnected /> : null}
            {section === "externalTransfers" ? <ExternalTransfersAdmin onOpenChat={(userId) => { setSupportUserId(userId); setSupportCategory("external_transaction"); setSection("supportMessaging"); }} /> : null}
            {section === "gameTopup" ? <GameTopupAdmin /> : null}
            {section === "homeActionOrder" ? <HomeActionOrderAdmin /> : null}
            {section === "buttonVisibility" ? <UiButtonVisibilityAdmin /> : null}
            {section === "shareFile" ? <ShareFileAdmin /> : null}
            {section === "serviceControls" ? <ServiceControlsAdmin /> : null}
          </>
        )}
        <Text className="mt-6 text-center text-xs leading-5 text-[#657286]">Flotex EGP لا ينفذ أموالًا حقيقية خارج النظام. الأرصدة والعمليات المعروضة سجلات داخلية وليست إثباتًا لتحويل أو ملكية خارجية.</Text>
      </ScrollView>
    </Screen>
  );
}
