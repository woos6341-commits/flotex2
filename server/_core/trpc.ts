import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { ADMIN_EMAIL } from "../../shared/admin";
import { isCustomerAccountFrozen } from "../account-controls";
import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";
import { createFinancialGate } from "./financial-gate";

function isApprovedAdministrator(user: NonNullable<TrpcContext["user"]>) {
  const email = (user.emailNormalized ?? user.email)?.trim().toLowerCase();
  return user.role === "admin" && email === ADMIN_EMAIL;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (!isApprovedAdministrator(ctx.user) && await isCustomerAccountFrozen(ctx.user.id)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "تم تجميد حسابك مؤقتًا؛ تواصل مع خدمة العملاء أو الإدارة لإعادة التفعيل." });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

const serializedFinancialMutationPaths = new Set([
  "portfolio.request",
  "savings.create",
  "savings.cancel",
  "savings.refund",
  "coin.createOrder",
  "coin.cancelOrder",
  "coin.createTransfer",
  "transfers.create",
  "transfers.cancel",
  "gold.createOrder",
  "trading.createIntent",
  "gameTopup.create",
  "gameTopup.cancel",
]);
const financialGate = createFinancialGate();

const serializeFinancialMutation = t.middleware(async ({ ctx, next, path, type }) => {
  if (type !== "mutation" || !ctx.user || !serializedFinancialMutationPaths.has(path)) return next();
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة الآن." });
  return financialGate.run(() => db.transaction(async (tx: any) => {
    const [account] = await tx.select({ status: users.status }).from(users).where(eq(users.id, ctx.user!.id)).for("update").limit(1);
    if (!account || account.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير نشط؛ لا يمكن تنفيذ عمليات مالية." });
    return next();
  }));
});

export const protectedProcedure = t.procedure.use(requireUser).use(serializeFinancialMutation);

/**
 * Frozen users keep access to the support inbox only. This deliberately does not use
 * protectedProcedure, because that middleware blocks every authenticated request for a
 * frozen account. It also does not attach the financial serialization middleware.
 */
export const frozenSupportProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  if (ctx.user.role !== "user" || !(await isCustomerAccountFrozen(ctx.user.id))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "قناة الدعم هذه متاحة للحسابات المجمدة فقط." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || !isApprovedAdministrator(ctx.user)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/** Existing account reads/admin access remain available; customer financial actions need a completed profile. */
export const registeredProcedure = protectedProcedure.use(async ({ctx,next}) => {
  if(!ctx.user)throw new TRPCError({code:"UNAUTHORIZED",message:UNAUTHED_ERR_MSG});
  if(!isApprovedAdministrator(ctx.user)&&!ctx.user.profileCompletedAt)throw new TRPCError({code:"FORBIDDEN",message:"أكمل بيانات التسجيل أولًا من صفحة حسابي"});
  return next({ctx:{...ctx,user:ctx.user}});
});
