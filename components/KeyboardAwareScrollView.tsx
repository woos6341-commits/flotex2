import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, useWindowDimensions, type NativeMethods, type ScrollViewProps } from "react-native";
import { getFocusedScrollOffset, getKeyboardOverlap } from "@/shared/keyboard-geometry";
import { getKeyboardFocusState, measureContainedInput, subscribeKeyboardFocus, type KeyboardFocusState } from "@/lib/keyboard-focus";

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /** Space between the active field and keyboard/viewport edge, only when revealing. */
  keyboardGap?: number;
  keyboardAware?: boolean;
}

/** Drop-in vertical ScrollView. Do not wrap it in KeyboardAvoidingView or another
 * keyboard-insetting scroll view. Each native Modal needs its own instance.
 * Existing content styles, buttons and ref methods are unchanged at rest.
 */
export const KeyboardAwareScrollView = forwardRef<ScrollView, KeyboardAwareScrollViewProps>(function KeyboardAwareScrollView({
  children, contentContainerStyle, keyboardGap = 12, keyboardAware = true,
  horizontal, keyboardShouldPersistTaps = "handled",
  keyboardDismissMode = Platform.OS === "ios" ? "interactive" : "on-drag",
  onFocus, onLayout, onScroll, onScrollBeginDrag, onContentSizeChange,
  scrollEventThrottle = 16, ...props
}, forwardedRef) {
  const scrollRef = useRef<ScrollView>(null);
  useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollView);
  const enabled = keyboardAware && !horizontal;
  const { width, height } = useWindowDimensions();
  const [keyboardSpace, setKeyboardSpace] = useState(0);
  const state = useRef<KeyboardFocusState>(getKeyboardFocusState());
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const manualScroll = useRef(false);
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const gap = Math.max(0, keyboardGap);

  const cancelReveal = useCallback(() => {
    generation.current += 1;
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const reveal = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll || !enabled || manualScroll.current) return;
    const currentGeneration = generation.current;
    const snapshot = state.current;
    const nativeScroll = scroll.getNativeScrollRef() as NativeMethods | null;
    // RN 0.86 and RN Web both expose this method; RN's .d.ts omits it.
    const content = (scroll as ScrollView & {
      getInnerViewRef(): ReturnType<ScrollView["getNativeScrollRef"]>;
    }).getInnerViewRef();
    if (!nativeScroll || !content) return;
    nativeScroll.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      if (!mounted.current || currentGeneration !== generation.current || measuredHeight <= 0) return;
      const rect = { x, y, width: measuredWidth, height: measuredHeight };
      // No full keyboard-height inset: resize, safe area and tab bar are already
      // represented by the measured viewport. Disable RN automatic keyboard insets below.
      const overlap = getKeyboardOverlap(rect, snapshot.keyboard);
      const extra = snapshot.keyboard ? overlap + gap : 0;
      setKeyboardSpace((previous) => Math.abs(previous - extra) > 1 ? extra : previous);
      if (!snapshot.input) return;
      measureContainedInput(snapshot.input, content, (inputRect) => {
        if (!mounted.current || manualScroll.current || currentGeneration !== generation.current || snapshot.input !== state.current.input) return;
        const target = getFocusedScrollOffset({ viewport: rect, input: inputRect, keyboard: snapshot.keyboard,
          scrollY: scrollY.current, contentHeight: contentHeight.current, gap });
        if (Math.abs(target - scrollY.current) > 1) scroll.scrollTo({ y: target, animated: true });
      });
    });
  }, [enabled, gap]);

  const scheduleReveal = useCallback(() => {
    cancelReveal();
    if (!enabled || manualScroll.current) return;
    // Re-measure through native keyboard animation and the subsequent Android
    // resize/content-size pass. Cancellable: never fight a user's drag.
    timers.current = [0, 80, 180, 340].map((delay) => setTimeout(reveal, delay));
  }, [cancelReveal, enabled, reveal]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) { setKeyboardSpace(0); return; }
    const unsubscribe = subscribeKeyboardFocus((next) => {
      const previous = state.current;
      state.current = next;
      if (next.input !== previous.input || next.keyboard !== previous.keyboard) manualScroll.current = false;
      if (!next.keyboard) {
        // Android Back can hide the keyboard without blurring the TextInput.
        // The ensuing resize must not pull the page back to that old field.
        manualScroll.current = true;
        setKeyboardSpace(0);
        cancelReveal();
        return;
      }
      scheduleReveal();
    });
    return () => { mounted.current = false; unsubscribe(); cancelReveal(); };
  }, [enabled, cancelReveal, scheduleReveal]);

  useEffect(() => { scheduleReveal(); }, [width, height, scheduleReveal]);

  const originalStyle = StyleSheet.flatten(contentContainerStyle);
  const originalBottom = originalStyle?.paddingBottom ?? originalStyle?.paddingVertical ?? originalStyle?.padding ?? 0;
  const adjustedContentStyle = keyboardSpace > 0
    ? [contentContainerStyle, { paddingBottom: (typeof originalBottom === "number" ? originalBottom : 0) + keyboardSpace }]
    : contentContainerStyle;

  return <ScrollView {...props} ref={scrollRef} horizontal={horizontal}
    contentContainerStyle={adjustedContentStyle}
    automaticallyAdjustKeyboardInsets={false}
    keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    keyboardDismissMode={keyboardDismissMode}
    scrollEventThrottle={scrollEventThrottle}
    onFocus={(event) => {
      onFocus?.(event);
      manualScroll.current = false;
      state.current = getKeyboardFocusState();
      scheduleReveal();
    }}
    onLayout={(event) => { onLayout?.(event); scheduleReveal(); }}
    onContentSizeChange={(contentWidth, measuredHeight) => {
      contentHeight.current = measuredHeight;
      onContentSizeChange?.(contentWidth, measuredHeight);
      if (state.current.input) scheduleReveal();
    }}
    onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}
    onScrollBeginDrag={(event) => {
      manualScroll.current = true;
      cancelReveal();
      onScrollBeginDrag?.(event);
    }}
  >{children}</ScrollView>;
});
