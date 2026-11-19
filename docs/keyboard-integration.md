# Shared keyboard integration

The shared `KeyboardAwareScrollView` is a drop-in native ScrollView wrapper. Replace `ScrollView` in the react-native import with:

```tsx
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
```

Keep all existing style/contentContainerStyle/ref props and button markup. Remove `automaticallyAdjustKeyboardInsets` on the caller for clarity (the wrapper explicitly overrides it to false, so existing flags on migrated callers are harmless). Do not keep an enclosing `KeyboardAvoidingView`: the wrapper owns keyboard overflow and focus visibility; Android adjustResize is detected by actual viewport measurement rather than compensated twice. Import once only; the duplicate security-pin integration import was corrected and is now covered by a source test.

## Concurrent owners / status checked during handoff

- Main has integrated imports in `app/account-verification.tsx` and `app/change-phone.tsx`. No further keyboard code changes are required there; removing the old automatic keyboard-inset flags is optional cleanup.
- Auth has integrated imports in `app/register.tsx`, `app/forgot-password.tsx`, and an input-modal wrapper in LoginPanel; LoginPanel's duplicate KeyboardAvoidingView is gone. Do not introduce a second nested scrolling container around the normal LoginPanel body when it already sits inside a shared wrapper.
- **Still needed at the last inspection:** replace the ScrollView import in `app/(tabs)/index.tsx` (home login body) and `app/onboarding.tsx` (registration-completion fields). These are cross-owner files, not edited by the keyboard agent.
- Financial: CoinAdmin fields inherit the wrapper in `app/control.tsx`. CustomerDossier inline fields also inherit it. Its current governorate picker is a FlatList with no text inputs and needs no keyboard scrolling. If adding an input Modal, give that Modal its own wrapper. CoinOrderForm and coin-send/coin-wallet scrolling imports are already integrated without financial logic edits.

## Input modal pattern

A parent Screen cannot scroll native Modal descendants. Replace the full-screen modal backdrop View (not the inner card) with the wrapper. Keep the card and all button markup unchanged. Move centering and padding to contentContainerStyle; leave full-screen flex/background in style:

```tsx
<Modal transparent visible={open} onRequestClose={close}>
  <ScrollView
    style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.70)" }}
    contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}
  >
    <View style={existingCardStyle}>{/* unchanged card, inputs, buttons */}</View>
  </ScrollView>
</Modal>
```

The keyboard agent applied this to withdrawal PIN, transfer confirmation/PIN, payment review and money-transfer review modals. Default tap behavior is `handled`; iOS default drag dismissal is interactive, Android on-drag (callers can retain their existing on-drag preference). Native opening/frame events trigger measurement, and one shared active-only focus observer covers programmatic field changes while the keyboard stays open. Manual dragging cancels pending automatic corrections; keyboard dismissal removes overflow without resetting scroll. Web uses its own DOM/visualViewport adapter and cannot prove native keyboard behavior.

No new dependencies, art, backend changes, configuration changes, commits, pushes, publication or service restarts were made by the keyboard agent. The original directory was read-only throughout.
