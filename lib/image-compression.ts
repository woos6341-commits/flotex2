import * as ImageManipulator from "expo-image-manipulator";
import type * as ImagePicker from "expo-image-picker";

export const MAX_CLIENT_IMAGE_BYTES = 1_200_000;
export type CompressedImage = {
  uri: string;
  data: string;
  mimeType: "image/jpeg";
  size: number;
  width: number;
  height: number;
};

export function base64ImageBytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

/** Keep full document edges and aspect ratio; avoid repeatedly decoding the full camera image. */
export async function compressImageForUpload(asset: ImagePicker.ImagePickerAsset): Promise<CompressedImage> {
  if (!asset.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
    throw new Error("تعذر قراءة الصورة. اختر صورة صالحة أو التقطها مرة أخرى.");
  }
  const attempts = [
    { maxDimension: 1600, compress: 0.78 },
    { maxDimension: 1400, compress: 0.68 },
    { maxDimension: 1200, compress: 0.58 },
    { maxDimension: 1050, compress: 0.48 },
    { maxDimension: 960, compress: 0.38 },
  ];
  let source = asset.uri;
  let width = asset.width;
  let height = asset.height;
  let lastSize = asset.fileSize ?? Number.POSITIVE_INFINITY;
  for (const attempt of attempts) {
    const context = ImageManipulator.ImageManipulator.manipulate(source);
    let rendered: ImageManipulator.ImageRef | undefined;
    try {
      if (Math.max(width, height) > attempt.maxDimension) {
        context.resize(width >= height ? { width: attempt.maxDimension } : { height: attempt.maxDimension });
      }
      rendered = await context.renderAsync();
      const result = await rendered.saveAsync({ compress: attempt.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      source = result.uri;
      width = result.width;
      height = result.height;
      if (!result.base64) continue;
      const data = result.base64;
      lastSize = base64ImageBytes(data);
      if (lastSize > 0 && lastSize <= MAX_CLIENT_IMAGE_BYTES) {
        return { uri: result.uri, data, mimeType: "image/jpeg", size: lastSize, width, height };
      }
    } finally {
      // Native shared objects otherwise retain decoded bitmaps until an unpredictable GC cycle.
      rendered?.release();
      context.release();
    }
  }
  throw new Error("تعذر ضغط الصورة إلى الحجم المسموح. التقط صورة بإضاءة جيدة وحاول مرة أخرى.");
}
