import { and, eq, isNotNull, sql } from "drizzle-orm";
import { appSettings, savingsPlans } from "../drizzle/schema";
import {
  createHeartbeatJob,
  deleteHeartbeatJob,
  listHeartbeatJobs,
  updateHeartbeatJob,
} from "./_core/heartbeat";
import { getDb } from "./db";
import {
  getSavingsAutoPayoutRetryDelayMs,
  isSavingsAutoPayoutScheduleRuntime,
  SAVINGS_AUTO_PAYOUT_CRON,
  SAVINGS_AUTO_PAYOUT_JOB_DESCRIPTION,
  SAVINGS_AUTO_PAYOUT_JOB_NAME,
  SAVINGS_AUTO_PAYOUT_PATH,
  SAVINGS_AUTO_PAYOUT_TASK_UID_KEY,
} from "./savings-schedule-config";

const LIST_PAGE_SIZE = 200;
const MAX_SCHEDULE_PAGES = 20;

async function listOwnerHeartbeatJobs() {
  const jobs: Awaited<ReturnType<typeof listHeartbeatJobs>>["jobs"] = [];
  let total = 0;
  for (let page = 1; page <= MAX_SCHEDULE_PAGES; page += 1) {
    const result = await listHeartbeatJobs("", { page, pageSize: LIST_PAGE_SIZE });
    jobs.push(...result.jobs);
    total = result.total;
    if (jobs.length >= total || result.jobs.length === 0) return jobs;
  }
  throw new Error("تعذر حصر مهام المشروع بأمان قبل إعداد مهمة العوائد.");
}

function needsReconcile(job: Awaited<ReturnType<typeof listHeartbeatJobs>>["jobs"][number]) {
  return job.callbackPath !== SAVINGS_AUTO_PAYOUT_PATH ||
    job.callbackMethod !== "POST" ||
    job.cronExpression !== SAVINGS_AUTO_PAYOUT_CRON ||
    !job.isEnable;
}

async function saveTaskUid(tx: any, taskUid: string) {
  await tx.insert(appSettings).values({ key: SAVINGS_AUTO_PAYOUT_TASK_UID_KEY, value: taskUid })
    .onDuplicateKeyUpdate({ set: { value: taskUid, updatedAt: sql`CURRENT_TIMESTAMP` } });
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function resetRetryState() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

function scheduleRetry() {
  if (retryTimer || !isSavingsAutoPayoutScheduleRuntime(process.env.NODE_ENV)) return;
  const delay = getSavingsAutoPayoutRetryDelayMs(retryAttempt);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureSavingsAutoPayoutHeartbeat().catch((error) => {
      console.error("[savings-auto-payout] heartbeat registration retry failed", error instanceof Error ? error.name : "unknown");
    });
  }, delay);
  (retryTimer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Create one project-owner heartbeat for all active plans, and persist its UID
 * so the callback can authenticate the scheduler identity before touching money.
 * This intentionally does nothing in Preview/development; the target callback
 * must already be present in a successful production deployment.
 */
async function reconcileSavingsAutoPayoutHeartbeat() {
  if (!isSavingsAutoPayoutScheduleRuntime(process.env.NODE_ENV)) {
    return { status: "deferred" as const };
  }

  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة لإعداد مهمة عائد الادخار.");

  return db.transaction(async (tx: any) => {
    // Insert a stable lock row before selecting it FOR UPDATE. The no-op update
    // serializes concurrent approvals across instances without replacing its UID.
    await tx.insert(appSettings).values({ key: SAVINGS_AUTO_PAYOUT_TASK_UID_KEY, value: "" })
      .onDuplicateKeyUpdate({ set: { updatedAt: sql`CURRENT_TIMESTAMP` } });
    const [stored] = await tx.select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SAVINGS_AUTO_PAYOUT_TASK_UID_KEY))
      .for("update")
      .limit(1);

    const [activePlan] = await tx.select({ id: savingsPlans.id })
      .from(savingsPlans)
      .where(and(eq(savingsPlans.status, "active"), isNotNull(savingsPlans.nextPayoutAt)))
      .limit(1);
    if (!activePlan && !stored?.value && retryAttempt === 0) {
      return { status: "not_needed" as const };
    }
    const jobs = await listOwnerHeartbeatJobs();
    const storedJob = stored?.value ? jobs.find((job) => job.taskUid === stored.value) : undefined;
    if (storedJob && storedJob.name !== SAVINGS_AUTO_PAYOUT_JOB_NAME) {
      throw new Error("معرّف مهمة الادخار المحفوظ مرتبط بمهمة مختلفة.");
    }
    const job = storedJob ?? jobs.find((candidate) => candidate.name === SAVINGS_AUTO_PAYOUT_JOB_NAME);

    if (!activePlan) {
      if (job) await deleteHeartbeatJob(job.taskUid, "");
      await tx.delete(appSettings).where(eq(appSettings.key, SAVINGS_AUTO_PAYOUT_TASK_UID_KEY));
      return { status: job ? "removed" as const : "not_needed" as const };
    }

    if (job) {
      const repaired = needsReconcile(job);
      if (repaired) {
        await updateHeartbeatJob(job.taskUid, {
          cron: SAVINGS_AUTO_PAYOUT_CRON,
          path: SAVINGS_AUTO_PAYOUT_PATH,
          method: "POST",
          description: SAVINGS_AUTO_PAYOUT_JOB_DESCRIPTION,
          enable: true,
        }, "");
      }
      if (stored?.value !== job.taskUid) await saveTaskUid(tx, job.taskUid);
      return { status: repaired ? "reconciled" as const : "active" as const, taskUid: job.taskUid };
    }

    const created = await createHeartbeatJob({
      name: SAVINGS_AUTO_PAYOUT_JOB_NAME,
      cron: SAVINGS_AUTO_PAYOUT_CRON,
      path: SAVINGS_AUTO_PAYOUT_PATH,
      method: "POST",
      description: SAVINGS_AUTO_PAYOUT_JOB_DESCRIPTION,
    }, "");
    if (!created.taskUid) throw new Error("لم تُرجع خدمة الجدولة معرّف مهمة صالحًا.");
    await saveTaskUid(tx, created.taskUid);
    return { status: "created" as const, taskUid: created.taskUid };
  });
}

export async function ensureSavingsAutoPayoutHeartbeat() {
  try {
    const result = await reconcileSavingsAutoPayoutHeartbeat();
    resetRetryState();
    return result;
  } catch (error) {
    scheduleRetry();
    throw error;
  }
}
