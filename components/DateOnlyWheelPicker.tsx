import React, { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { getDaysInMonth, getTodayDateOnly, isDateOnlyNotFuture, isValidDateOnly } from "../shared/date-only";

type Props = {
  visible: boolean;
  value?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const pad = (value: number) => String(value).padStart(2, "0");
function parts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function Wheel({ label, values, selected, format, onSelect }: { label: string; values: number[]; selected: number; format?: (value: number) => string; onSelect: (value: number) => void }) {
  return <View style={{ flex: 1, minWidth: 0 }}>
    <Text style={{ color: "#9BA8B8", textAlign: "center", fontSize: 12, marginBottom: 8 }}>{label}</Text>
    <FlatList
      data={values}
      keyExtractor={(item) => String(item)}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      style={{ height: 180, borderRadius: 14, backgroundColor: "#0B1018" }}
      contentContainerStyle={{ paddingVertical: 48 }}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item === selected }} onPress={() => onSelect(item)} style={{ height: 42, alignItems: "center", justifyContent: "center", borderTopWidth: item === selected ? 1 : 0, borderBottomWidth: item === selected ? 1 : 0, borderColor: "#D7A948" }}>
        <Text style={{ color: item === selected ? "#D7A948" : "#9BA8B8", fontSize: item === selected ? 18 : 16, fontWeight: item === selected ? "700" : "400" }}>{format ? format(item) : item}</Text>
      </Pressable>}
    />
  </View>;
}

/** Three native FlatList wheels; emits only a committed YYYY-MM-DD value. */
export default function DateOnlyWheelPicker({ visible, value, onConfirm, onCancel }: Props) {
  const today = getTodayDateOnly();
  const todayParts = parts(today);
  const initial = value && isDateOnlyNotFuture(value, today) ? value : `${Math.max(1900, todayParts.year - 20)}-${pad(todayParts.month)}-${pad(Math.min(todayParts.day, getDaysInMonth(Math.max(1900, todayParts.year - 20), todayParts.month)))}`;
  const [draft, setDraft] = useState(initial);
  const current = parts(draft);
  const years = Array.from({ length: todayParts.year - 1900 + 1 }, (_, index) => todayParts.year - index);
  const months = current.year === todayParts.year ? Array.from({ length: todayParts.month }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i + 1);
  const maxDay = Math.min(getDaysInMonth(current.year, current.month), current.year === todayParts.year && current.month === todayParts.month ? todayParts.day : 31);
  const days = Array.from({ length: Math.max(0, maxDay) }, (_, i) => i + 1);
  const update = (year: number, month: number, day: number) => {
    const boundedMonth = Math.min(month, year === todayParts.year ? todayParts.month : 12);
    const max = Math.min(getDaysInMonth(year, boundedMonth), year === todayParts.year && boundedMonth === todayParts.month ? todayParts.day : 31);
    const next = `${String(year).padStart(4, "0")}-${pad(boundedMonth)}-${pad(Math.min(day, max))}`;
    setDraft(next);
  };
  const committedDateValid = isValidDateOnly(draft) && isDateOnlyNotFuture(draft, today);

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
    <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0009" }}>
      <View style={{ backgroundColor: "#111722", padding: 20, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
        <Text accessibilityRole="header" style={{ color: "#F7F1E3", fontSize: 20, fontWeight: "700", textAlign: "right", marginBottom: 6 }}>تاريخ الميلاد</Text>
        <Text style={{ color: "#9BA8B8", textAlign: "right", marginBottom: 18 }}>اختر اليوم والشهر والسنة، ثم أكّد التاريخ</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Wheel label="اليوم" values={days} selected={current.day} onSelect={(day) => update(current.year, current.month, day)} />
          <Wheel label="الشهر" values={months} selected={current.month} format={(month) => MONTHS[month - 1]} onSelect={(month) => update(current.year, month, current.day)} />
          <Wheel label="السنة" values={years} selected={current.year} onSelect={(year) => update(year, current.month, current.day)} />
        </View>
        <Text accessibilityLiveRegion="polite" style={{ color: "#D7A948", textAlign: "center", fontSize: 16, fontWeight: "700", marginTop: 16 }}>{draft}</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <Pressable accessibilityRole="button" onPress={onCancel} style={{ flex: 1, alignItems: "center", paddingVertical: 14, borderWidth: 1, borderColor: "#273548", borderRadius: 14 }}><Text style={{ color: "#9BA8B8", fontWeight: "600" }}>تراجع</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={!committedDateValid} onPress={() => onConfirm(draft)} style={{ flex: 1, alignItems: "center", paddingVertical: 14, backgroundColor: committedDateValid ? "#D7A948" : "#657286", borderRadius: 14 }}><Text style={{ color: "#0B1018", fontWeight: "700" }}>تأكيد التاريخ</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}
