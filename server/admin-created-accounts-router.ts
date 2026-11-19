import { TRPCError } from "@trpc/server";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { adminCreatedAccountCreateSchema, adminCreatedAccountIdSchema, adminCreatedClaimSchema, adminCreatedIdentitySchema, adminCreatedSuspendSchema } from "../shared/admin-created-accounts";
import { AdminCreatedAccountError, claimAdminCreatedInvitation, createAdminCreatedAccount, issueAdminCreatedInvitation, listAdminCreatedAccounts, recordAdminCreatedIdentity, setAdminCreatedAccountSuspended, submitAdminCreatedAccount, type AdminCreatedInvitationDelivery } from "./admin-created-accounts";
import { adminImmediateCreateSchema, adminImmediatePasswordSchema } from "../shared/admin-immediate-accounts";
import { completeInitialPasswordChange, createImmediateAdminAccount, listImmediateAdminAccounts } from "./admin-immediate-accounts";

async function run<T>(ctx: { res: { setHeader(name: string, value: string): unknown } }, work: () => Promise<T>) {
  ctx.res.setHeader("Cache-Control", "private, no-store");
  try { return await work(); }
  catch (e) {
    if (e instanceof AdminCreatedAccountError) throw new TRPCError({ code: e.code, message: e.message });
    // Do not expose SQL, driver error, password, invitation token, or provider error details.
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إتمام الطلب بأمان؛ حاول لاحقًا." });
  }
}

/** Claim remains disabled until the app-wide financial and identity guards are actually integrated. */
export function createAdminCreatedAccountsRouter(options: { deliver?: AdminCreatedInvitationDelivery; enableClaimAfterGuardIntegration?: boolean } = {}) {
  return router({
    listImmediate: adminProcedure.query(({ ctx }) => run(ctx, () => listImmediateAdminAccounts(ctx.user.id))),
    createImmediate: adminProcedure.input(adminImmediateCreateSchema).mutation(({ ctx, input }) => run(ctx, () => createImmediateAdminAccount(ctx.user.id, input))),
    completeInitialPassword: publicProcedure.input(adminImmediatePasswordSchema).mutation(({ ctx, input }) => run(ctx, () => completeInitialPasswordChange(input))),
    list: adminProcedure.query(({ ctx }) => run(ctx, () => listAdminCreatedAccounts(ctx.user.id))),
    create: adminProcedure.input(adminCreatedAccountCreateSchema).mutation(({ ctx, input }) => run(ctx, () => createAdminCreatedAccount(ctx.user.id, input))),
    submit: adminProcedure.input(adminCreatedAccountIdSchema).mutation(({ ctx, input }) => run(ctx, () => submitAdminCreatedAccount(ctx.user.id, input.id))),
    recordIdentity: adminProcedure.input(adminCreatedIdentitySchema).mutation(({ ctx, input }) => run(ctx, () => recordAdminCreatedIdentity(ctx.user.id, input))),
    suspend: adminProcedure.input(adminCreatedSuspendSchema).mutation(({ ctx, input }) => run(ctx, () => setAdminCreatedAccountSuspended(ctx.user.id, input))),
    issueInvitation: adminProcedure.input(adminCreatedAccountIdSchema).mutation(({ ctx, input }) => run(ctx, () => issueAdminCreatedInvitation(ctx.user.id, input.id, options.enableClaimAfterGuardIntegration ? options.deliver : undefined))),
    claim: publicProcedure.input(adminCreatedClaimSchema).mutation(({ ctx, input }) => run(ctx, () => {
      if (!options.enableClaimAfterGuardIntegration || !options.deliver) throw new AdminCreatedAccountError("تفعيل الدعوات غير مهيأ بأمان بعد.", "INTERNAL_SERVER_ERROR");
      return claimAdminCreatedInvitation(input);
    })),
  });
}
