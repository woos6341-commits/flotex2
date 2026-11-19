import { useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import { Card, Pill } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { formatEgyptDateTime, UI_BUTTONS, type UiSurface } from "@/shared/ui-button-visibility";

const SURFACE_LABELS: Record<UiSurface, string> = { home: "الواجهة الرئيسية", wallet: "صفحة المحفظة" };
const auditActionLabel = (action: "shown" | "hidden" | "inherit") => action === "shown" ? "أظهر" : action === "hidden" ? "أخفى" : "أعاد إلى الإعداد العام";

export function UiButtonVisibilityAdmin() {
  const [surface, setSurface] = useState<UiSurface>("home");
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const settings = trpc.admin.uiButtonVisibility.global.useQuery(undefined, { refetchInterval: 10_000, refetchOnWindowFocus: true });
  const audit = trpc.admin.uiButtonVisibility.audit.useQuery({ limit: 30 }, { refetchInterval: 10_000, refetchOnWindowFocus: true });
  const update = trpc.admin.uiButtonVisibility.setGlobal.useMutation({ onSuccess: () => {
    void utils.admin.uiButtonVisibility.global.invalidate();
    void utils.admin.uiButtonVisibility.audit.invalidate();
  } });
  const currentRows = settings.data?.filter((item) => item.surface === surface) ?? [];

  return <View>
    <Text className="mb-1 text-lg font-bold text-[#F7F1E3]">إدارة ظهور الأزرار</Text>
    <Text className="mb-3 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>اختر الواجهة ثم أظهر أو أخفِ أزرارها على جميع المستخدمين. الإخفاء يغيّر الظهور فقط ولا يحذف المسار أو يعطّل وظيفته؛ تصل التغييرات إلى التطبيق تلقائيًا.</Text>
    <View className="mb-3 flex-row gap-2">
      {(["home", "wallet"] as const).map((item) => <Pressable key={item} accessibilityRole="button" onPress={() => setSurface(item)} className={`flex-1 items-center rounded-xl border px-3 py-3 ${surface === item ? "border-[#D7A948] bg-[#242116]" : "border-[#273548] bg-[#101720]"}`}><Text className={surface === item ? "font-bold text-[#D7A948]" : "text-[#9BA8B8]"}>{SURFACE_LABELS[item]}</Text></Pressable>)}
    </View>
    <TextInput value={reason} onChangeText={setReason} maxLength={500} placeholder="سبب التغيير (اختياري — يضاف إلى سجل الإدارة)" placeholderTextColor="#657286" className="mb-3 rounded-xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]" />
    {settings.isLoading ? <ActivityIndicator className="my-4" color="#D7A948" /> : settings.isError ? <Text className="mb-3 text-right text-sm text-[#FF7D8D]">تعذر تحميل إعدادات الظهور.</Text> : null}
    {UI_BUTTONS[surface].map((button) => {
      const saved = currentRows.find((item) => item.buttonId === button.id);
      const visible = saved?.visible ?? true;
      return <Card key={`${surface}:${button.id}`} className="mb-2 border-[#273548]">
        <View className="flex-row items-center justify-between">
          <Switch accessibilityLabel={`إظهار ${button.label}`} value={visible} disabled={update.isPending || settings.isLoading || settings.isError} onValueChange={(nextVisible) => update.mutate({ surface, buttonId: button.id, visible: nextVisible, reason: reason.trim() || undefined })} trackColor={{ false: "#3A4655", true: "#866A2F" }} thumbColor={visible ? "#D7A948" : "#9BA8B8"} />
          <View className="mr-3 flex-1 items-end">
            <Text className="text-right font-semibold text-[#F7F1E3]">{button.label}</Text>
            <Pill tone={visible ? "green" : "muted"}>{visible ? "ظاهر للجميع" : "مخفي للجميع"}</Pill>
          </View>
        </View>
        {saved?.reason ? <Text className="mt-2 text-right text-xs text-[#9BA8B8]">السبب المسجل: {saved.reason}</Text> : null}
      </Card>;
    })}
    {update.isError ? <Text className="mb-2 text-right text-xs text-[#FF7D8D]">تعذر حفظ التغيير. أعد المحاولة.</Text> : null}
    <Card className="mt-2 border-[#5C4A28]">
      <Text className="mb-3 text-right text-base font-bold text-[#F7F1E3]">سجل تغييرات الظهور</Text>
      {audit.isLoading ? <ActivityIndicator color="#D7A948" /> : audit.isError ? <Text className="text-right text-xs text-[#FF7D8D]">تعذر تحميل سجل التدقيق.</Text> : audit.data?.length ? audit.data.map((entry) => {
        const label = UI_BUTTONS[entry.surface].find((button) => button.id === entry.buttonId)?.label ?? entry.buttonId;
        return <View key={entry.id} className="mb-2 rounded-xl border border-[#273548] bg-[#101720] p-3">
          <Text className="text-right text-sm font-semibold text-[#F7F1E3]">{auditActionLabel(entry.action)} «{label}» — {SURFACE_LABELS[entry.surface]}</Text>
          <Text className="mt-1 text-right text-xs text-[#9BA8B8]">المسؤول: {entry.actorName} · {formatEgyptDateTime(entry.createdAt, "وقت غير متاح")}</Text>
          <Text className="mt-1 text-right text-xs text-[#9BA8B8]">{entry.targetUserId == null ? "النطاق: جميع المستخدمين" : `العميل: ${entry.targetName || entry.targetCustomerId || entry.targetUserId}`}</Text>
          {entry.reason ? <Text className="mt-1 text-right text-xs text-[#D7A948]">السبب: {entry.reason}</Text> : null}
        </View>;
      }) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد تغييرات مسجلة حتى الآن.</Text>}
    </Card>
  </View>;
}
