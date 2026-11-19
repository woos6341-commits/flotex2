import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { appSettings } from "../drizzle/schema";
import {
  DEFAULT_SERVICE_CONTROL_STATE,
  SERVICE_CONTROL_IDS,
  SERVICE_UNAVAILABLE_MESSAGE,
  type ServiceControlId,
  type ServiceControlState,
} from "../shared/service-controls";
import { getDb } from "./db";

const SERVICE_CONTROLS_KEY = "service_controls_v1";

function parseState(value: string | null | undefined): ServiceControlState {
  const parsed = value ? (() => { try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; } })() : {};
  return SERVICE_CONTROL_IDS.reduce((state, id) => {
    state[id] = parsed[id] !== false;
    return state;
  }, { ...DEFAULT_SERVICE_CONTROL_STATE });
}

export async function getServiceControls(): Promise<ServiceControlState> {
  const db = await getDb();
  if (!db) return { ...DEFAULT_SERVICE_CONTROL_STATE };
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SERVICE_CONTROLS_KEY)).limit(1);
  return parseState(row?.value);
}

export async function updateServiceControl(adminId: number, id: ServiceControlId, enabled: boolean) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const next = await db.transaction(async (tx) => {
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SERVICE_CONTROLS_KEY)).for("update").limit(1);
    const state = parseState(row?.value);
    state[id] = enabled;
    await tx.insert(appSettings).values({ key: SERVICE_CONTROLS_KEY, value: JSON.stringify(state), updatedBy: adminId })
      .onDuplicateKeyUpdate({ set: { value: JSON.stringify(state), updatedBy: adminId, updatedAt: sql`CURRENT_TIMESTAMP` } });
    return state;
  });
  return { success: true as const, services: next };
}

export async function updateAllServiceControls(adminId: number, enabled: boolean) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  const state = SERVICE_CONTROL_IDS.reduce((result, id) => { result[id] = enabled; return result; }, { ...DEFAULT_SERVICE_CONTROL_STATE });
  await db.insert(appSettings).values({ key: SERVICE_CONTROLS_KEY, value: JSON.stringify(state), updatedBy: adminId })
    .onDuplicateKeyUpdate({ set: { value: JSON.stringify(state), updatedBy: adminId, updatedAt: sql`CURRENT_TIMESTAMP` } });
  return { success: true as const, services: state };
}

export async function assertServiceEnabled(id: ServiceControlId, role?: string | null) {
  // The manager must retain access to the control panel and every administrative action.
  if (role === "admin") return;
  const state = await getServiceControls();
  if (!state[id]) throw new TRPCError({ code: "FORBIDDEN", message: SERVICE_UNAVAILABLE_MESSAGE });
}
