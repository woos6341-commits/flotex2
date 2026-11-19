import { forwardRef } from "react";
import { View } from "react-native";
import type { ViewProps } from "react-native";

type CaptureProps = ViewProps & { options?: Record<string, unknown> };

export const InvoiceCapture = forwardRef<any, CaptureProps>(({ options: _options, ...props }, ref) => (
  <View ref={ref} {...props} />
));
InvoiceCapture.displayName = "InvoiceCapture";

export async function captureInvoiceRef(_ref: unknown, _options: Record<string, unknown>): Promise<string> {
  throw new Error("تصدير صورة الفاتورة متاح من تطبيق الهاتف.");
}
