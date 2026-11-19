import { TRPCError } from "@trpc/server";
import { issueManualVerificationSchema, redeemManualVerificationSchema, revokeManualVerificationSchema } from "../shared/manual-verification";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { ManualAuthError } from "./manual-auth";
import { issueManualVerification, listManualVerifications, redeemManualVerification, revokeManualVerification } from "./manual-verification";

async function action<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof ManualAuthError) throw new TRPCError({ code: error.code, message: error.message });
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إتمام عملية التحقق الآن." });
  }
}
/** Mount as appRouter.verificationAssistance; issue/list/revoke are admin-only. */
export const manualVerificationRouter = router({
  issue: adminProcedure.input(issueManualVerificationSchema).mutation(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return action(() => issueManualVerification(ctx.user.id, input)); }),
  list: adminProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return action(() => listManualVerifications(ctx.user.id)); }),
  revoke: adminProcedure.input(revokeManualVerificationSchema).mutation(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return action(() => revokeManualVerification(ctx.user.id, input)); }),
  redeem: publicProcedure.input(redeemManualVerificationSchema).mutation(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "no-store"); return action(() => redeemManualVerification(input)); }),
});
// Supplies the client with the exact mounted path without requiring changes to routers.ts yet.
export const manualVerificationRoot = router({ verificationAssistance: manualVerificationRouter });
