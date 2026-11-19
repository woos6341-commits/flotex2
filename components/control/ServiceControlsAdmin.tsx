import { ActivityIndicator, Switch, Text, View } from "react-native";
import { ActionButton, Card, Pill } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { showFinancialMessage } from "@/lib/financial-feedback";
import { SERVICE_CONTROL_IDS, SERVICE_CONTROL_LABELS, type ServiceControlId } from "@/shared/service-controls";

export function ServiceControlsAdmin() {
  const query = trpc.admin.serviceControls.useQuery(undefined, { refetchInterval: 5000, retry: false });
  const utils = trpc.useUtils();
  const setOne = trpc.admin.setServiceControl.useMutation({
    onSuccess: async () => { await utils.admin.serviceControls.invalidate(); },
    onError: (error) => showFinancialMessage("تعذر تحديث الخدمة", error.message),
  });
  const setAll = trpc.admin.setAllServiceControls.useMutation({
    onSuccess: async (_, variables) => {
      await utils.admin.serviceControls.invalidate();
      showFinancialMessage(variables.enabled ? "تم تشغيل جميع الخدمات" : "تم إيقاف جميع الخدمات", "يسري التغيير فورًا على المستخدمين دون حذف أي بيانات أو أرصدة أو طلبات.");
    },
    onError: (error) => showFinancialMessage("تعذر تحديث الخدمات", error.message),
  });
  const services = query.data;
  const enabledCount = services ? SERVICE_CONTROL_IDS.filter((id) => services[id]).length : 0;
  const toggle = (id: ServiceControlId, enabled: boolean) => setOne.mutate({ id, enabled });
  return (
    <View className="gap-4">
      <Card className="border-[#5C4A28]">
        <View className="flex-row items-center justify-between gap-3">
          <Pill tone={enabledCount === SERVICE_CONTROL_IDS.length ? "green" : enabledCount === 0 ? "red" : "gold"}>{query.isLoading ? "جارٍ التحميل" : `${enabledCount}/${SERVICE_CONTROL_IDS.length} تعمل`}</Pill>
          <View className="flex-1"><Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>إدارة الخدمات</Text><Text className="mt-1 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>تحكم فوري للمستخدمين فقط؛ تظل لوحة المدير وبيانات الحسابات متاحة.</Text></View>
        </View>
        <View className="mt-4 gap-2">
          <ActionButton label={setAll.isPending ? "جارٍ التنفيذ..." : "إيقاف جميع الخدمات"} icon="pause-circle-outline" secondary onPress={() => setAll.mutate({ enabled: false })} />
          <ActionButton label={setAll.isPending ? "جارٍ التنفيذ..." : "تشغيل جميع الخدمات"} icon="play-circle-outline" onPress={() => setAll.mutate({ enabled: true })} />
        </View>
        <Text className="mt-3 text-[11px] leading-5 text-[#657286]" style={{ textAlign: "right" }}>إيقاف الخدمات يمنع الطلبات الجديدة فقط، ولا يحذف العمليات السابقة ولا يغيّر الأرصدة أو الطلبات المعلقة.</Text>
      </Card>
      <Card>
        <Text className="text-base font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>حالة كل خدمة</Text>
        {query.isLoading ? <ActivityIndicator className="mt-4" color="#D7A948" /> : query.isError ? <Text className="mt-4 text-sm leading-6 text-[#FF7D8D]" style={{ textAlign: "right" }}>تعذر تحميل حالة الخدمات. أعد المحاولة.</Text> : (
          <View className="mt-3 gap-2">
            {SERVICE_CONTROL_IDS.map((id) => {
              const enabled = services?.[id] ?? true;
              return <View key={id} className="flex-row items-center justify-between rounded-2xl border border-[#273548] bg-[#0B1018] px-3 py-3"><View className="flex-row items-center gap-2"><Switch disabled={setOne.isPending || setAll.isPending} value={enabled} onValueChange={(value) => toggle(id, value)} trackColor={{ false: "#273548", true: "#5C4A28" }} thumbColor={enabled ? "#D7A948" : "#9BA8B8"} /><Pill tone={enabled ? "green" : "red"}>{enabled ? "تعمل" : "متوقفة"}</Pill></View><Text className="flex-1 text-sm font-bold text-[#F7F1E3]" style={{ textAlign: "right" }}>{SERVICE_CONTROL_LABELS[id]}</Text></View>;
            })}
          </View>
        )}
      </Card>
    </View>
  );
}
