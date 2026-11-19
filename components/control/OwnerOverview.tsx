import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { BrandMark, Card, Metric, Pill, formatMoney } from "@/components/atheer-ui";
import { ControlMenuCard, type ControlSection } from "./ControlMenu";

type StatsQuery = { data?: { customers?: number; balances?: string | number; deposits?: string | number; withdrawals?: string | number; pending?: number; profitLoss?: string | number }; isLoading?: boolean };
type ReadinessQuery = { data?: { marketData?: { connected?: boolean; provider?: string }; gold?: { connected?: boolean; provider?: string }; brokerage?: { connected?: boolean; provider?: string }; payments?: { connected?: boolean; provider?: string } }; isLoading?: boolean };
type MenuAction = { section: ControlSection; title: string; description: string; icon: Parameters<typeof ControlMenuCard>[0]["icon"] };
type MenuGroup = { id: string; title: string; description: string; primary: boolean; actions: MenuAction[] };
const ADMIN_GROUPS: MenuGroup[] = [
  { id: "money-assets", title: "التمويل والادخار والأصول", description: "الإيداع والسحب والطلبات وخطط الادخار", primary: true, actions: [
    { section: "payments", title: "وسائل الدفع", description: "إدارة الأرقام والصور وحدود الإيداع والسحب", icon: "card-outline" },
    { section: "fees", title: "إدارة الرسوم", description: "تعديل شرائح السحب ورسوم إرسال الأموال؛ الإيداع مجاني", icon: "options-outline" },
    { section: "requests", title: "مراجعة الإيداعات والسحوبات", description: "مراجعة الإيداعات والسحوبات وطلبات إرسال الأموال", icon: "checkmark-done-outline" },
    { section: "savings", title: "مراجعة عمليات الإدخار", description: "موافقة أو رفض الطلبات ومتابعة الأصل والعوائد والدفعات", icon: "lock-closed-outline" },
    { section: "serviceControls", title: "إدارة الخدمات", description: "تشغيل أو إيقاف الخدمات للمستخدمين فورًا مع بقاء الإدارة متاحة", icon: "power-outline" },
    { section: "gold", title: "إدارة الذهب", description: "الأسعار والرسوم والمخزون والطلبات غير المنفذة", icon: "diamond-outline" },
    { section: "coin", title: "محفظة كوين فولتكس", description: "الأسعار والمخزون وتمويل البيع والرسوم وطلبات العملاء", icon: "cash-outline" },
    { section: "gameTopup", title: "إدارة خدمات الألعاب", description: "طلبات الشحن والإيداع والسحب والألعاب والباقات والصور ومحفظة التمويل", icon: "game-controller-outline" },
    { section: "homeActionOrder", title: "مواضع أزرار الخدمات", description: "اسحب خدمات ودعم الرئيسية والمحفظة واحفظ التصميم للمستخدمين", icon: "reorder-three-outline" },
    { section: "buttonVisibility", title: "إدارة ظهور الأزرار", description: "إظهار أو إخفاء أزرار الرئيسية والمحفظة للجميع أو تخصيص مستخدم من ملفه الشامل", icon: "eye-outline" },
  ] },
  { id: "external", title: "المعاملات الخارجية", description: "مراجعة الطلبات وفتح مراسلة المستخدم المرتبطة بها", primary: true, actions: [
    { section: "externalTransfers", title: "طلبات المعاملات الخارجية", description: "متابعة طلبات التحويل إلى الدول الخارجية", icon: "globe-outline" },
  ] },
  { id: "verification", title: "التطبيق والتحقق", description: "التحديثات والتوثيق والتحقق من الهوية والهاتف", primary: true, actions: [
    { section: "updates", title: "تحديث التطبيق", description: "إدارة إصدار Android ورابط APK وملاحظات التحديث", icon: "cloud-download-outline" },
    { section: "phoneVerification", title: "توثيق أرقام الهواتف", description: "مراجعة الطلبات وإعداد Telegram والبريد", icon: "shield-checkmark-outline" },
    { section: "accountVerification", title: "توثيق الحساب", description: "مراجعة صور الهوية وبيانات العميل", icon: "person-circle-outline" },
    { section: "phoneChange", title: "طلبات تغيير أرقام الهاتف", description: "مشاهدة صور الهوية ومراجعة طلبات التغيير", icon: "phone-portrait-outline" },
  ] },
  { id: "sharing", title: "المشاركة" , description: "إدارة الملف الذي يظهر للعملاء للمشاركة", primary: true, actions: [
    { section: "shareFile", title: "ملف المشاركة", description: "رفع واستبدال الملف المتاح للمشاركة من حساب العميل", icon: "share-social-outline" },
  ] },
  { id: "communication", title: "المراسلات والإشعارات", description: "الرد على المستخدمين وإدارة قنوات خدمة العملاء", primary: true, actions: [
    { section: "notifications", title: "الإشعارات الإدارية", description: "إرسال إشعار لمستخدم أو للجميع ومتابعة القراءة", icon: "megaphone-outline" },
    { section: "supportMessaging", title: "المراسلة والدعم", description: "فتح محادثات المستخدمين والرد عليهم مع معرفة الجديد", icon: "chatbubbles-outline" },
    { section: "guestSupport", title: "مراسلات الزوار", description: "فتح محادثات الزوار غير المسجلين ومتابعتها", icon: "chatbubble-ellipses-outline" },
    { section: "customerSupport", title: "إعدادات خدمة العملاء", description: "إدارة بريد الدعم واسم مستخدم Telegram", icon: "headset-outline" },
  ] },
  { id: "topup", title: "شحن رصيد العملاء", description: "البحث برقم الحساب وتسجيل شحن موثق وآمن", primary: true, actions: [
    { section: "topup", title: "شحن رصيد العملاء", description: "البحث بالـ ID وتسجيل شحن موثق وآمن", icon: "wallet-outline" },
  ] },
];
const CUSTOMER_TOOLS: MenuAction[] = [
  { section: "customers", title: "العملاء والبحث والتدقيق", description: "تفاصيل العميل والرصيد والخصم وسجل الحركات", icon: "people-outline" },
  { section: "adminAccounts", title: "إنشاء الحسابات", description: "إنشاء حساب جديد ومتابعة أول دخول وتغيير كلمة المرور", icon: "person-add-outline" },
  { section: "verificationCodes", title: "إدارة رموز التحقق والحسابات", description: "إصدار الرموز المقيدة ومراجعة حالتها", icon: "key-outline" },
  { section: "readiness", title: "جاهزية التكاملات", description: "حالة السوق والوسيط والدفع الحالية", icon: "pulse-outline" },
];

export function OwnerOverview({ stats, readiness, onSelect }: { stats: StatsQuery; readiness: ReadinessQuery; onSelect: (section: ControlSection) => void }) {
  const [search, setSearch] = useState("");
  const matches = (item: MenuAction) => `${item.title} ${item.description}`.toLocaleLowerCase("ar-EG").includes(search.trim().toLocaleLowerCase("ar-EG"));
  return (
    <View>
      <Card className="mb-4"><View className="flex-row items-center justify-between"><View><Text className="text-xl font-bold text-[#F7F1E3]">مركز المالك</Text><Text className="mt-1 text-xs text-[#9BA8B8]">إدارة واضحة للعمليات دون فقدان أدوات العملاء</Text></View><BrandMark compact /></View></Card>
      <TextInput accessibilityLabel="بحث في أقسام لوحة الإدارة" value={search} onChangeText={setSearch} placeholder="ابحث في أقسام الإدارة..." placeholderTextColor="#657286" className="mb-4 rounded-xl border border-[#273548] bg-[#121B28] px-3 py-3 text-sm text-[#F7F1E3]" style={{ textAlign: "right" }} />
      {ADMIN_GROUPS.filter((group) => group.actions.some(matches)).map((group) => <View key={group.id} className="mb-4">
        <View className="mb-2 flex-row items-center gap-3"><View className="h-px flex-1 bg-[#273548]" /><View className="max-w-[85%]"><Text className="text-right text-sm font-extrabold text-[#D7A948]">{group.title}</Text><Text className="mt-1 text-right text-[10px] leading-4 text-[#9BA8B8]">{group.description}</Text></View></View>
        <View className="gap-3">{group.actions.filter(matches).map((item) => <ControlMenuCard key={item.section} primary={group.primary} title={item.title} description={item.description} icon={item.icon} onPress={() => onSelect(item.section)} />)}</View>
      </View>)}
      <Card className="mb-4"><Text className="text-base font-bold text-[#F7F1E3]">إحصاءات مختصرة</Text>{stats.isLoading ? <ActivityIndicator className="mt-4" color="#D7A948" /> : <View className="mt-3 flex-row flex-wrap gap-3"><Metric label="العملاء" value={String(stats.data?.customers ?? 0)} icon="people-outline" /><Metric label="الأرصدة" value={formatMoney(stats.data?.balances)} icon="wallet-outline" /><Metric label="الإيداعات" value={formatMoney(stats.data?.deposits)} icon="arrow-down-circle-outline" tone="green" /><Metric label="السحوبات" value={formatMoney(stats.data?.withdrawals)} icon="arrow-up-circle-outline" tone="red" /><Metric label="معلّق" value={String(stats.data?.pending ?? 0)} icon="time-outline" /><Metric label="الربح/الخسارة" value={formatMoney(stats.data?.profitLoss)} icon="pulse-outline" tone="green" /></View>}</Card>
      {CUSTOMER_TOOLS.some(matches) ? <View className="mb-4"><View className="mb-2 flex-row items-center gap-3"><View className="h-px flex-1 bg-[#273548]" /><Text className="text-right text-sm font-extrabold text-[#D7A948]">العملاء والتكاملات</Text></View><View className="gap-3">{CUSTOMER_TOOLS.filter(matches).map((item) => <ControlMenuCard key={item.section} title={item.title} description={item.description} icon={item.icon} onPress={() => onSelect(item.section)} />)}</View></View> : null}
    </View>
  );
}

export function ReadinessSection({ readiness }: { readiness: ReadinessQuery }) {
  return <Card><Text className="text-base font-bold text-[#F7F1E3]">حالة التكاملات</Text><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]">لا يتم تفعيل أي خدمة مالية قبل التعاقد والاختبار.</Text>{readiness.isLoading ? <ActivityIndicator className="mt-4" color="#D7A948" /> : <View className="mt-3 flex-row flex-wrap gap-2"><Pill tone={readiness.data?.gold?.connected ? "green" : "muted"}>الذهب: {readiness.data?.gold?.provider || "غير متصل"}</Pill><Pill tone={readiness.data?.marketData?.connected ? "green" : "muted"}>السوق: {readiness.data?.marketData?.provider || "غير متصل"}</Pill><Pill tone={readiness.data?.brokerage?.connected ? "green" : "muted"}>الوسيط: {readiness.data?.brokerage?.provider || "غير متصل"}</Pill><Pill tone={readiness.data?.payments?.connected ? "green" : "muted"}>الدفع: {readiness.data?.payments?.provider || "غير متصل"}</Pill></View>}</Card>;
}
