import { Platform } from "react-native";

export async function copyText(value: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const Clipboard = await import("expo-clipboard");
  await Clipboard.setStringAsync(value);
}
