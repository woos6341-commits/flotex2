export const SAVINGS_AUTO_PAYOUT_PATH = "/api/scheduled/savings-auto-payout";
export const SAVINGS_EXTERNAL_AUTO_PAYOUT_PATH = "/api/webhooks/savings-auto-payout";
export const SAVINGS_AUTO_PAYOUT_JOB_NAME = "savings-auto-payout";
export const SAVINGS_AUTO_PAYOUT_TASK_UID_KEY = "savings_auto_payout_task_uid";
export const SAVINGS_AUTO_PAYOUT_CRON = "0 * * * * *";
export const SAVINGS_AUTO_PAYOUT_RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000] as const;
export const SAVINGS_AUTO_PAYOUT_JOB_DESCRIPTION =
  "يفحص خطط الادخار النشطة كل دقيقة، ويعالج العائد المستحق بعد مهلة خمس دقائق إذا لم يسجله المدير.";

export function getSavingsAutoPayoutRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const index = Math.min(safeAttempt, SAVINGS_AUTO_PAYOUT_RETRY_DELAYS_MS.length - 1);
  return SAVINGS_AUTO_PAYOUT_RETRY_DELAYS_MS[index];
}

export function isSavingsAutoPayoutScheduleRuntime(environment: string | undefined): boolean {
  return environment === "production";
}
