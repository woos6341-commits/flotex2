import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
import { useRouter } from "expo-router";
import { Card, EmptyState, Metric, Screen, formatMoney } from "@/components/atheer-ui";
import { TransactionRow } from "@/components/TransactionRow";
import { LoginPanel } from "@/components/LoginPanel";
import { VerifiedName } from "@/components/VerifiedName";
import { useAuth } from "@/hooks/use-auth";
import { trpc } from "@/lib/trpc";
import { getHomeDisplayName, getHomeVerificationNotice, HOME_QUICK_ACTIONS, type HomeQuickAction } from "@/shared/home-dashboard";
import { DEFAULT_HOME_ACTION_ORDER, reorderHomeQuickActions } from "@/shared/home-action-order";
import { isUiButtonVisible } from "@/shared/ui-button-visibility";
import { TransactionBell } from "@/components/TransactionBell";
import { ButtonLayoutCanvas } from "@/components/ButtonLayoutCanvas";
import { showFinancialMessage } from "@/lib/financial-feedback";

const GOLD = "#D7A948";
const MUTED = "#9BA8B8";
const RED = "#FF7D8D";

export default function HomeScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const isCustomer = Boolean(user && user.role !== "admin");
  const homeActionOrder = trpc.homeActionOrder.get.useQuery(undefined, { refetchInterval: 30000, refetchOnWindowFocus: true });
  const buttonLayout = trpc.buttonLayout.get.useQuery({ surface: "home" }, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true });
  const uiButtonVisibility = trpc.uiButtonVisibility.mine.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 10000, refetchOnWindowFocus: true, retry: false });
  const serviceControls = trpc.serviceControls.useQuery(undefined, { enabled: isCustomer, refetchInterval: 5000, refetchOnWindowFocus: true, retry: false });
  const portfolio = trpc.portfolio.get.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  const showButton = (buttonId: string) => isUiButtonVisible(uiButtonVisibility.data, "home", buttonId);
  const accountVerification = trpc.accountVerification.status.useQuery(undefined, {
    enabled: isCustomer,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });

  if (loading) {
    return <View style={{ flex: 1, width: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#0B1018" }}><ActivityIndicator color={GOLD} /></View>;
  }
  if (!user) {
    return <Screen><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets style={{ width: "100%", flex: 1 }} contentContainerStyle={{ width: "100%", flexGrow: 1, alignItems: "center", paddingTop: 32, paddingBottom: 120 }}><LoginPanel /></ScrollView></Screen>;
  }

  const wallet = portfolio.data?.wallet;
  const profitLoss = Number(wallet?.profitLoss ?? 0);
  const profitLossColor = profitLoss > 0 ? "#62D8AD" : profitLoss < 0 ? RED : MUTED;
  const displayName = getHomeDisplayName(user);
  const isVerified = accountVerification.data?.status === "approved";
  const verificationNotice = isCustomer
    ? getHomeVerificationNotice(accountVerification.data?.status, accountVerification.data?.rejectionReason)
    : null;
  const homeActions = reorderHomeQuickActions(
    HOME_QUICK_ACTIONS,
    uiButtonVisibility.data?.homeActionOrder ?? homeActionOrder.data ?? DEFAULT_HOME_ACTION_ORDER,
  ).filter((action) => showButton(action.id));
  const openService = (actionId: string, route: string) => {
    const serviceId = actionId === "externalTransfers" ? "external_transfer" : actionId === "gameTopup" ? "game_topup" : actionId === "paymentMethods" ? null : actionId;
    if (serviceId && serviceControls.data && serviceControls.data[serviceId as keyof typeof serviceControls.data] === false) {
      showFinancialMessage("الخدمة متوقفة", "هذه الخدمة غير متاحة حالياً، يرجى المحاولة لاحقاً");
      return;
    }
    router.push(route as never);
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 124 }}>
        <View className="mb-5 flex-row items-center justify-between">
          <View className="min-w-0 flex-1">
            <Text className="text-sm text-[#A7ADB7]" style={{ textAlign: "left" }}>صباح الخير،</Text>
            <View className="mt-1 flex-row items-center gap-2">
              {showButton("support") && !buttonLayout.data ? <Pressable
                accessibilityRole="button"
                accessibilityLabel="فتح دردشة خدمة العملاء"
                onPress={() => openService("support", "/support")}
                style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 11, borderWidth: 1, borderColor: "#D7A94855", backgroundColor: "#D7A94818", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
              >
                <Ionicons name="headset-outline" size={17} color={GOLD} />
              </Pressable> : <View style={{ width: 32, height: 32 }} />}
              <VerifiedName
                name={displayName}
                verified={isVerified}
                className="min-w-0 flex-1 justify-start"
                nameClassName="text-xl font-bold text-[#F4EFE5]"
              />
              <TransactionBell />
            </View>
          </View>
          <View className="ml-3 h-14 w-14 items-center justify-center rounded-full border border-[#E6CB8E]/40 bg-[#D7A948]" accessibilityLabel="شعار Flotex">
            <Text className="text-3xl font-black text-[#11151B]">F</Text>
          </View>
        </View>

        {isCustomer && accountVerification.isError ? (
          <VerificationNoticeCard
            title="تعذر تحميل حالة التوثيق"
            message="أعد المحاولة للتحقق من حالة طلبك."
            actionLabel={showButton("verifyAccount") ? "إعادة المحاولة" : undefined}
            actionVisible={showButton("verifyAccount")}
            tone="gold"
            onPress={showButton("verifyAccount") ? () => { void accountVerification.refetch(); } : undefined}
          />
        ) : verificationNotice ? (
          <VerificationNoticeCard
            title={verificationNotice.title}
            message={verificationNotice.message}
            actionLabel={verificationNotice.action && showButton("verifyAccount") ? verificationNotice.action === "reapply" ? "إعادة التقديم" : "ابدأ التوثيق" : undefined}
            actionVisible={showButton("verifyAccount")}
            tone={verificationNotice.tone}
            onPress={verificationNotice.action && showButton("verifyAccount") ? () => router.push("/account-verification") : undefined}
          />
        ) : null}

        <Card className="mt-1 overflow-hidden border-[#665536] bg-[#0F141C] p-5">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-medium text-[#D6C79E]" style={{ textAlign: "left" }}>صافي رصيد المحفظة</Text>
              <Text className="mt-3 text-4xl font-bold tracking-tight text-[#F4EFE5]" style={{ textAlign: "left"}}>{wallet ? formatMoney(wallet.balance) : "—"}</Text>
            </View>
            <View className="ml-3 h-14 w-14 items-center justify-center rounded-2xl border border-[#6C5938] bg-[#D7A948]/10">
              <Ionicons name="wallet-outline" size={31} color={GOLD} />
            </View>
          </View>
          <View className="mt-5 flex-row items-center justify-between border-t border-[#2A3039] pt-3">
            <View className="flex-row items-center gap-1.5">
              <Ionicons name={profitLoss < 0 ? "trending-down" : "trending-up"} size={17} color={profitLossColor} />
              <Text className="text-sm font-semibold" style={{ color: profitLossColor }}>{profitLoss > 0 ? "+" : ""}{wallet ? formatMoney(wallet.profitLoss) : "—"}</Text>
            </View>
            <Text className="text-xs text-[#A7ADB7]">{portfolio.isError ? "تعذر تحديث المحفظة" : portfolio.isFetching && !portfolio.dataUpdatedAt ? "جارٍ تحميل المحفظة" : portfolio.dataUpdatedAt ? `آخر تحديث: ${new Date(portfolio.dataUpdatedAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}` : "بانتظار بيانات المحفظة"}</Text>
          </View>
          {portfolio.isError && showButton("refreshPortfolio") ? (
            <Pressable accessibilityRole="button" onPress={() => { void portfolio.refetch(); }} className="mt-3 rounded-xl border border-[#5A4829] px-3 py-2">
              <Text className="text-xs text-[#D6C79E]" style={{ textAlign: "right" }}>تعذر تحديث الرصيد — اضغط لإعادة المحاولة</Text>
            </Pressable>
          ) : null}
        </Card>

        <View className="mt-4 flex-row flex-wrap gap-3">
          <Metric label="المتاح" value={portfolio.data ? formatMoney(portfolio.data.available.available) : "—"} icon="shield-checkmark-outline" tone="green" />
          <Metric label="الأرباح والخسائر" value={wallet ? formatMoney(wallet.profitLoss) : "—"} icon="analytics-outline" tone="green" />
          <Metric label="مبلغ الإدخار" value={portfolio.data ? formatMoney(portfolio.data.savings.activePrincipal) : "—"} icon="pie-chart-outline" />
          <Metric label="المبلغ المحجوز" value={portfolio.data ? formatMoney(portfolio.data.available.reservedTotal) : "—"} icon="hourglass-outline" />
        </View>

        <View className="mb-3 mt-6 flex-row items-center justify-between">
          <Text className="text-lg font-bold text-[#F4EFE5]" style={{ textAlign: "left" }}>الخدمات</Text>
          <Text className="text-xs text-[#8D929B]" style={{ textAlign: "right" }}>إدارة محفظتك بسهولة</Text>
        </View>
        {buttonLayout.data ? <ButtonLayoutCanvas surface="home" layout={buttonLayout.data} visible={showButton} onPress={(action) => openService(action.id, action.route)} /> : <View className="gap-2.5">
          {Array.from({ length: Math.ceil(homeActions.length / 3) }, (_, index) => homeActions.slice(index * 3, index * 3 + 3)).map((row, index) => (
            <View key={`quick-row-${index}`} className="flex-row gap-2.5">
              {row.map((action) => (
                  <HomeActionCard key={action.id} action={action} onPress={() => openService(action.id, action.route)} />
              ))}
            </View>
          ))}
        </View>}

        <View className="mb-3 mt-7 flex-row items-center justify-between">
          <Text className="text-lg font-bold text-[#F4EFE5]" style={{ textAlign: "left" }}>آخر النشاطات</Text>
          {showButton("viewActivity") ? <Pressable accessibilityRole="button" accessibilityLabel="عرض سجل المعاملات بالكامل" onPress={() => router.push("/(tabs)/activity")} hitSlop={10}>
            <Text className="text-sm font-semibold text-[#D7B76B]">عرض الكل  ›</Text>
          </Pressable> : null}
        </View>
        {portfolio.isLoading ? (
          <ActivityIndicator color={GOLD} />
        ) : portfolio.data?.activity?.length ? (
          portfolio.data.activity.slice(0, 4).map((item) => <TransactionRow key={item.id} transaction={item} compact />)
        ) : (
          <EmptyState title="لا توجد معاملات بعد" text="ستظهر هنا حركات محفظتك بعد تنفيذها." />
        )}
      </ScrollView>
    </Screen>
  );
}

function HomeActionCard({ action, onPress }: { action: HomeQuickAction; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 92,
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingHorizontal: 5,
        paddingVertical: 12,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: pressed ? "#8B7446" : "#343B46",
        backgroundColor: pressed ? "#1B2028" : "#10151D",
        shadowColor: GOLD,
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      })}
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl border border-[#6B5939] bg-[#D7A948]/10">
        <Ionicons name={action.icon} size={23} color="#C8AE78" />
      </View>
      <Text numberOfLines={2} className="text-center text-xs font-semibold text-[#E6E0D5]">{action.label}</Text>
    </Pressable>
  );
}

function VerificationNoticeCard({
  title,
  message,
  actionLabel,
  actionVisible = true,
  tone,
  onPress,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  actionVisible?: boolean;
  tone: "gold" | "red" | "muted";
  onPress?: () => void;
}) {
  const accent = tone === "red" ? RED : tone === "muted" ? MUTED : GOLD;
  const content = (
    <View className="flex-row items-center rounded-2xl border border-[#51452E] bg-[#111720] p-3.5">
      <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-[#D7A948]/10">
        <Ionicons name={tone === "red" ? "alert-circle-outline" : tone === "muted" ? "time-outline" : "shield-checkmark-outline"} size={21} color={accent} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-bold" style={{ color: accent, textAlign: "right" }}>{title}</Text>
        <Text className="mt-1 text-xs leading-5 text-[#A7ADB7]" style={{ textAlign: "right" }}>{message}</Text>
        {actionVisible && actionLabel ? <Text className="mt-2 text-xs font-bold text-[#D7B76B]" style={{ textAlign: "right" }}>{actionLabel}  ›</Text> : null}
      </View>
    </View>
  );

  return onPress && actionVisible ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${actionLabel ?? ""}`} onPress={onPress} className="mb-4">
      {content}
    </Pressable>
  ) : (
    <View className="mb-4" accessibilityLabel={title}>{content}</View>
  );
}
