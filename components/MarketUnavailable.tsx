import { Text, View } from "react-native";
import { Screen } from "@/components/atheer-ui";

export function MarketUnavailable({ title = "الأسواق" }: { title?: string }) {
  return <Screen title={title}><View className="flex-1 items-center justify-center"><Text className="text-base font-bold text-[#D7A948]">غير متاح الان</Text></View></Screen>;
}
