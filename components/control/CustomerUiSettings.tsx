import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Card, Pill } from "@/components/atheer-ui";
import { trpc } from "@/lib/trpc";
import { DEFAULT_HOME_ACTION_ORDER, type HomeActionOrderId } from "@/shared/home-action-order";
import { formatEgyptDateTime, UI_BUTTONS, type UiButtonOverrideMode, type UiSurface } from "@/shared/ui-button-visibility";

const SURFACE_LABELS: Record<UiSurface, string> = { home: "الواجهة الرئيسية", wallet: "صفحة المحفظة" };
const HOME_ACTION_LABELS: Record<HomeActionOrderId, string> = { deposit: "الإيداع", transfer: "إرسال الأموال", withdrawal: "السحب", savings: "الادخار" };
const auditActionLabel = (action: "shown" | "hidden" | "inherit") => action === "shown" ? "إظهار فردي" : action === "hidden" ? "إخفاء فردي" : "استعادة إعداد المجموعة";

export function CustomerUiSettings({ userId }: { userId: number }) {
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const settings = trpc.admin.uiButtonVisibility.customer.useQuery({ userId }, { refetchInterval: 10_000, refetchOnWindowFocus: true });
  const homeOrder = trpc.admin.customerHomeActionOrder.get.useQuery({ userId }, { refetchInterval: 10_000, refetchOnWindowFocus: true });
  const globalLayout = trpc.buttonLayout.get.useQuery({ surface: "home" }, { refetchInterval: 10_000, refetchOnWindowFocus: true });
  const audit = trpc.admin.uiButtonVisibility.audit.useQuery({ targetUserId: userId, limit: 20 }, { refetchInterval: 10_000, refetchOnWindowFocus: true });
  const update = trpc.admin.uiButtonVisibility.setCustomer.useMutation({ onSuccess: () => {
    setReason("");
    void utils.admin.uiButtonVisibility.customer.invalidate({ userId });
    void utils.admin.uiButtonVisibility.audit.invalidate({ targetUserId: userId, limit: 20 });
  } });
  const saveHomeOrder = trpc.admin.customerHomeActionOrder.set.useMutation({ onSuccess: () => void utils.admin.customerHomeActionOrder.get.invalidate({ userId }) });
  const resetHomeOrder = trpc.admin.customerHomeActionOrder.reset.useMutation({ onSuccess: () => void utils.admin.customerHomeActionOrder.get.invalidate({ userId }) });
  const change = (surface: UiSurface, buttonId: string, mode: UiButtonOverrideMode) => update.mutate({ userId, surface, buttonId, mode, reason: reason.trim() || undefined });
  const moveHomeAction = (index: number, direction: -1 | 1) => {
    const current = homeOrder.data?.order ?? DEFAULT_HOME_ACTION_ORDER;
    const target = index + direction;
    if (target < 0 || target >= current.length || saveHomeOrder.isPending || !homeOrder.data || !globalLayout.isSuccess || globalLayout.data) return;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    saveHomeOrder.mutate({ userId, order: next });
  };

  return <View>
    <Text className="mb-2 text-right text-xs leading-5 text-[#9BA8B8]">تحكم مستقل لهذا العميل فقط. «استخدام الإعداد العام» يلغي التجاوز الفردي، والإخفاء لا يحذف الميزة ولا يعطلها.</Text>
    <TextInput value={reason} onChangeText={setReason} maxLength={500} placeholder="سبب التغيير (اختياري — يسجل باسم المسؤول)" placeholderTextColor="#657286" className="mb-3 rounded-xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]" />
    <Card className="mb-3 border-[#5C4A28]">
      <View className="flex-row items-center justify-between gap-2">
        {homeOrder.data ? <Pill tone={homeOrder.data.inherited ? "muted" : "gold"}>{homeOrder.data.inherited ? "يرث الترتيب العام" : "ترتيب فردي"}</Pill> : null}
        <Text className="flex-1 text-right font-bold text-[#F7F1E3]">ترتيب الرئيسية لهذا العميل</Text>
      </View>
      <Text className="mt-1 text-right text-xs leading-5 text-[#9BA8B8]">يؤثر فقط على أزرار الإيداع والإرسال والسحب والادخار؛ تبقى بقية الخدمات في مواقعها الأصلية.</Text>
      {globalLayout.data ? <Text className="mt-2 text-right text-xs leading-5 text-[#D7A948]">التصميم العام الجديد مطبّق الآن ويتقدم على الترتيب الفردي القديم؛ سيعود الترتيب الفردي للعمل بعد إعادة التصميم العام للافتراضي.</Text> : globalLayout.isError ? <Text className="mt-2 text-right text-xs text-[#FF7D8D]">تعذر التحقق من التصميم العام، لذلك عُطّل تعديل الترتيب مؤقتاً.</Text> : null}
      {homeOrder.isLoading ? <ActivityIndicator className="mt-3" color="#D7A948" /> : homeOrder.isError ? <Text className="mt-2 text-right text-xs text-[#FF7D8D]">تعذر تحميل الترتيب الفردي.</Text> : homeOrder.data?.order.map((id, index) => <View key={id} className="mt-2 flex-row items-center rounded-xl border border-[#273548] bg-[#101720] p-2">
        <View className="flex-row gap-2">
          <Pressable accessibilityRole="button" accessibilityLabel={`تحريك ${HOME_ACTION_LABELS[id]} لأعلى`} disabled={index === 0 || saveHomeOrder.isPending || !globalLayout.isSuccess || Boolean(globalLayout.data)} onPress={() => moveHomeAction(index, -1)} className="rounded-lg border border-[#273548] px-3 py-2"><Text className="text-[#D7A948]">↑</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`تحريك ${HOME_ACTION_LABELS[id]} لأسفل`} disabled={index === homeOrder.data.order.length - 1 || saveHomeOrder.isPending || !globalLayout.isSuccess || Boolean(globalLayout.data)} onPress={() => moveHomeAction(index, 1)} className="rounded-lg border border-[#273548] px-3 py-2"><Text className="text-[#D7A948]">↓</Text></Pressable>
        </View>
        <Text className="mr-3 flex-1 text-right text-sm font-semibold text-[#F7F1E3]">{index + 1}. {HOME_ACTION_LABELS[id]}</Text>
      </View>)}
      {!homeOrder.data?.inherited ? <Pressable accessibilityRole="button" disabled={resetHomeOrder.isPending || saveHomeOrder.isPending || !globalLayout.isSuccess || Boolean(globalLayout.data)} onPress={() => resetHomeOrder.mutate({ userId })} className="mt-3 self-end rounded-lg border border-[#273548] px-3 py-2"><Text className="text-xs text-[#9BA8B8]">استخدام الترتيب العام</Text></Pressable> : null}
      {saveHomeOrder.isError || resetHomeOrder.isError ? <Text className="mt-2 text-right text-xs text-[#FF7D8D]">تعذر حفظ ترتيب الرئيسية.</Text> : null}
      {saveHomeOrder.isSuccess ? <Text className="mt-2 text-right text-xs text-[#62D8AD]">تم حفظ الترتيب الفردي لهذا العميل.</Text> : null}
    </Card>
    {settings.isLoading ? <ActivityIndicator color="#D7A948" /> : settings.isError ? <Text className="text-right text-xs text-[#FF7D8D]">تعذر تحميل إعدادات هذا العميل.</Text> : (["home", "wallet"] as const).map((surface) => <View key={surface} className="mb-3">
      <Text className="mb-2 text-right font-bold text-[#D7A948]">{SURFACE_LABELS[surface]}</Text>
      {UI_BUTTONS[surface].map((button) => {
        const saved = settings.data?.buttons.find((item) => item.surface === surface && item.buttonId === button.id);
        if (!saved) return null;
        const inherited = saved.overrideMode === "inherit";
        const status = inherited ? saved.visible ? "ظاهر حسب الإعداد العام" : "مخفي حسب الإعداد العام" : saved.overrideMode === "visible" ? "ظاهر لهذا العميل فقط" : "مخفي لهذا العميل فقط";
        return <Card key={`${surface}:${button.id}`} className="mb-2 border-[#273548]">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Pill tone={saved.visible ? "green" : "muted"}>{status}</Pill>
            <Text className="flex-1 text-right font-semibold text-[#F7F1E3]">{button.label}</Text>
          </View>
          {saved.reason ? <Text className="mt-2 text-right text-xs text-[#9BA8B8]">سبب الحالة: {saved.reason}</Text> : null}
          <View className="mt-3 flex-row flex-wrap justify-end gap-2">
            {!inherited ? <Pressable accessibilityRole="button" disabled={update.isPending} onPress={() => change(surface, button.id, "inherit")} className="rounded-lg border border-[#273548] px-3 py-2"><Text className="text-xs text-[#9BA8B8]">استخدام الإعداد العام</Text></Pressable> : null}
            <Pressable accessibilityRole="button" disabled={update.isPending || saved.overrideMode === "hidden"} onPress={() => change(surface, button.id, "hidden")} className="rounded-lg border border-[#7B3845] px-3 py-2"><Text className="text-xs text-[#FF9AA5]">إخفاء فردي</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={update.isPending || saved.overrideMode === "visible"} onPress={() => change(surface, button.id, "visible")} className="rounded-lg border border-[#5C4A28] px-3 py-2"><Text className="text-xs text-[#D7A948]">إظهار فردي</Text></Pressable>
          </View>
        </Card>;
      })}
    </View>)}
    {update.isError ? <Text className="mb-2 text-right text-xs text-[#FF7D8D]">تعذر حفظ التجاوز الفردي.</Text> : null}
    {update.isSuccess ? <Text className="mb-2 text-right text-xs text-[#62D8AD]">تم تسجيل التغيير؛ يظهر للمستخدم خلال ثوانٍ دون تحديث التطبيق.</Text> : null}
    <Card className="mt-1 border-[#5C4A28]">
      <Text className="mb-3 text-right font-bold text-[#F7F1E3]">سجل تغييرات هذا العميل</Text>
      {audit.isLoading ? <ActivityIndicator color="#D7A948" /> : audit.isError ? <Text className="text-right text-xs text-[#FF7D8D]">تعذر تحميل السجل.</Text> : audit.data?.length ? audit.data.map((entry) => {
        const label = UI_BUTTONS[entry.surface].find((button) => button.id === entry.buttonId)?.label ?? entry.buttonId;
        return <View key={entry.id} className="mb-2 rounded-xl border border-[#273548] bg-[#101720] p-3">
          <Text className="text-right text-sm font-semibold text-[#F7F1E3]">{auditActionLabel(entry.action)} «{label}» — {SURFACE_LABELS[entry.surface]}</Text>
          <Text className="mt-1 text-right text-xs text-[#9BA8B8]">المسؤول: {entry.actorName} · {formatEgyptDateTime(entry.createdAt, "وقت غير متاح")}</Text>
          {entry.reason ? <Text className="mt-1 text-right text-xs text-[#D7A948]">السبب: {entry.reason}</Text> : null}
        </View>;
      }) : <Text className="text-right text-xs text-[#9BA8B8]">لا توجد تغييرات فردية محفوظة.</Text>}
    </Card>
  </View>;
}
