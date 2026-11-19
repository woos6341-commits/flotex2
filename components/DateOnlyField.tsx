import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import DateOnlyWheelPicker from "./DateOnlyWheelPicker";

type Props = { value: string; onChange: (value: string) => void };

const inputStyle = {
  width: "100%" as const,
  minHeight: 52,
  justifyContent: "center" as const,
  borderWidth: 1,
  borderColor: "#273548",
  borderRadius: 14,
  backgroundColor: "#0B1018",
  paddingHorizontal: 14,
};

export function DateOnlyField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <View className="mt-4">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-[#C7B98D]" style={{ textAlign: "right" }}>تاريخ الميلاد</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="اختيار تاريخ الميلاد"
        accessibilityHint="يفتح منتقي التاريخ. لا يمكن اختيار تاريخ مستقبلي."
        onPress={() => setOpen(true)}
        style={inputStyle}
      >
        <Text style={{ color: value ? "#F7F1E3" : "#657286", textAlign: "right", writingDirection: "ltr", fontSize: 16 }}>
          {value || "اختر تاريخ الميلاد"}
        </Text>
      </Pressable>
    </View>
    {open ? (
      <DateOnlyWheelPicker
        visible={open}
        value={value || undefined}
        onConfirm={(next) => { onChange(next); setOpen(false); }}
        onCancel={() => setOpen(false)}
      />
    ) : null}
  </>;
}
