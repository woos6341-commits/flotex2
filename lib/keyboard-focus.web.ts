import type { NativeMethods } from "react-native";
import type { KeyboardRect } from "../shared/keyboard-geometry";

export type FocusedInput = NativeMethods;
export interface KeyboardFocusState {
  keyboard: KeyboardRect | null;
  input: FocusedInput | null;
}
export type KeyboardFocusListener = (state: KeyboardFocusState) => void;

export function getFocusedInput(): FocusedInput | null {
  if (typeof document === "undefined") return null;
  const input = document.activeElement;
  return input && (input.tagName === "INPUT" || input.tagName === "TEXTAREA") ? input as unknown as FocusedInput : null;
}

export function getKeyboardFocusState(): KeyboardFocusState {
  if (typeof window === "undefined") return { keyboard: null, input: null };
  const viewport = window.visualViewport;
  const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const covered = window.innerHeight - bottom;
  return { input: getFocusedInput(), keyboard: covered > 80 ? { x: 0, y: bottom, width: window.innerWidth, height: covered } : null };
}

export function subscribeKeyboardFocus(listener: KeyboardFocusListener): () => void {
  if (typeof window === "undefined") return () => {};
  const emit = () => listener(getKeyboardFocusState());
  document.addEventListener("focusin", emit);
  document.addEventListener("focusout", emit);
  window.addEventListener("resize", emit);
  window.visualViewport?.addEventListener("resize", emit);
  window.visualViewport?.addEventListener("scroll", emit);
  emit();
  return () => {
    document.removeEventListener("focusin", emit);
    document.removeEventListener("focusout", emit);
    window.removeEventListener("resize", emit);
    window.visualViewport?.removeEventListener("resize", emit);
    window.visualViewport?.removeEventListener("scroll", emit);
  };
}

export function measureContainedInput(input: FocusedInput, content: NativeMethods, callback: (rect: KeyboardRect) => void): void {
  const element = input as unknown as HTMLElement;
  const container = content as unknown as HTMLElement;
  if (!container?.contains?.(element)) return;
  const { x, y, width, height } = element.getBoundingClientRect();
  if (width > 0 && height > 0) callback({ x, y, width, height });
}
