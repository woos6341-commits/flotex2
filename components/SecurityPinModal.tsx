import { Modal, Pressable, Text, TextInput, View } from "react-native";

type Props = {
  visible: boolean;
  title?: string;
  description: string;
  value: string;
  error?: string;
  busy?: boolean;
  confirmLabel?: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SecurityPinModal({
  visible,
  title = "تأكيد العملية",
  description,
  value,
  error,
  busy = false,
  confirmLabel = "تأكيد",
  onChange,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={() => !busy && onCancel()}>
      <View className="flex-1 items-center justify-center bg-black/75 px-5">
        <View className="w-full max-w-[520px] rounded-3xl border border-[#D7A948] bg-[#121B28] p-5">
          <Text className="text-right text-xl font-extrabold text-[#F7F1E3]">{title}</Text>
          <Text className="mt-2 text-right text-sm leading-6 text-[#B7C0CC]">{description}</Text>
          <TextInput
            value={value}
            onChangeText={(next) => onChange(next.replace(/\D/g, "").slice(0, 4))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            placeholder="••••"
            placeholderTextColor="#657286"
            accessibilityLabel="رمز الأمان"
            className="mt-5 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-4 text-center text-2xl font-extrabold tracking-[10px] text-[#F7F1E3]"
          />
          {error ? <Text className="mt-3 text-right text-sm text-[#FF7D8D]">{error}</Text> : null}
          <View className="mt-5 flex-row-reverse gap-3">
            <Pressable disabled={busy} onPress={onCancel} className="flex-1 rounded-2xl border border-[#273548] px-4 py-4">
              <Text className="text-center font-bold text-[#B7C0CC]">إلغاء</Text>
            </Pressable>
            <Pressable disabled={busy || value.length !== 4} onPress={onConfirm} className="flex-1 rounded-2xl bg-[#D7A948] px-4 py-4 disabled:opacity-50">
              <Text className="text-center font-extrabold text-[#0B1018]">{busy ? "جارٍ التحقق..." : confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
