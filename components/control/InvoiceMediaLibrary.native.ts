import * as MediaLibrary from "expo-media-library";

export async function saveInvoiceToLibrary(uri: string): Promise<boolean> {
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) return false;
  await MediaLibrary.saveToLibraryAsync(uri);
  return true;
}
