import { Text, View } from "react-native";

export function VerifiedName({
  name,
  verified,
  nameClassName = "text-sm font-semibold text-[#F7F1E3]",
  className = "",
}: {
  name: string;
  verified: boolean;
  nameClassName?: string;
  className?: string;
}) {
  return (
    <View className={`flex-row flex-wrap items-center gap-1.5 ${className}`}>
      <Text className={nameClassName} style={{ textAlign: "right" }}>{name}</Text>
      {verified ? (
        <View accessibilityLabel="حساب موثّق" className="flex-row items-center gap-1 rounded-full border border-[#47D7A5]/40 bg-[#47D7A5]/10 px-2 py-0.5">
          <Text className="text-xs font-black text-[#47D7A5]">✓</Text>
          <Text className="text-[10px] font-semibold text-[#47D7A5]">حساب موثّق</Text>
        </View>
      ) : null}
    </View>
  );
}
