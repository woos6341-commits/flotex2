import { forwardRef } from "react";
import { View } from "react-native";
import ViewShot, { captureRef } from "react-native-view-shot";
import type { ViewProps } from "react-native";

type CaptureProps = ViewProps & { options?: Record<string, unknown> };

export const InvoiceCapture = forwardRef<any, CaptureProps>(({ options, ...props }, ref) => (
  <ViewShot ref={ref} options={options as any} {...props} />
));
InvoiceCapture.displayName = "InvoiceCapture";

export async function captureInvoiceRef(ref: unknown, options: Record<string, unknown>) {
  return captureRef(ref as any, options as any);
}
