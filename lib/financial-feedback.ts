import { Alert, Platform } from "react-native";

export function showFinancialMessage(title: string, message?: string): void {
  if (Platform.OS === "web") {
    if (typeof globalThis.alert === "function") {
      globalThis.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

export function confirmFinancialAction(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof globalThis.confirm === "function" ? globalThis.confirm(`${title}\n\n${message}`) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "إلغاء", style: "cancel", onPress: () => resolve(false) },
      { text: "تأكيد", onPress: () => resolve(true) },
    ]);
  });
}
