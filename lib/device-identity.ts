import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
const DEVICE_ID_KEY = "flotex.device.id";
function randomId() { return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`; }
export async function getDeviceIdentity() {
  let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) { deviceId = randomId(); await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId); }
  const deviceName = Platform.OS === "web" ? "متصفح الويب" : `جهاز ${Platform.OS}`;
  return { deviceId, deviceName, platform: Platform.OS };
}
