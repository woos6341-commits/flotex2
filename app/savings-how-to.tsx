import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ActionButton, Card, Screen, formatMoney } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { SAVINGS_SETTINGS_DEFAULTS } from "@/shared/savings-settings";

export default function SavingsHowToScreen() {
  const router = useRouter();
  const settings = trpc.savings.settings.useQuery();
  const portfolio = trpc.portfolio.get.useQuery();
  if (settings.isLoading || portfolio.isLoading) return <Screen title="كيفية الادخار"><View className="flex-1 items-center justify-center"><ActivityIndicator color="#D7A948" /></View></Screen>;
  return (
    <Screen title="كيفية الادخار" subtitle="الشروط والعائد والاسترداد في Flotex EGP">
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Card className="border-[#5C4A28]">
          <Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>معدلات العائد والرسوم</Text>
          <InfoRow label="العائد اليومي" value={`${settings.data?.dailyRatePercent ?? SAVINGS_SETTINGS_DEFAULTS.dailyRatePercent}%`} />
          <InfoRow label="العائد الشهري" value={`${settings.data?.monthlyRatePercent ?? SAVINGS_SETTINGS_DEFAULTS.monthlyRatePercent}%`} />
          <InfoRow label="العائد السنوي" value={`${settings.data?.yearlyRatePercent ?? SAVINGS_SETTINGS_DEFAULTS.yearlyRatePercent}%`} />
          <InfoRow label="رسوم طلب الادخار" value={`${formatMoney(settings.data?.feeAmount ?? SAVINGS_SETTINGS_DEFAULTS.feeAmount)}`} />
          <InfoRow label="الحد الأدنى" value={`${formatMoney(settings.data?.minimumAmount ?? SAVINGS_SETTINGS_DEFAULTS.minimumAmount)}`} />
        </Card>
        <Card className="mt-4">
          <Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>تفاصيل المحفظة</Text>
          <InfoRow label="الرصيد" value={`${formatMoney(portfolio.data?.available?.balance)}`} />
          <InfoRow label="المحجوز" value={`${formatMoney(portfolio.data?.available?.reservedTotal)}`} />
          <InfoRow label="الرصيد المتاح" value={`${formatMoney(portfolio.data?.available?.available)}`} />
        </Card>
        <Card className="mt-4">
          <Text className="text-lg font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>خطوات وشروط الادخار</Text>
          <Paragraph>1. اختر خطة يومية أو شهرية أو سنوية. يظهر لك العائد المتوقع للفترة والرسوم وإجمالي الخصم قبل إرسال الطلب.</Paragraph>
          <Paragraph>2. يُرسل الطلب للمراجعة. يبقى المبلغ محجوزًا مؤقتًا أثناء المراجعة، ولا يُخصم نهائيًا إلا عند اعتماد الطلب.</Paragraph>
          <Paragraph>3. تبدأ دورة العائد بعد اعتماد الخطة؛ العائد اليومي يُحسب كل 24 ساعة. إذا لم تتم الموافقة على عائد الفترة خلال 5 دقائق من موعد استحقاقه، يضيفه النظام تلقائيًا. ويبدأ موعد الفترة التالية من حد الاستحقاق السابق، لا من وقت تنفيذ الإضافة.</Paragraph>
          <Paragraph>4. تُحسب الأرباح على أصل الادخار وفق النسبة الحالية للخطة، وتُقرب الإضافة الفعلية لأقرب قرش. تابع التفاصيل والحركات من «سجل الادخار».</Paragraph>
          <Paragraph>5. يمكن طلب استرداد أصل المبلغ بعد 48 ساعة من وقت تقديم الطلب لجميع الخطط. بعد اكتمال الاسترداد تتوقف الاستحقاقات القادمة ولا تُضاف أرباح جديدة للخطة.</Paragraph>
          <View className="mt-3 rounded-2xl border border-[#D7A94844] bg-[#D7A94812] p-3">
            <Text className="text-xs leading-5 text-[#C7B98D]" style={{ textAlign: "right" }}>مثال توضيحي فقط: عند ادخار 1000 ج.م بالعائد اليومي الافتراضي 0.0548% يكون التقدير اليومي 0.548 ج.م قبل التقريب. النسب والرسوم المعتمدة الظاهرة أعلاه هي إعدادات الحساب الحالية.</Text>
          </View>
        </Card>
        <View className="mt-4"><ActionButton label="العودة إلى الادخار" icon="arrow-back-outline" secondary onPress={() => router.back()} /></View>
      </ScrollView>
    </Screen>
  );
}

function Paragraph({ children }: { children: string }) {
  return <Text className="mt-3 text-sm leading-6 text-[#9BA8B8]" style={{ textAlign: "right" }}>{children}</Text>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <View className="mt-3 flex-row items-center justify-between border-b border-[#273548] pb-2"><Text className="text-sm font-bold text-[#D7A948]" style={{ writingDirection: "ltr" }}>{value}</Text><Text className="text-xs text-[#9BA8B8]" style={{ textAlign: "right" }}>{label}</Text></View>;
}
