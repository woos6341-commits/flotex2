import { Dimensions, Keyboard, Platform, TextInput, type NativeMethods } from "react-native";
import type { KeyboardRect } from "../shared/keyboard-geometry";

export type FocusedInput = ReturnType<typeof TextInput.State.currentlyFocusedInput>;
export interface KeyboardFocusState {
  keyboard: KeyboardRect | null;
  input: FocusedInput | null;
}
export type KeyboardFocusListener = (state: KeyboardFocusState) => void;
const listeners = new Set<KeyboardFocusListener>();
let keyboard: KeyboardRect | null = null;
let lastInput: FocusedInput | null = null;
let focusTimer: ReturnType<typeof setInterval> | null = null;
let removeKeyboardListeners: (() => void) | null = null;

export function getFocusedInput(): FocusedInput | null {
  return TextInput.State.currentlyFocusedInput() ?? null;
}

export function getKeyboardFocusState(): KeyboardFocusState {
  return { keyboard, input: getFocusedInput() };
}

function emit() {
  lastInput = getFocusedInput();
  const state = { keyboard, input: lastInput };
  listeners.forEach((listener) => listener(state));
}

function updateFocusPolling() {
  if (keyboard && !focusTimer) {
    // Native focus usually bubbles to the scroll view. This single shared timer also
    // covers focus moved programmatically while the keyboard remains open, even if
    // a nested component stops event propagation. No periodic layout measurements.
    focusTimer = setInterval(() => {
      if (getFocusedInput() !== lastInput) emit();
    }, 100);
  } else if (!keyboard && focusTimer) {
    clearInterval(focusTimer);
    focusTimer = null;
  }
}

export function subscribeKeyboardFocus(listener: KeyboardFocusListener): () => void {
  listeners.add(listener);
  if (!removeKeyboardListeners) {
    const metrics = Keyboard.metrics();
    keyboard = metrics ? { x: metrics.screenX, y: metrics.screenY, width: metrics.width, height: metrics.height } : null;
    const show: Parameters<typeof Keyboard.addListener>[1] = (event) => {
      const rect = event.endCoordinates;
      // iOS also emits a change-frame event when the keyboard moves offscreen.
      keyboard = rect.height > 0 && rect.screenY < Dimensions.get("screen").height
        ? { x: rect.screenX, y: rect.screenY, width: rect.width, height: rect.height } : null;
      updateFocusPolling();
      emit();
    };
    const hide = () => { keyboard = null; updateFocusPolling(); emit(); };
    const subscriptions = [Keyboard.addListener("keyboardDidShow", show), Keyboard.addListener("keyboardDidHide", hide)];
    if (Platform.OS === "ios") {
      subscriptions.push(Keyboard.addListener("keyboardWillShow", show), Keyboard.addListener("keyboardWillChangeFrame", show), Keyboard.addListener("keyboardWillHide", hide));
    }
    removeKeyboardListeners = () => subscriptions.forEach((subscription) => subscription.remove());
    updateFocusPolling();
  }
  listener(getKeyboardFocusState());
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      removeKeyboardListeners?.();
      removeKeyboardListeners = null;
      if (focusTimer) clearInterval(focusTimer);
      focusTimer = null;
      keyboard = null;
      lastInput = null;
    }
  };
}

/** measureLayout requires an ancestor. A screen behind a native Modal must not
 * react to that modal's input; only the scroll view containing the input can scroll.
 */
export function measureContainedInput(input: FocusedInput, content: Parameters<NativeMethods["measureLayout"]>[0], callback: (rect: KeyboardRect) => void): void {
  try {
    input.measureLayout(content, () => {
      input.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) callback({ x, y, width, height });
      });
    }, () => { /* Input is outside this scroll view or has been unmounted. */ });
  } catch {
    // Focus can disappear between the keyboard event and async native measurement.
  }
}
