import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { getTransactionDisplay, type TransactionDisplayInput } from "@/lib/transaction-display";

export type TransactionRowProps = {
  transaction: TransactionDisplayInput;
  compact?: boolean;
};

function statusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return ({
    pending: "قيد المراجعة",
    approved: "مقبولة",
    completed: "مكتملة",
    rejected: "مرفوضة",
    cancelled: "ملغاة",
  } as Record<string, string>)[status] ?? status;
}

function isRefund(transaction: TransactionDisplayInput) {
  return transaction.type === "savings_refund" || transaction.source === "savings_refund";
}

export function TransactionRow({ transaction, compact = false }: TransactionRowProps) {
  const display = getTransactionDisplay(transaction);
  const icon = transaction.status === "rejected" ? "close-circle-outline" : isRefund(transaction) ? "refresh-outline" : display.direction === "debit" ? "arrow-down-outline" : "arrow-up-outline";
  const iconSize = compact ? 16 : 18;
  const referenceLine = !compact ? [statusLabel(transaction.status), transaction.createdAt ? new Date(transaction.createdAt).toLocaleString("ar-EG") : null].filter(Boolean).join(" · ") : "";

  return (
    <View className={`mb-2 flex-row items-center justify-between rounded-2xl border border-[#273548] bg-[#121B28] ${compact ? "p-3" : "p-4"}`}>
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        <View className={`items-center justify-center rounded-xl bg-[#D7A94818] ${compact ? "h-8 w-8" : "h-9 w-9"}`}>
          <Ionicons name={icon} size={iconSize} color={display.color} />
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className={`font-semibold text-[#F7F1E3] ${compact ? "text-sm" : ""}`}>
            {display.title}
          </Text>
          <Text numberOfLines={1} className="mt-1 text-xs text-[#9BA8B8]">
            {display.description}
          </Text>
          {referenceLine ? <Text numberOfLines={1} className="mt-1 text-[10px] text-[#657286]">{referenceLine}</Text> : null}
        </View>
      </View>
      <Text className={`ml-3 font-bold ${compact ? "text-sm" : "text-base"}`} style={{ color: display.color, writingDirection: "ltr", textAlign: "left" }}>
        {display.amountText}
      </Text>
    </View>
  );
}
