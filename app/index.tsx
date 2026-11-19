import Constants from "expo-constants";
import { Redirect } from "expo-router";

export default function EntryRoute() {
  const mode = Constants.expoConfig?.extra?.appMode;
  return <Redirect href={mode === "control" ? "/control" : "/(tabs)"} />;
}
