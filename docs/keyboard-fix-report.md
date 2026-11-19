# Keyboard visibility and savings handoff

## Implemented

The original Screen used KeyboardAvoidingView but did not measure the active input or scroll on field changes. Multiple callers also enabled automatic keyboard insets, including a second avoider in PaymentFlow. Native Modal inputs are not descendants of the page scroll view and were outside all avoidance.

The new shared `KeyboardAwareScrollView` measures its own native viewport and the complete focused field, verifies that the field belongs to its content, and scrolls by the smallest amount needed to put the whole input above the keyboard with a 12-pixel gap. Opening/frame changes and focus changes trigger cancellable corrections through the native animation/resize passes. One shared native 100ms identity-only observer is active only while the keyboard is visible, covering programmatic focus changes without periodic native measurement. Manual dragging cancels pending corrections. Dismissal removes keyboard overflow without scrolling back to an old focused field (Android Back can hide without blur).

Keyboard-only content overflow is based on measured overlap, not full keyboard height. Android resize, existing safe areas and tab bars are therefore not compensated twice. RN automatic keyboard insets are explicitly disabled by the wrapper. Existing ScrollView refs, props and all content styles are forwarded; original bottom padding is unchanged when the keyboard is hidden. Web focus and visualViewport handling are isolated in a `.web.ts` adapter; no native bundle depends on DOM globals.

Savings changes are restrained: slightly more defined panel/summary colors, muted-to-primary text hierarchy, opt-in low-opacity card shadows and tabular numeric values. Balance and rate loading indicators are absolutely positioned over same-sized text placeholders so they do not shift buttons. Amount parsing is memoized. History uses one foreground-only clock for active plans instead of one timer per card, and memoizes latest-paid-payout sorting. Financial calculations, API mutations, button JSX and plan actions are preserved.

## Exact source files changed by this agent

### Shared implementation

- `components/KeyboardAwareScrollView.tsx` (new)
- `lib/keyboard-focus.ts` (new native observer/measurement)
- `lib/keyboard-focus.web.ts` (new web adapter)
- `shared/keyboard-geometry.ts` (new pure calculations)
- `components/atheer-ui.tsx` (non-avoiding Screen shell; opt-in Card style)
- `components/screen-container.tsx` (documented single-owner integration; layout unchanged)

### Non-auth scroll integration / savings

- `app/transfer.tsx` (page and confirmation/PIN modal roots)
- `app/support.tsx`
- `app/sessions.tsx`
- `app/security-pin.tsx` (also removed a duplicate integration import introduced concurrently; retained auth-agent logic)
- `app/savings.tsx`
- `app/savings-how-to.tsx`
- `app/savings-history.tsx`
- `app/coin-wallet.tsx`
- `app/phone-verification.tsx`
- `app/coin-send.tsx`
- `components/payments/PaymentFlow.tsx` (deposit/withdrawal page, withdrawal PIN modal, removed second avoider)
- `components/CoinOrderForm.tsx` (buy/sell pages)
- `app/dev/theme-lab.tsx`
- `app/(tabs)/wallet.tsx`
- `app/(tabs)/profile.tsx`
- `app/(tabs)/activity.tsx`
- `app/control.tsx` (all inline control section inputs inherit shared scrolling)
- `components/payments-admin/RequestsReview.tsx` (input review modal root)
- `components/money-transfers/RequestsAdmin.tsx` (input review modal root)

### Tests

- `tests/keyboard-geometry.test.ts` (20 deterministic geometry cases)
- `tests/keyboard-focus.test.ts` (10 observer/ownership/lifecycle cases)
- `tests/keyboard-integration.test.ts` (31 source integration and preservation cases)

## Evidence

- Final targeted command: `pnpm exec vitest run tests/keyboard-geometry.test.ts tests/keyboard-focus.test.ts tests/keyboard-integration.test.ts tests/savings.test.ts tests/savings-cancel.test.ts tests/savings-heartbeat.test.ts tests/savings-payout-safety.test.ts tests/money-input.test.ts tests/currency.test.ts --no-file-parallelism` — **89 tests pass in 9 files**; 61 are new keyboard/integration cases. Log: `docs/keyboard-targeted-tests.log`.
- Final `pnpm check` — **pass**, no TypeScript errors. Log: `docs/keyboard-typecheck.log`.
- ESLint over all owned source changes and a final pass over core/savings/tests — **pass, no source diagnostics**. Only the pre-existing Node MODULE_TYPELESS_PACKAGE_JSON configuration notice is printed. Logs: `docs/keyboard-lint.log`, `docs/keyboard-lint-final.log`.
- `git diff --check` — **pass**.
- iOS JavaScript/Hermes bundle export — **pass** using `expo export --platform ios`; it validates native adapter resolution, not an iOS binary or a device. Temporary output was removed. Log: `docs/keyboard-native-bundle.log`.
- Exact normalized TypeScript AST signatures match the read-only original for **51 button JSX nodes** across savings, savings-history, atheer-ui, transfer, PaymentFlow, RequestsReview and RequestsAdmin. Entire nodes include styles, labels, icons and handlers, not just shapes. Future changes are checked against original-derived hashes without needing access to the original directory at test time.
- Geometry includes 320×568, 360×640, 390×844 and 430×932 phones, iOS overlay, already resized Android, safe-area/tab endings, switching higher/lower fields, last field overflow, keyboard frame changes, floating keyboards, clamping and oversized multiline fields.
- A full suite run during concurrent integration produced **38 passing files / 6 failing files, 232 passing / 30 failing tests**. Failures were in `balance-ledger`, `customer-topup`, `home-dashboard`, `money-transfers`, `payments-flow`, and `withdrawal-safety` (admin fixture/authorization and payment/fee/request expectations). No keyboard or savings test failed. This was not represented as a successful full acceptance pass; see `docs/keyboard-regression-tests.log`. Tests included the project's existing isolated DB fixtures; no account/balance backend code was changed by this agent.
- First web export failed specifically on a concurrently duplicated `ScrollView` import in security-pin. The duplicate was removed and covered by source tests; current TypeScript passes. The single corrected web export then completed successfully before a stop request could take effect: **web export pass**, exit 0, static routes generated. Temporary output was removed. Log: `docs/keyboard-web-bundle.log`. No resident services were started or restarted; main still owns the coordinated final full build.

## Cross-owner integration

Full pattern and last inspected status are in `docs/keyboard-integration.md`.

Main reports KYC/change-phone imports integrated and passing. Auth integrated register/forgot-password and LoginPanel's input Modal; its normal LoginPanel avoider is removed. Remaining at the last inspection: **home login wrapper in `app/(tabs)/index.tsx` and onboarding fields in `app/onboarding.tsx` still need the shared ScrollView import**. These cross-owner files were not edited here. Existing `automaticallyAdjustKeyboardInsets` flags on migrated callers are overridden to false by the wrapper, so removing them is optional cleanup.

Financial CoinAdmin and CustomerDossier inline inputs already inherit `app/control.tsx` scrolling; their current picker Modal has no text inputs. Any new input Modal in those components needs its own wrapper. The control request-center Modal contains navigation links only; no text-input integration is needed there.

Required import:

```tsx
import { KeyboardAwareScrollView as ScrollView } from "@/components/KeyboardAwareScrollView";
```

No per-TextInput handlers are required. Do not add nested avoiders or duplicate keyboard-insetting scroll owners. For input Modals, use the wrapper as the full-screen backdrop root with flex/background in `style` and centering/padding in `contentContainerStyle`, leaving the inner card/button subtree intact.

## Limits and boundaries

No actual iOS/Android device or emulator with a real soft keyboard was available. Native animation timing, OEM keyboards, predictive/emoji layouts, rotation, gesture dismissal and native Modal keyboard resizing still require device checks on small/large phones. Deterministic geometry/native observer tests and successful native JS export are evidence of implementation, not proof of those physical interactions. An input taller than the visible viewport cannot be entirely visible; the implementation aligns its top for editing, and manual scrolling remains available.

No dependencies, new art, server changes, app.config/TODO edits, commits, pushes, publication, native binaries or resident-service restarts were made by this agent. Work remained in `/home/ubuntu/flotexegp`; `/home/ubuntu/flotex-original` was only read for button preservation.
