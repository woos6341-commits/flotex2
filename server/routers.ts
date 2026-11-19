import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getSessionCookieName, getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, registeredProcedure, frozenSupportProcedure, adminProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { getReadiness } from "./providers/readiness";
import { registerPushToken, unregisterPushToken } from "./push";
import { completeRegistration } from "./registration";
import { completeManualRegistrationSchema, emailAddressSchema, manualRegistrationSchema, otpCodeSchema, passwordSchema, phoneNumberSchema, registrationSchema } from "../shared/registration";
import { isValidDateOnly } from "../shared/date-only";
import { createPaymentMethod, deletePaymentMethod, getAdminPaymentMethods, getCustomerPaymentMethodAccess, getFeePolicy, getPaymentMethods, getPaymentLimits, getPaymentServiceStatus, METHOD_IDS, setCustomerPaymentMethodBlocked, setCustomerPaymentMethodDirection, updateFeePolicy, updatePaymentMethod, updatePaymentServiceStatus } from "./payment-settings";
import { paymentMethodFieldsSchema } from "../shared/payment-method-fields";
import { createAndroidUpdateUploadUrl, getAndroidUpdateDownloadUrl, getAndroidUpdatePolicy, getPublicAndroidUpdatePolicy, updateAndroidUpdatePolicy } from "./app-updates";
import { customerSupportSettingsSchema } from "../shared/customer-support";
import { getCustomerSupportSettings, updateCustomerSupportSettings } from "./customer-support";
import { isReleaseVersion } from "../shared/app-updates";
import { ONE_YEAR_MS } from "../shared/const.js";
import { issueEmailCode, verifyEmailCode, registerManualAccount, loginManualAccount, completeTrustedDeviceLogin, resetManualPassword, changeManualPasswordWithEmailCode, refreshManualSession, toPublicAuthUser, ManualAuthError } from "./manual-auth";
import { cancelMoneyTransfer, createMoneyTransfer, listMoneyTransfersForAdmin, listMyMoneyTransfers, lookupTransferRecipient, reviewMoneyTransfer } from "./money-transfers";
import { isCustomerAccountFrozen, listFrozenCustomerIds, setCustomerAccountFrozen } from "./account-controls";
import { createContactButton, deleteContactButton, getAdminContactButtons, getContactButtons, reorderContactButtons, updateContactButton } from "./contact-buttons";
import { contactButtonInputSchema } from "../shared/contact-buttons";
import { adminCustomerProfileSchema, phoneVerificationContactsSchema, phoneVerificationRequestInputSchema, phoneVerificationReviewSchema, phoneVerificationSearchSchema } from "../shared/phone-verification";
import { getAdminCustomerNationalId, getMyPhoneVerification, getPhoneVerificationContacts, listPhoneVerificationUsers, listUserProfileAudits, reviewPhoneVerificationRequest, submitMyPhoneVerificationRequest, updateCustomerProfileByAdmin, updateOwnPhoneNumber, updatePhoneVerificationContacts } from "./phone-verification";
import { addSavingsFinancing, cancelSavingsPlan, confirmSavingsPayout, createSavingsPlan, getAdminSavingsFinancingWallet, listAdminSavingsPayoutSchedules, listAdminSavingsPlans, listAdminSavingsTransactions, listMySavingsPlans, refundSavingsPlan, reviewSavingsPlan } from "./savings";
import { ensureSavingsAutoPayoutHeartbeat } from "./savings-scheduler";
import { getAdminSavingsSettings, getSavingsSettings, updateSavingsSettings } from "./savings-settings";
import { savingsAmountSchema, savingsClientOperationIdSchema, savingsFrequencySchema } from "../shared/savings";
import { savingsSettingsInputSchema } from "../shared/savings-settings";
import { updateOwnNationalId } from "./profile-data";
import { getAdminAccountVerificationDocuments, getAdminAccountVerificationSettings, getMyAccountVerificationStatus, listAdminAccountVerificationRequests, reviewAccountVerification, submitAccountVerification, updateAccountVerificationProfile, updateAdminAccountVerificationSettings } from "./account-verification";
import { setAdminAccountVerificationStatus } from "./account-verification-state";
import { findAdminCustomer, getAdminCustomerDetails, listAdminCustomers } from "./customer-admin";
import { getMyPhoneChangeRequest, submitPhoneChangeRequest, listAdminPhoneChangeRequests, getAdminPhoneChangeDocuments, reviewPhoneChangeRequest } from "./phone-change";
import { phoneChangeRequestInputSchema } from "../shared/phone-change";
import { listAdminNotifications, sendAdminNotification } from "./admin-notifications";
import { getSecurityPinStatus, setSecurityPin, resetSecurityPinAfterVerification, getAdminSecurityPinStatus } from "./security-pin";
import { closeSupportConversation, listMySupportMessages, sendSupportMessage, listAdminSupportConversations, listAdminSupportMessages, replyToSupportMessage } from "./support-messages";
import { listGuestTickets, listGuestMessagesForAdmin, replyToGuestTicket, setGuestTicketStatus } from "./guest-support";
import { listDeletedAccountSupportMessages, sendDeletedAccountSupportMessage } from "./account-support";
import { createExternalTransferRequest, getExternalTransferPricing, listAdminExternalTransferRequests, listMyExternalTransferRequests, updateExternalTransferPricing, updateExternalTransferStatus } from "./external-transfers";
import { addGameTopupFunding, cancelGameTopupRequest, clearGameTopupImage, createGameDepositRequest, createGameTopupRequest, createGameWithdrawRequest, deleteGameTopupGame, deleteGameTopupPackage, getAdminGameTopupCatalog, getGameTopupCatalog, getGameTopupOverview, listAdminGameTopupRequests, listMyGameTopupRequests, reviewGameTopupRequest, saveGameTopupGame, saveGameTopupImage, saveGameTopupPackage, updateGameTopupSettings } from "./game-topup";
import { listDeviceSessions, requestSessionToken, revokeAllDeviceSessions, revokeDeviceSession } from "./session-management";
import { revokePresentedSession } from "./revoke-presented-session";
import { ACTIVE_SUPPORT_CATEGORIES, SUPPORT_CATEGORIES } from "../shared/support-categories";
import { reportClientActivity } from "./client-activity";
import { createGoldOrder, getGoldOrderPreview, getGoldStatus, listGoldPrices, listMyGold, refreshGoldPrices } from "./gold";
import { getAdminGoldDashboard, recordGoldInventoryEntry, reviewGoldOrder, updateGoldSettings } from "./gold-admin";
import { adjustUserCoinBalance, cancelCoinOrder, createCoinOrder, createCoinTransfer, fundCoinSales, getAdminCoinDashboard, getCoinOverview, lookupCoinTransferRecipient, recordCoinInventory, reviewCoinOrder, reviewCoinTransfer, updateCoinSettings } from "./coin";
import { getOwnAccountDeletionEligibility, listAccountStatusEvents, restoreDeletedCustomerAccount, softDeleteOwnAccount } from "./account-management";
import { getRecentOperations } from "./recent-operations";
import { adminRequestDetailsInputSchema, getAdminRequestDetails } from "./admin-request-details";
import { manualVerificationRouter } from "./manual-verification-router";
import { createAdminCreatedAccountsRouter } from "./admin-created-accounts-router";
import { getAdminCustomerHomeActionOrder, getHomeActionOrder, resetCustomerHomeActionOrder, setCustomerHomeActionOrder, updateHomeActionOrder } from "./home-action-order";
import { HOME_ACTION_ORDER_IDS } from "../shared/home-action-order";
import { getAdminCustomerUiButtonVisibility, getAdminGlobalUiButtonVisibility, getMyUiButtonVisibility, getUiButtonVisibilityAudit, setCustomerUiButtonVisibility, setGlobalUiButtonVisibility } from "./ui-button-visibility";
import { getButtonLayout, getButtonLayoutAudit, writeButtonLayout } from "./button-layout";
import { getUserShareFile, uploadUserShareFile } from "./share-file";
import { assertServiceEnabled, getServiceControls, updateAllServiceControls, updateServiceControl } from "./service-controls";
import { SERVICE_CONTROL_IDS, type ServiceControlId } from "../shared/service-controls";
import { getAdminCustomerInvoice } from "./customer-invoice";
import { getEmailDeliveryHistory, sendCustomerEmail } from "./customer-email";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "أدخل مبلغًا صحيحًا بالجنيه المصري");
const image = z.string().max(12_000_000, "حجم الصورة أكبر من المسموح");
const verificationImage = z.object({ mimeType: z.enum(["image/jpeg", "image/png"]), data: z.string().min(16).max(2_800_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict();
const accountVerificationImagesInput = z.object({ birthDate: z.string().refine(isValidDateOnly, "أدخل تاريخ ميلاد صحيحًا بصيغة YYYY-MM-DD"), idFront: verificationImage, idBack: verificationImage, selfie: verificationImage, walletProfile: verificationImage }).strict();
export const paymentRequestSchema = z.object({
  type: z.enum(["deposit", "withdrawal"]), amount: money,
  paymentMethodId: z.string().regex(/^[a-z][a-z0-9_]{1,19}$/), operationId: z.string().min(12).max(80),
  customFields: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,23}$/), z.string().max(500)).optional(),
  note: z.string().trim().max(500).optional(),
  senderReference: z.string().trim().min(2).max(150).optional(),
  transferReference: z.string().trim().min(2).max(150).optional(),
  destination: z.string().trim().min(5).max(180).optional(),
  securityPin: z.string().regex(/^\d{4}$/, "رمز الأمان يجب أن يتكون من 4 أرقام").optional(),
  receiptImageData: image.optional(),
}).superRefine((input, ctx) => {
  if (input.type === "deposit") {
    if (!input.receiptImageData) ctx.addIssue({code:"custom",path:["receiptImageData"],message:"أرفق صورة التحويل قبل الإرسال"});
    if (!input.senderReference && !input.transferReference) ctx.addIssue({code:"custom",path:["senderReference"],message:"أدخل رقم المرسل أو مرجع التحويل"});
  }
  if (input.type === "withdrawal" && input.transferReference) ctx.addIssue({code:"custom",path:["transferReference"],message:"مرجع السحب يسجله المسؤول بعد التنفيذ"});
  if (input.type === "withdrawal" && !input.destination) ctx.addIssue({code:"custom",path:["destination"],message:"أدخل رقم المحفظة أو الحساب"});
});
const limitsSchema = z.object({minDepositAmount:money.optional(),minWithdrawalAmount:money.optional(),minTransferAmount:money.optional(),maxTradeAmount:money.optional(),maxDepositAmount:money.optional(),maxWithdrawalAmount:money.optional()});
const feePolicySchema = z.object({
  withdrawalEnabled: z.boolean(),
  transferEnabled: z.boolean(),
  transferFeeAmount: money,
  withdrawalTiers: z.array(z.object({ id: z.string().trim().min(1).max(40), minimumAmount: money, maximumAmount: money.nullable(), feeAmount: money })).max(20),
});
const dateOnly = z.string().refine(isValidDateOnly, "أدخل تاريخًا صحيحًا بصيغة YYYY-MM-DD");
const contactButtonId = z.string().regex(/^contact_[a-f0-9]{12}$/);
const gameTopupFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, "مفتاح الخانة يجب أن يبدأ بحرف لاتيني"),
  label: z.string().trim().min(1).max(60),
  placeholder: z.string().trim().max(120).optional(),
  required: z.boolean(),
  type: z.enum(["text", "number"]).optional(),
}).strict();
const gameTopupStatusSchema = z.enum(["new", "under_review", "approved", "processing", "completed", "rejected", "cancelled"]);
async function paymentAction<T>(work:()=>Promise<T>):Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof TRPCError) throw error;
    const text = error instanceof Error ? error.message : "";
    throw new TRPCError({code:"BAD_REQUEST",message:/[\u0600-\u06ff]/.test(text) && !/query:|sql:|insert into|select /i.test(text) ? text : "تعذر إتمام العملية. تحقق من البيانات أو مرجع العملية وحاول مجددًا."});
  }
}
function logAdminReadFailure(scope: string, error: unknown) {
  const detail = error as { name?: unknown; code?: unknown; errno?: unknown };
  console.error(`[admin.${scope}] read failed`, {
    name: typeof detail?.name === "string" ? detail.name.slice(0, 80) : "unknown",
    code: typeof detail?.code === "string" ? detail.code.slice(0, 80) : undefined,
    errno: typeof detail?.errno === "number" ? detail.errno : undefined,
  });
}
async function authAction<T>(work:()=>Promise<T>):Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof ManualAuthError) throw new TRPCError({ code: error.code, message: error.message });
    console.error("[Auth] Manual authentication operation failed");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إتمام الطلب الآن. حاول لاحقًا." });
  }
}
const challengeId = z.string().uuid();
const grantToken = z.string().min(40).max(64).regex(/^[A-Za-z0-9_-]+$/);
const emailCodeRequest = z.object({
  email: emailAddressSchema,
  purpose: z.enum(["register", "password_reset", "account_support"]),
  phoneNumber: phoneNumberSchema.optional(),
  customerId: z.string().regex(/^\d{10}$/).optional(),
}).superRefine((input, ctx) => {
  if (input.purpose === "register" && !input.phoneNumber) ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "أدخل رقم الهاتف للتسجيل" });
  if (input.purpose === "account_support" && !input.customerId) ctx.addIssue({ code: "custom", path: ["customerId"], message: "أدخل رقم العميل المكوّن من 10 أرقام" });
});
const passwordResetInput = z.object({
  challengeId,
  grantToken,
  password: passwordSchema,
  confirmPassword: z.string().min(1),
}).superRefine((input, ctx) => {
  if (input.password !== input.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "كلمتا المرور غير متطابقتين" });
});
const passwordChangeInput = z.object({ challengeId, code: otpCodeSchema, currentPassword: z.string().min(1).max(128), password: passwordSchema, confirmPassword: z.string().min(1).max(128) }).superRefine((input, ctx) => {
  if (input.password !== input.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "كلمتا المرور غير متطابقتين" });
});
function setSessionCookie(ctx: { req: any; res: any }, token: string) {
  ctx.res.cookie(getSessionCookieName(ctx.req), token, { ...getSessionCookieOptions(ctx.req), maxAge: ONE_YEAR_MS });
}
export const appRouter = router({
  system: systemRouter,
  verificationAssistance: manualVerificationRouter,
  // Only staging/review is enabled; real invitation/claim remains fail-closed.
  adminCreatedAccounts: createAdminCreatedAccountsRouter(),
  readiness: publicProcedure.query(() => getReadiness()),
  homeActionOrder: router({
    get: publicProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "no-store"); return getHomeActionOrder(); }),
  }),
  buttonLayout: router({
    get: publicProcedure.input(z.object({ surface: z.enum(["home", "wallet"]) }).strict()).query(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "no-store"); return getButtonLayout(input.surface); }),
  }),
  uiButtonVisibility: router({
    mine: protectedProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getMyUiButtonVisibility(ctx.user.id)); }),
  }),
  activity: router({
    report: protectedProcedure.input(z.object({ version: z.string().trim().max(32).optional(), buildNumber: z.string().trim().max(48).optional() }).strict())
      .mutation(({ ctx, input }) => paymentAction(() => reportClientActivity(ctx.user.id, input))),
  }),
  appUpdates: router({
    androidPolicy: publicProcedure.query(({ ctx }) => {
      ctx.res.setHeader("Cache-Control", "no-store");
      return paymentAction(() => getPublicAndroidUpdatePolicy());
    }),
    androidDownloadUrl: publicProcedure.input(z.object({ version: z.string().trim().max(32) }))
      .mutation(({ ctx, input }) => {
        ctx.res.setHeader("Cache-Control", "no-store");
        return paymentAction(() => getAndroidUpdateDownloadUrl(input.version));
      }),
  }),
  customerSupport: router({
    settings: protectedProcedure.query(({ ctx }) => {
      ctx.res.setHeader("Cache-Control", "private, no-store");
      return paymentAction(() => getCustomerSupportSettings());
    }),
  }),
  phoneVerification: router({
    contacts: protectedProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getPhoneVerificationContacts()); }),
    mine: protectedProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getMyPhoneVerification(ctx.user.id)); }),
  }),
  auth: router({
    me: publicProcedure.query(async (opts) => { opts.ctx.res.setHeader("Cache-Control", "private, no-store"); return opts.ctx.user ? { ...toPublicAuthUser(opts.ctx.user), accountFrozen: opts.ctx.user.role === "admin" ? false : await isCustomerAccountFrozen(opts.ctx.user.id) } : null; }),
    requestEmailCode: publicProcedure.input(emailCodeRequest).mutation(({input})=>authAction(()=>issueEmailCode(input))),
    requestPasswordChangeCode: protectedProcedure.mutation(({ctx})=>authAction(()=>issueEmailCode({email:ctx.user.emailNormalized ?? ctx.user.email ?? "",purpose:"password_reset"}))),
    verifyEmailCode: publicProcedure.input(z.object({challengeId,code:otpCodeSchema})).mutation(({input})=>authAction(()=>verifyEmailCode(input))),
    register: publicProcedure.input(z.object({form:completeManualRegistrationSchema,challengeId,grantToken})).mutation(async ({ctx,input})=>authAction(async()=>{const result=await registerManualAccount(input.form,input.challengeId,input.grantToken);setSessionCookie(ctx,result.app_session_id);return result;})),
    login: publicProcedure.input(z.object({email:emailAddressSchema,password:z.string().min(1).max(128),deviceId:z.string().min(8).max(128).optional(),deviceName:z.string().max(160).optional(),platform:z.string().max(32).optional()})).mutation(async ({ctx,input})=>authAction(async()=>{const result=await loginManualAccount(input);if(result.app_session_id) setSessionCookie(ctx,result.app_session_id);return result;})),
    refresh: protectedProcedure.input(z.object({deviceId:z.string().min(8).max(128).optional(),deviceName:z.string().max(160).optional(),platform:z.string().max(32).optional()}).optional()).mutation(async ({ctx,input})=>authAction(async()=>{const result=await refreshManualSession(ctx.user,input ?? undefined,requestSessionToken(ctx.req));setSessionCookie(ctx,result.app_session_id);return result;})),
    completeDeviceLogin: publicProcedure.input(z.object({challengeToken:z.string().min(20).max(160),pin:z.string().regex(/^\d{4}$/),deviceId:z.string().min(8).max(128),deviceName:z.string().max(160).optional(),platform:z.string().max(32).optional()})).mutation(async ({ctx,input})=>authAction(async()=>{const result=await completeTrustedDeviceLogin(input);setSessionCookie(ctx,result.app_session_id);return result;})),
    sessions: registeredProcedure.query(({ctx})=>listDeviceSessions(ctx.user.id, requestSessionToken(ctx.req))),
    revokeSession: registeredProcedure.input(z.object({sessionId:z.number().int().positive()})).mutation(({ctx,input})=>paymentAction(()=>revokeDeviceSession(ctx.user.id,input.sessionId))),
    revokeAllSessions: registeredProcedure.mutation(({ctx})=>paymentAction(()=>revokeAllDeviceSessions(ctx.user.id,"تسجيل خروج من جميع الأجهزة"))),
    resetPassword: publicProcedure.input(passwordResetInput).mutation(async ({ctx,input})=>authAction(async()=>{const result=await resetManualPassword(input);setSessionCookie(ctx,result.app_session_id);return result;})),
    changePassword: protectedProcedure.input(passwordChangeInput).mutation(async ({ctx,input})=>authAction(async()=>{const result=await changeManualPasswordWithEmailCode(ctx.user.id,input);ctx.res.clearCookie(getSessionCookieName(ctx.req),{...getSessionCookieOptions(ctx.req),maxAge:-1});return result;})),
    completeRegistration: protectedProcedure.input(registrationSchema).mutation(({ctx,input})=>paymentAction(()=>completeRegistration(ctx.user.id,input))),
    updatePhoneNumber: protectedProcedure.input(z.object({phoneNumber:phoneNumberSchema}).strict()).mutation(() => { throw new TRPCError({ code: "BAD_REQUEST", message: "استخدم طلب تغيير رقم الهاتف مع مستندات الهوية وموافقة المدير" }); }),
    phoneChange: protectedProcedure.query(({ctx})=>paymentAction(()=>getMyPhoneChangeRequest(ctx.user.id))),
    submitPhoneChange: protectedProcedure.input(phoneChangeRequestInputSchema).mutation(({ctx,input})=>paymentAction(()=>submitPhoneChangeRequest(ctx.user.id,input))),
    updateNationalId: protectedProcedure.input(z.object({nationalId:z.string().trim().min(14).max(24)}).strict()).mutation(({ctx,input})=>paymentAction(()=>updateOwnNationalId(ctx.user.id,input.nationalId))),
    submitPhoneVerificationRequest: protectedProcedure.input(phoneVerificationRequestInputSchema).mutation(({ctx,input})=>paymentAction(()=>submitMyPhoneVerificationRequest(ctx.user.id,input.message))),
    registerPushToken: protectedProcedure.input(z.object({token:z.string().min(10).max(512),provider:z.literal("expo").default("expo"),platform:z.enum(["ios","android"])})).mutation(({ctx,input})=>registerPushToken(ctx.user.id,input.token,input.platform,input.provider)),
    unregisterPushToken: protectedProcedure.input(z.object({token:z.string().min(10).max(512)})).mutation(({ctx,input})=>unregisterPushToken(ctx.user.id,input.token)),
    logout: publicProcedure.mutation(async ({ctx})=>{
      try {
        if (ctx.user) await revokePresentedSession(ctx.user.id, requestSessionToken(ctx.req));
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تأكيد إبطال الجلسة على الخادم. أعد المحاولة عند عودة الاتصال." });
      } finally {
        ctx.res.clearCookie(getSessionCookieName(ctx.req), { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      }
      return {success:true} as const;
    }),
  }),
  account: router({
    deletionEligibility: protectedProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getOwnAccountDeletionEligibility(ctx.user.id));}),
    deleteMine: protectedProcedure.input(z.object({customerId:z.string().regex(/^\d{10}$/),email:emailAddressSchema,password:z.string().min(1).max(128),reason:z.string().trim().max(500).optional()}).strict()).mutation(async({ctx,input})=>paymentAction(async()=>{const result=await softDeleteOwnAccount(ctx.user.id,input);ctx.res.clearCookie(getSessionCookieName(ctx.req),{...getSessionCookieOptions(ctx.req),maxAge:-1});return result;})),
  }),
  supportPortal: router({
    requestCode: publicProcedure.input(z.object({email:emailAddressSchema,customerId:z.string().regex(/^\d{10}$/)}).strict()).mutation(({input})=>authAction(()=>issueEmailCode({email:input.email,purpose:"account_support",customerId:input.customerId}))),
    messages: publicProcedure.input(z.object({token:grantToken}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listDeletedAccountSupportMessages(input.token));}),
    send: publicProcedure.input(z.object({token:grantToken,body:z.string().trim().min(1).max(2000)}).strict()).mutation(({input})=>paymentAction(()=>sendDeletedAccountSupportMessage(input.token,input.body))),
  }),
  payment: router({
    instructions: protectedProcedure.query(()=>db.getPaymentInstructions()),
    methods: protectedProcedure.input(z.object({direction:z.enum(["deposit","withdrawal"])}).strict()).query(({ctx,input})=>getPaymentMethods(ctx.user.id,false,input.direction)),
    serviceStatus: protectedProcedure.query(()=>paymentAction(()=>getPaymentServiceStatus())),
    contactButtons: protectedProcedure.query(()=>paymentAction(()=>getContactButtons())),
    limits: protectedProcedure.query(()=>getPaymentLimits()),
    fees: protectedProcedure.query(()=>getFeePolicy()),
    receipt: protectedProcedure.input(z.object({requestId:z.number().int().positive()})).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>db.getRequestReceipt(ctx.user.id,input.requestId));}),
  }),
  serviceControls: protectedProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return getServiceControls(); }),
  portfolio: router({
    get: protectedProcedure.query(({ctx})=>db.getPortfolio(ctx.user.id)),
    transactions: protectedProcedure.query(({ctx})=>db.getTransactions(ctx.user.id)),
    requests: protectedProcedure.query(({ctx})=>db.getCustomerRequests(ctx.user.id)),
    updateName: protectedProcedure.input(z.object({name:z.string().trim().min(3).max(120)})).mutation(({ctx,input})=>paymentAction(()=>db.updateProfileName(ctx.user.id,input.name))),
    request: registeredProcedure.input(paymentRequestSchema).mutation(({ctx,input})=>paymentAction(async()=>{
      await assertServiceEnabled(input.type, ctx.user.role);
      if (input.type === "withdrawal" && !input.securityPin) throw new Error("أدخل رمز الأمان قبل تأكيد السحب");
      return db.createRequest(ctx.user.id,input.type,input.amount,input.note,undefined,input.transferReference,input.destination,input.receiptImageData,{paymentMethodId:input.paymentMethodId,operationId:input.operationId,senderReference:input.senderReference,securityPin:input.securityPin});
    })),
  }),
  savings: router({
    settings: protectedProcedure.query(({ ctx }) => paymentAction(() => getSavingsSettings())),
    mine: protectedProcedure.query(({ctx})=>paymentAction(()=>listMySavingsPlans(ctx.user.id))),
    create: registeredProcedure.input(z.object({ frequency: savingsFrequencySchema, amount: savingsAmountSchema, clientOperationId: savingsClientOperationIdSchema })).mutation(({ctx,input})=>paymentAction(async()=>{ await assertServiceEnabled("savings", ctx.user.role); return createSavingsPlan(ctx.user.id,input); })),
    cancel: registeredProcedure.input(z.object({ planId: z.number().int().positive() })).mutation(({ctx,input})=>paymentAction(()=>cancelSavingsPlan(ctx.user.id,input.planId))),
    refund: registeredProcedure.input(z.object({ planId: z.number().int().positive() })).mutation(({ctx,input})=>paymentAction(()=>refundSavingsPlan(ctx.user.id,input.planId))),
  }),
  coin: router({
    overview: protectedProcedure.query(({ ctx }) => paymentAction(() => getCoinOverview(ctx.user.id))),
    createOrder: registeredProcedure.input(z.object({ side: z.enum(["buy", "sell"]), quantity: z.string().regex(/^\d+(\.\d{1,6})?$/), idempotencyKey: z.string().min(12).max(120), securityPin: z.string().regex(/^\d{4}$/, "رمز الأمان يجب أن يتكون من 4 أرقام") }).strict()).mutation(({ ctx, input }) => paymentAction(async () => { await assertServiceEnabled("coin", ctx.user.role); return createCoinOrder(ctx.user.id, input); })),
    cancelOrder: registeredProcedure.input(z.object({ orderId: z.number().int().positive() }).strict()).mutation(({ ctx, input }) => paymentAction(() => cancelCoinOrder(ctx.user.id, input.orderId))),
    lookupTransferRecipient: registeredProcedure.input(z.object({ customerId: z.string().regex(/^\d{10}$/) }).strict()).query(({ ctx, input }) => paymentAction(() => lookupCoinTransferRecipient(ctx.user.id, input.customerId))),
    createTransfer: registeredProcedure.input(z.object({ recipientCustomerId: z.string().regex(/^\d{10}$/), quantity: z.string().regex(/^\d+(\.\d{1,6})?$/), idempotencyKey: z.string().min(12).max(120), securityPin: z.string().regex(/^\d{4}$/, "رمز الأمان يجب أن يتكون من 4 أرقام") }).strict()).mutation(({ ctx, input }) => paymentAction(async () => { await assertServiceEnabled("coin", ctx.user.role); return createCoinTransfer(ctx.user.id, input); })),
  }),
  gameTopup: router({
    catalog: protectedProcedure.query(() => paymentAction(() => getGameTopupCatalog())),
    overview: protectedProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getGameTopupOverview(ctx.user.id)); }),
    mine: protectedProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => listMyGameTopupRequests(ctx.user.id)); }),
    create: registeredProcedure.input(z.object({
      gameId: z.number().int().positive(),
      packageId: z.number().int().positive().nullable().optional(),
      quantity: z.number().int().positive().max(10_000_000).nullable().optional(),
      fields: z.record(z.string().max(32), z.string().max(120)),
      idempotencyKey: z.string().trim().min(12).max(80),
    }).strict()).mutation(({ ctx, input }) => paymentAction(async () => { await assertServiceEnabled("game_topup", ctx.user.role); return createGameTopupRequest(ctx.user.id, input); })),
    createDeposit: registeredProcedure.input(z.object({
      gameId: z.number().int().positive(),
      amount: money,
      userGameId: z.string().trim().min(2).max(120),
      idempotencyKey: z.string().trim().min(12).max(80),
    }).strict()).mutation(({ ctx, input }) => paymentAction(async () => { await assertServiceEnabled("game_topup", ctx.user.role); return createGameDepositRequest(ctx.user.id, input); })),
    createWithdraw: registeredProcedure.input(z.object({
      gameId: z.number().int().positive(),
      amount: money,
      userGameId: z.string().trim().min(2).max(120),
      withdrawalCode: z.string().trim().min(2).max(160),
      idempotencyKey: z.string().trim().min(12).max(80),
    }).strict()).mutation(({ ctx, input }) => paymentAction(async () => { await assertServiceEnabled("game_topup", ctx.user.role); return createGameWithdrawRequest(ctx.user.id, input); })),
    cancel: protectedProcedure.input(z.object({ requestId: z.number().int().positive() }).strict()).mutation(({ ctx, input }) => paymentAction(() => cancelGameTopupRequest(ctx.user.id, input.requestId))),
    adminRequests: adminProcedure.input(z.object({
      status: z.enum(["all", "pending", "archive", "new", "under_review", "approved", "processing", "completed", "rejected", "cancelled"]).optional(),
      search: z.string().trim().max(100).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(100000).optional(),
    }).strict().optional()).query(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => listAdminGameTopupRequests(input ?? {})); }),
    adminCatalog: adminProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getAdminGameTopupCatalog()); }),
    review: adminProcedure.input(z.object({
      requestId: z.number().int().positive(),
      status: z.enum(["under_review", "approved", "processing", "completed", "rejected"]),
      rejectionReason: z.string().trim().max(500).optional(),
      providerReference: z.string().trim().max(150).optional(),
      adminNote: z.string().trim().max(1000).optional(),
    }).strict()).mutation(({ ctx, input }) => paymentAction(() => reviewGameTopupRequest(ctx.user.id, input))),
    saveGame: adminProcedure.input(z.object({
      id: z.number().int().positive().optional(),
      slug: z.string().trim().max(64).optional(),
      name: z.string().trim().min(2).max(80),
      serviceType: z.enum(["topup", "deposit_withdraw"]).optional(),
      currencyLabel: z.string().trim().min(1).max(24),
      minQuantity: z.number().int().min(1).max(1_000_000),
      unitPrice: money,
      fields: z.array(gameTopupFieldSchema).min(1).max(8),
      sortOrder: z.number().int().min(0).max(9999),
      isActive: z.boolean(),
      depositFeeEnabled: z.boolean().optional(),
      depositFeeAmount: money.optional(),
      depositFeeMin: money.optional(),
      depositFeeMax: money.optional(),
      minDepositAmount: money.optional(),
      minWithdrawAmount: money.optional(),
      withdrawEnabled: z.boolean().optional(),
      withdrawalInstructions: z.string().trim().max(3000).optional(),
      cityLabel: z.string().trim().max(60).optional(),
      cityPlaceholder: z.string().trim().max(120).optional(),
      cityValue: z.string().trim().max(160).optional(),
      streetLabel: z.string().trim().max(60).optional(),
      streetPlaceholder: z.string().trim().max(120).optional(),
      streetValue: z.string().trim().max(240).optional(),
      withdrawalCodeLabel: z.string().trim().max(80).optional(),
      userIdFieldLabel: z.string().trim().max(60).optional(),
    }).strict()).mutation(({ ctx, input }) => paymentAction(() => saveGameTopupGame(ctx.user.id, input))),
    deleteGame: adminProcedure.input(z.object({ gameId: z.number().int().positive() }).strict()).mutation(({ input }) => paymentAction(() => deleteGameTopupGame(input.gameId))),
    savePackage: adminProcedure.input(z.object({
      id: z.number().int().positive().optional(),
      gameId: z.number().int().positive(),
      label: z.string().trim().max(80).optional(),
      quantity: z.number().int().min(1).max(10_000_000),
      price: money,
      sortOrder: z.number().int().min(0).max(9999),
      isActive: z.boolean(),
    }).strict()).mutation(({ input }) => paymentAction(() => saveGameTopupPackage(input))),
    deletePackage: adminProcedure.input(z.object({ packageId: z.number().int().positive() }).strict()).mutation(({ input }) => paymentAction(() => deleteGameTopupPackage(input.packageId))),
    updateSettings: adminProcedure.input(z.object({ enabled: z.boolean(), feeEnabled: z.boolean(), feeAmount: money, feeMin: money, feeMax: money }).strict()).mutation(({ input }) => paymentAction(() => updateGameTopupSettings(input))),
    addFunding: adminProcedure.input(z.object({ amount: money, source: z.string().trim().min(2).max(200), operationId: z.string().trim().min(12).max(80) }).strict()).mutation(({ ctx, input }) => paymentAction(() => addGameTopupFunding(ctx.user.id, input))),
    uploadImage: adminProcedure.input(z.object({ gameId: z.number().int().positive(), dataUrl: z.string().max(2_200_000) }).strict()).mutation(({ input }) => paymentAction(() => saveGameTopupImage(input.gameId, input.dataUrl))),
    clearImage: adminProcedure.input(z.object({ gameId: z.number().int().positive() }).strict()).mutation(({ input }) => paymentAction(() => clearGameTopupImage(input.gameId))),
  }),
  accountVerification: router({
    status: protectedProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getMyAccountVerificationStatus(ctx.user.id)); }),
    submit: registeredProcedure.input(accountVerificationImagesInput).mutation(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => submitAccountVerification(ctx.user.id, input)); }),
  }),
  transfers: router({
    lookupRecipient: registeredProcedure.input(z.object({customerId:z.string().regex(/^\d{10}$/)})).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>lookupTransferRecipient(ctx.user.id,input.customerId));}),
    mine: registeredProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listMyMoneyTransfers(ctx.user.id));}),
    create: registeredProcedure.input(z.object({recipientCustomerId:z.string().regex(/^\d{10}$/),amount:money,note:z.string().trim().max(300).optional(),operationId:z.string().min(12).max(80),securityPin:z.string().regex(/^\d{4}$/,"رمز الأمان يجب أن يتكون من 4 أرقام")})).mutation(({ctx,input})=>paymentAction(async()=>{ await assertServiceEnabled("transfer", ctx.user.role); return createMoneyTransfer(ctx.user.id,input); })),
    cancel: registeredProcedure.input(z.object({transferId:z.number().int().positive()})).mutation(({ctx,input})=>paymentAction(()=>cancelMoneyTransfer(ctx.user.id,input.transferId))),
  }),
  securityPin: router({
    status: protectedProcedure.query(({ctx})=>paymentAction(()=>getSecurityPinStatus(ctx.user.id))),
    set: protectedProcedure.input(z.object({newPin:z.string().regex(/^\d{4}$/),currentPin:z.string().regex(/^\d{4}$/).optional()})).mutation(({ctx,input})=>paymentAction(()=>setSecurityPin(ctx.user.id,input.newPin,input.currentPin))),
    reset: protectedProcedure.input(z.object({newPin:z.string().regex(/^\d{4}$/)})).mutation(({ctx,input})=>paymentAction(()=>resetSecurityPinAfterVerification(ctx.user.id,input.newPin))),
  }),
  support: router({
    mine: protectedProcedure.input(z.object({category:z.enum(ACTIVE_SUPPORT_CATEGORIES)}).optional()).query(({ctx,input})=>paymentAction(()=>listMySupportMessages(ctx.user.id,input?.category ?? "account"))),
    send: protectedProcedure.input(z.object({category:z.enum(ACTIVE_SUPPORT_CATEGORIES).optional(),body:z.string().trim().max(2000),attachment:verificationImage.optional(),attachments:z.array(verificationImage).max(4).optional()})).mutation(({ctx,input})=>paymentAction(async()=>{ await assertServiceEnabled("support", ctx.user.role); return sendSupportMessage(ctx.user.id,input.body,input.attachment,input.category ?? "account",input.attachments); })),
  }),
  frozenSupport: router({
    mine: frozenSupportProcedure.query(({ctx})=>paymentAction(()=>listMySupportMessages(ctx.user.id,"freeze"))),
    send: frozenSupportProcedure.input(z.object({body:z.string().trim().max(2000),attachment:verificationImage.optional(),attachments:z.array(verificationImage).max(4).optional()})).mutation(({ctx,input})=>paymentAction(()=>sendSupportMessage(ctx.user.id,input.body,input.attachment,"freeze",input.attachments))),
  }),
  externalTransfers: router({
    mine: registeredProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listMyExternalTransferRequests(ctx.user.id));}),
    pricing: registeredProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getExternalTransferPricing());}),
    create: registeredProcedure.input(z.object({countryCode:z.string().regex(/^[A-Z]{2}$/),amount:z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),clientOperationId:z.string().trim().min(12).max(100)}).strict()).mutation(({ctx,input})=>paymentAction(async()=>{ await assertServiceEnabled("external_transfer", ctx.user.role); return createExternalTransferRequest(ctx.user.id,input); })),
  }),
  notifications: router({
    list: protectedProcedure.query(({ctx})=>db.listNotifications(ctx.user.id)),
    successful: registeredProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return db.listSuccessfulTransactions(ctx.user.id);}),
    markSuccessfulRead: registeredProcedure.input(z.object({reference:z.string().min(1).max(80)}).strict()).mutation(({ctx,input})=>db.markSuccessfulTransactionRead(ctx.user.id,input.reference)),
    unreadCount: protectedProcedure.query(({ctx})=>db.unreadNotificationCount(ctx.user.id)),
    markDelivered: protectedProcedure.input(z.object({notificationId:z.number().int().positive()})).mutation(({ctx,input})=>db.markNotificationDelivered(ctx.user.id,input.notificationId)),
    markRead: protectedProcedure.input(z.object({notificationId:z.number()})).mutation(({ctx,input})=>db.markNotificationRead(ctx.user.id,input.notificationId)),
  }),
  market: router({status:publicProcedure.query(()=>getReadiness().marketData),instruments:publicProcedure.query(()=>db.listMarketInstruments()),quotes:publicProcedure.input(z.object({symbol:z.string().max(32).optional()}).optional()).query(({input})=>db.latestMarketQuotes(input?.symbol)),gold: router({status:publicProcedure.query(()=>getGoldStatus()),prices:publicProcedure.query(()=>listGoldPrices()),refresh:adminProcedure.mutation(()=>refreshGoldPrices()),preview:registeredProcedure.input(z.object({karat:z.enum(["24","21","18"]),side:z.enum(["buy","sell"]),grams:z.string().regex(/^\d+(\.\d{1,6})?$/)})).query(({ctx,input})=>paymentAction(async()=>{ await assertServiceEnabled("gold", ctx.user.role); return getGoldOrderPreview(input); })),mine:registeredProcedure.query(({ctx})=>listMyGold(ctx.user.id)),createOrder:registeredProcedure.input(z.object({karat:z.enum(["24","21","18"]),side:z.enum(["buy","sell"]),grams:z.string().regex(/^\d+(\.\d{1,6})?$/),securityPin:z.string().regex(/^\d{4}$/),idempotencyKey:z.string().min(12).max(120)})).mutation(({ctx,input})=>paymentAction(async()=>{ await assertServiceEnabled("gold", ctx.user.role); return createGoldOrder(ctx.user.id,input); }))})}),
  trading: router({orders:protectedProcedure.query(({ctx})=>db.getOrders(ctx.user.id)),createIntent:registeredProcedure.input(z.object({symbol:z.string().min(1).max(32),side:z.enum(["buy","sell"]),orderType:z.enum(["market","limit"]),quantity:z.string().regex(/^\d+(\.\d{1,6})?$/),limitPrice:z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),idempotencyKey:z.string().min(12).max(120)})).mutation(({ctx,input})=>paymentAction(async()=>{ await assertServiceEnabled("trading", ctx.user.role); return db.createOrderIntent(ctx.user.id,input); }))}),
  shareFile: protectedProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getUserShareFile());}),
  admin: router({
    serviceControls: adminProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return getServiceControls(); }),
    setServiceControl: adminProcedure.input(z.object({ id: z.enum(SERVICE_CONTROL_IDS), enabled: z.boolean() }).strict()).mutation(({ ctx, input }) => updateServiceControl(ctx.user.id, input.id as ServiceControlId, input.enabled)),
    setAllServiceControls: adminProcedure.input(z.object({ enabled: z.boolean() }).strict()).mutation(({ ctx, input }) => updateAllServiceControls(ctx.user.id, input.enabled)),
    buttonLayout: router({
      save: adminProcedure.input(z.object({ surface: z.enum(["home", "wallet"]), layout: z.object({ version: z.literal(1), positions: z.array(z.object({ id: z.string().max(64), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).max(20) }).strict() }).strict()).mutation(({ ctx, input }) => paymentAction(() => writeButtonLayout(ctx.user.id, input.surface, input.layout))),
      reset: adminProcedure.input(z.object({ surface: z.enum(["home", "wallet"]) }).strict()).mutation(({ ctx, input }) => paymentAction(() => writeButtonLayout(ctx.user.id, input.surface, null))),
      audit: adminProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getButtonLayoutAudit(ctx.user.id)); }),
    }),
    updateHomeActionOrder: adminProcedure.input(z.object({ order: z.array(z.enum(HOME_ACTION_ORDER_IDS)).length(4).refine((ids) => new Set(ids).size === HOME_ACTION_ORDER_IDS.length, "يجب إدراج كل زر مرة واحدة") }).strict()).mutation(({ ctx, input }) => paymentAction(() => updateHomeActionOrder(ctx.user.id, input.order))),
    customerHomeActionOrder: router({
      get: adminProcedure.input(z.object({ userId: z.number().int().positive() }).strict()).query(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getAdminCustomerHomeActionOrder(ctx.user.id, input.userId)); }),
      set: adminProcedure.input(z.object({ userId: z.number().int().positive(), order: z.array(z.enum(HOME_ACTION_ORDER_IDS)).length(4).refine((ids) => new Set(ids).size === HOME_ACTION_ORDER_IDS.length, "يجب إدراج كل زر مرة واحدة") }).strict()).mutation(({ ctx, input }) => paymentAction(() => setCustomerHomeActionOrder(ctx.user.id, input.userId, input.order))),
      reset: adminProcedure.input(z.object({ userId: z.number().int().positive() }).strict()).mutation(({ ctx, input }) => paymentAction(() => resetCustomerHomeActionOrder(ctx.user.id, input.userId))),
    }),
    uiButtonVisibility: router({
      global: adminProcedure.query(({ ctx }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getAdminGlobalUiButtonVisibility()); }),
      customer: adminProcedure.input(z.object({ userId: z.number().int().positive() }).strict()).query(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getAdminCustomerUiButtonVisibility(input.userId)); }),
      audit: adminProcedure.input(z.object({ targetUserId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).optional() }).strict()).query(({ ctx, input }) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getUiButtonVisibilityAudit(input)); }),
      setGlobal: adminProcedure.input(z.object({ surface: z.enum(["home", "wallet"]), buttonId: z.string().trim().min(1).max(64), visible: z.boolean(), reason: z.string().trim().max(500).optional() }).strict()).mutation(({ ctx, input }) => paymentAction(() => setGlobalUiButtonVisibility(ctx.user.id, input))),
      setCustomer: adminProcedure.input(z.object({ userId: z.number().int().positive(), surface: z.enum(["home", "wallet"]), buttonId: z.string().trim().min(1).max(64), mode: z.enum(["inherit", "visible", "hidden"]), reason: z.string().trim().max(500).optional() }).strict()).mutation(({ ctx, input }) => paymentAction(() => setCustomerUiButtonVisibility(ctx.user.id, input))),
    }),
    recentOperations: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(10_000).optional(), pendingOnly: z.boolean().optional(), historyOnly: z.boolean().optional(), search: z.string().trim().max(100).optional(), section: z.enum(["requests", "savings", "gold", "coin", "externalTransfers", "gameTopup", "accountVerification", "phoneChange", "phoneVerification", "supportMessaging", "guestSupport"]).optional() }).strict().optional()).query(async ({ ctx, input }) => {
      ctx.res.setHeader("Cache-Control", "private, no-store");
      try { return await getRecentOperations(input ?? {}, ctx.user.id); }
      catch (error) {
        logAdminReadFailure("recentOperations", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر تحميل أحدث العمليات؛ أعد المحاولة." });
      }
    }),
    requestDetails: adminProcedure.input(adminRequestDetailsInputSchema).query(({ctx,input}) => { ctx.res.setHeader("Cache-Control", "private, no-store"); return paymentAction(() => getAdminRequestDetails(ctx.user.id,input)); }),
    stats:adminProcedure.query(()=>db.adminStats()),limits:adminProcedure.query(()=>db.getOperationLimits()),
    customerSupportSettings:adminProcedure.query(({ ctx })=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getCustomerSupportSettings());}),
    updateCustomerSupportSettings:adminProcedure.input(customerSupportSettingsSchema).mutation(({ctx,input})=>paymentAction(()=>updateCustomerSupportSettings(ctx.user.id,input))),
    androidUpdatePolicy:adminProcedure.query(()=>paymentAction(()=>getAndroidUpdatePolicy())),
    androidUpdateUploadUrl:adminProcedure.input(z.object({version:z.string().trim().max(32),buildNumber:z.number().int().positive().max(2_147_483_647),fileName:z.string().trim().min(1).max(255),fileSize:z.number().int().positive()})).mutation(({ctx,input})=>paymentAction(()=>createAndroidUpdateUploadUrl(ctx.user.id,input))),
    updateLimits:adminProcedure.input(limitsSchema).mutation(({ctx,input})=>paymentAction(()=>db.updateOperationLimits(ctx.user.id,input))),
    goldDashboard:adminProcedure.query(({ctx})=>paymentAction(()=>getAdminGoldDashboard(ctx.user.id))),
    updateGoldSettings:adminProcedure.input(z.object({enabled:z.boolean(),buyFee:z.string().regex(/^\d+(\.\d{1,2})?$/),sellFee:z.string().regex(/^\d+(\.\d{1,2})?$/),buySpreadPerGram:z.string().regex(/^\d+(\.\d{1,4})?$/),sellSpreadPerGram:z.string().regex(/^\d+(\.\d{1,4})?$/),makingChargePerGram:z.string().regex(/^\d+(\.\d{1,4})?$/),minGrams:z.string().regex(/^\d+(\.\d{1,6})?$/),maxGrams:z.string().regex(/^\d+(\.\d{1,6})?$/)})).mutation(({ctx,input})=>paymentAction(()=>updateGoldSettings(ctx.user.id,input))),
    goldInventoryEntry:adminProcedure.input(z.object({karat:z.enum(["24","21","18"]),direction:z.enum(["credit","debit"]),grams:z.string().regex(/^\d+(\.\d{1,6})?$/),cashAmount:z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),source:z.string().trim().min(2).max(180),idempotencyKey:z.string().min(12).max(120)})).mutation(({ctx,input})=>paymentAction(()=>recordGoldInventoryEntry(ctx.user.id,input))),
    reviewGoldOrder:adminProcedure.input(z.object({orderId:z.number().int().positive(),decision:z.enum(["awaiting_execution","rejected"]),reason:z.string().trim().max(500).optional()})).mutation(({ctx,input})=>paymentAction(()=>reviewGoldOrder(ctx.user.id,input.orderId,input.decision,input.reason))),
    coinDashboard:adminProcedure.query(() => paymentAction(() => getAdminCoinDashboard())),
    updateCoinSettings:adminProcedure.input(z.object({buyPrice:z.string().regex(/^\d+(\.\d{1,2})?$/),sellPrice:z.string().regex(/^\d+(\.\d{1,2})?$/),buyFee:z.string().regex(/^\d+(\.\d{1,2})?$/),sellFee:z.string().regex(/^\d+(\.\d{1,2})?$/),transferMinimum:z.string().regex(/^\d+(\.\d{1,6})?$/),buyFeeEnabled:z.boolean(),sellFeeEnabled:z.boolean(),reason:z.string().trim().max(240).optional(),updatedAt:z.union([z.string(),z.date()]).optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>updateCoinSettings(ctx.user.id,input))),
    coinInventoryEntry:adminProcedure.input(z.object({quantity:z.string().regex(/^\d+(\.\d{1,6})?$/),direction:z.enum(["credit","debit"]),source:z.string().trim().min(2).max(200),idempotencyKey:z.string().min(12).max(120)}).strict()).mutation(({ctx,input})=>paymentAction(()=>recordCoinInventory(ctx.user.id,input))),
    adjustUserCoinBalance:adminProcedure.input(z.object({targetUserId:z.number().int().positive(),quantity:z.string().regex(/^[+-]?\d+(\.\d{1,6})?$/),reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().trim().min(4).max(120)}).strict()).mutation(({ctx,input})=>paymentAction(()=>adjustUserCoinBalance(ctx.user.id,input.targetUserId,input.quantity,input.reason,input.idempotencyKey))),
    coinSalesFunding:adminProcedure.input(z.object({amount:z.string().regex(/^\d+(\.\d{1,2})?$/),source:z.string().trim().min(2).max(200),idempotencyKey:z.string().min(12).max(120)}).strict()).mutation(({ctx,input})=>paymentAction(()=>fundCoinSales(ctx.user.id,input))),
    reviewCoinOrder:adminProcedure.input(z.object({orderId:z.number().int().positive(),decision:z.enum(["approved","rejected"]),rejectionReason:z.string().trim().max(500).optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>reviewCoinOrder(ctx.user.id,input.orderId,input.decision,input.rejectionReason))),
    reviewCoinTransfer:adminProcedure.input(z.object({transferId:z.number().int().positive(),decision:z.enum(["approved","rejected"]),rejectionReason:z.string().trim().max(500).optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>reviewCoinTransfer(ctx.user.id,input.transferId,input.decision,input.rejectionReason))),
    updateAndroidUpdatePolicy:adminProcedure.input(z.object({
      enabled:z.boolean(),
      version:z.string().trim().max(32).refine((value)=>!value||isReleaseVersion(value),"رقم الإصدار يجب أن يكون بصيغة مثل 1.0.1"),
      buildNumber:z.number().int().nonnegative().max(2_147_483_647),
      storageKey:z.string().trim().max(512),
      releaseNotes:z.string().trim().max(4000),
      mandatory:z.boolean(),
    })).mutation(({ctx,input})=>paymentAction(()=>updateAndroidUpdatePolicy(ctx.user.id,{...input,downloadUrl:""}))),
    paymentMethodsAdmin:adminProcedure.query(({ctx})=>paymentAction(()=>getAdminPaymentMethods(ctx.user.id))),
    paymentServiceStatus:adminProcedure.query(({ctx})=>paymentAction(()=>getPaymentServiceStatus())),
    updatePaymentServiceStatus:adminProcedure.input(z.object({depositEnabled:z.boolean().optional(),withdrawalEnabled:z.boolean().optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>updatePaymentServiceStatus(ctx.user.id,input))),
    createPaymentMethod:adminProcedure.input(z.object({name:z.string().trim().min(2).max(40),transferNumber:z.string().trim().max(120),imageData:image.optional(),fields:paymentMethodFieldsSchema.optional(),depositFields:paymentMethodFieldsSchema.optional(),withdrawalFields:paymentMethodFieldsSchema.optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>createPaymentMethod(ctx.user.id,input))),
    updatePaymentMethod:adminProcedure.input(z.object({id:z.string().regex(/^[a-z][a-z0-9_]{1,19}$/),name:z.string().trim().min(1).max(40),transferNumber:z.string().trim().max(120),imageData:image.optional(),fields:paymentMethodFieldsSchema.optional(),depositFields:paymentMethodFieldsSchema.optional(),withdrawalFields:paymentMethodFieldsSchema.optional(),enabled:z.boolean().optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>updatePaymentMethod(ctx.user.id,input))),
    deletePaymentMethod:adminProcedure.input(z.object({id:z.string().regex(/^[a-z][a-z0-9_]{1,19}$/)})).mutation(({ctx,input})=>paymentAction(()=>deletePaymentMethod(ctx.user.id,input.id))),
    contactButtonsAdmin:adminProcedure.query(({ctx})=>paymentAction(()=>getAdminContactButtons(ctx.user.id))),
    createContactButton:adminProcedure.input(contactButtonInputSchema).mutation(({ctx,input})=>paymentAction(()=>createContactButton(ctx.user.id,input))),
    updateContactButton:adminProcedure.input(z.object({id:contactButtonId}).merge(contactButtonInputSchema)).mutation(({ctx,input})=>{const {id,...button}=input;return paymentAction(()=>updateContactButton(ctx.user.id,id,button));}),
    deleteContactButton:adminProcedure.input(z.object({id:contactButtonId})).mutation(({ctx,input})=>paymentAction(()=>deleteContactButton(ctx.user.id,input.id))),
    reorderContactButtons:adminProcedure.input(z.object({ids:z.array(contactButtonId).max(100)})).mutation(({ctx,input})=>paymentAction(()=>reorderContactButtons(ctx.user.id,input.ids))),
    customerPaymentMethodAccess:adminProcedure.input(z.object({userId:z.number().int().positive()})).query(({ctx,input})=>paymentAction(()=>getCustomerPaymentMethodAccess(ctx.user.id,input.userId))),
    setCustomerPaymentMethodBlocked:adminProcedure.input(z.object({userId:z.number().int().positive(),methodId:z.string().regex(/^[a-z][a-z0-9_]{1,19}$/),blocked:z.boolean()})).mutation(({ctx,input})=>paymentAction(()=>setCustomerPaymentMethodBlocked(ctx.user.id,input.userId,input.methodId,input.blocked))),
    setCustomerPaymentMethodDirection:adminProcedure.input(z.object({userId:z.number().int().positive(),methodId:z.string().regex(/^[a-z][a-z0-9_]{1,19}$/),direction:z.enum(["deposit","withdrawal"]),enabled:z.boolean()}).strict()).mutation(({ctx,input})=>paymentAction(()=>setCustomerPaymentMethodDirection(ctx.user.id,input.userId,input.methodId,input.direction,input.enabled))),
    customerAccountStatusEvents:adminProcedure.input(z.object({userId:z.number().int().positive()}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAccountStatusEvents(ctx.user.id,input.userId));}),
    restoreDeletedCustomerAccount:adminProcedure.input(z.object({userId:z.number().int().positive(),reason:z.string().trim().min(3).max(500)}).strict()).mutation(({ctx,input})=>paymentAction(()=>restoreDeletedCustomerAccount(ctx.user.id,input.userId,input.reason))),
    setCustomerAccountFrozen:adminProcedure.input(z.object({userId:z.number().int().positive(),frozen:z.boolean()})).mutation(({ctx,input})=>paymentAction(()=>setCustomerAccountFrozen(ctx.user.id,input.userId,input.frozen))),
    phoneVerificationContacts:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getPhoneVerificationContacts());}),
    updatePhoneVerificationContacts:adminProcedure.input(phoneVerificationContactsSchema).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>updatePhoneVerificationContacts(ctx.user.id,input));}),
    phoneVerificationUsers:adminProcedure.input(phoneVerificationSearchSchema).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listPhoneVerificationUsers(ctx.user.id,input.search));}),
    customerProfileAudits:adminProcedure.input(z.object({userId:z.number().int().positive()})).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listUserProfileAudits(ctx.user.id,input.userId));}),
    updateCustomerProfile:adminProcedure.input(adminCustomerProfileSchema).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>updateCustomerProfileByAdmin(ctx.user.id,input));}),
    customerNationalId:adminProcedure.input(z.object({userId:z.number().int().positive()}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getAdminCustomerNationalId(ctx.user.id,input.userId));}),
    setCustomerAccountVerification:adminProcedure.input(z.object({userId:z.number().int().positive(),status:z.enum(["manual_verified","revoked"]),reason:z.string().trim().max(500).optional()}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>setAdminAccountVerificationStatus(ctx.user.id,input.userId,input.status,input.reason));}),
    reviewPhoneVerificationRequest:adminProcedure.input(phoneVerificationReviewSchema).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>reviewPhoneVerificationRequest(ctx.user.id,input));}),
    accountVerificationSettings:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getAdminAccountVerificationSettings(ctx.user.id));}),
    updateAccountVerificationSettings:adminProcedure.input(z.object({requiredBeforeMoney:z.boolean()}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>updateAdminAccountVerificationSettings(ctx.user.id,input.requiredBeforeMoney));}),
    accountVerificationRequests:adminProcedure.input(z.object({status:z.enum(["all","pending","approved","rejected"]).optional()}).optional()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAdminAccountVerificationRequests(ctx.user.id,input?.status??"pending"));}),
    notifications:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAdminNotifications(ctx.user.id));}),
    sendNotification:adminProcedure.input(z.object({userId:z.number().int().positive().optional(),customerId:z.string().regex(/^\d{10}$/).optional(),title:z.string().trim().min(2).max(160),body:z.string().trim().min(2).max(4000)}).strict().superRefine((input,ctx)=>{if(input.userId&&input.customerId)ctx.addIssue({code:"custom",path:["customerId"],message:"اختر رقم الحساب أو المعرف الداخلي، وليس كليهما"});})).mutation(({ctx,input})=>paymentAction(()=>sendAdminNotification(ctx.user.id,input))),
    supportConversations:adminProcedure.input(z.object({category:z.enum(SUPPORT_CATEGORIES)}).strict().optional()).query(({ctx,input})=>paymentAction(()=>listAdminSupportConversations(ctx.user.id,input?.category))),
    supportMessages:adminProcedure.input(z.object({userId:z.number().int().positive(),category:z.enum(SUPPORT_CATEGORIES)}).strict()).query(({ctx,input})=>paymentAction(()=>listAdminSupportMessages(ctx.user.id,input.userId,input.category))),
    closeSupportConversation:adminProcedure.input(z.object({userId:z.number().int().positive(),category:z.enum(SUPPORT_CATEGORIES)}).strict()).mutation(({ctx,input})=>paymentAction(()=>closeSupportConversation(ctx.user.id,input.userId,input.category))),
    replySupport:adminProcedure.input(z.object({userId:z.number().int().positive(),category:z.enum(SUPPORT_CATEGORIES),body:z.string().trim().max(2000),attachment:verificationImage.optional(),attachments:z.array(verificationImage).max(4).optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>replyToSupportMessage(ctx.user.id,input.userId,input.category,input.body,input.attachment,input.attachments))),
    externalTransferRequests:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAdminExternalTransferRequests(ctx.user.id));}),
    externalTransferPricing:adminProcedure.query(()=>paymentAction(()=>getExternalTransferPricing())),
    updateExternalTransferPricing:adminProcedure.input(z.object({currencyCode:z.enum(["LYD","SDG","KWD","AED","SAR","EUR"]),rate:z.string().regex(/^\d+(?:\.\d{1,6})?$/),feeEgp:z.string().regex(/^\d+(?:\.\d{1,2})?$/)}).strict()).mutation(({ctx,input})=>paymentAction(()=>updateExternalTransferPricing(ctx.user.id,input))),
    updateExternalTransferStatus:adminProcedure.input(z.object({requestId:z.number().int().positive(),status:z.enum(["new","under_review","awaiting_details","approved","completed","rejected"]),rejectionReason:z.string().trim().max(500).optional()}).strict()).mutation(({ctx,input})=>paymentAction(()=>updateExternalTransferStatus(ctx.user.id,input.requestId,input.status,input.rejectionReason))),
    guestSupportTickets:adminProcedure.query(async ({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");try{return await listGuestTickets(ctx.user.id);}catch(error){logAdminReadFailure("guestSupportTickets",error);throw new TRPCError({code:"INTERNAL_SERVER_ERROR",message:"تعذر تحميل مراسلات الزوار؛ لم يتم تأكيد خلو الصندوق. أعد المحاولة."});}}),
    guestSupportMessages:adminProcedure.input(z.object({ticketId:z.number().int().positive()}).strict()).query(async ({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");try{return await listGuestMessagesForAdmin(ctx.user.id,input.ticketId);}catch(error){logAdminReadFailure("guestSupportMessages",error);throw new TRPCError({code:"INTERNAL_SERVER_ERROR",message:"تعذر فتح محادثة الزائر؛ أعد المحاولة."});}}),
    replyGuestSupport:adminProcedure.input(z.object({ticketId:z.number().int().positive(),body:z.string().trim().max(2000),attachment:z.object({data:z.string().max(2_800_000),mimeType:z.enum(["image/jpeg","image/png","application/pdf"])}).strict().optional(),operationId:z.string().regex(/^[A-Za-z0-9_-]{12,100}$/).optional()}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>replyToGuestTicket(ctx.user.id,input.ticketId,input.body,input.attachment,input.operationId));}),
    updateGuestSupportStatus:adminProcedure.input(z.object({ticketId:z.number().int().positive(),status:z.enum(["new","pending_reply","replied","closed"])}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>setGuestTicketStatus(ctx.user.id,input.ticketId,input.status));}),
    securityPinStatus:adminProcedure.input(z.object({userId:z.number().int().positive()})).query(({ctx,input})=>paymentAction(()=>getAdminSecurityPinStatus(ctx.user.id,input.userId))),

    phoneChangeRequests:adminProcedure.input(z.object({status:z.enum(["all","pending","approved","rejected"]).optional()}).optional()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAdminPhoneChangeRequests(ctx.user.id,input?.status??"pending"));}),
    phoneChangeDocuments:adminProcedure.input(z.object({requestId:z.number().int().positive()}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getAdminPhoneChangeDocuments(ctx.user.id,input.requestId));}),
    reviewPhoneChange:adminProcedure.input(z.object({requestId:z.number().int().positive(),decision:z.enum(["approve","reject"]),rejectionReason:z.string().trim().max(500).optional()}).superRefine((input,ctx)=>{if(input.decision==="reject"&&(!input.rejectionReason||input.rejectionReason.length<3))ctx.addIssue({code:"custom",path:["rejectionReason"],message:"سبب الرفض إلزامي"});})).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>reviewPhoneChangeRequest(ctx.user.id,input.requestId,input.decision,input.rejectionReason));}),

    accountVerificationDocuments:adminProcedure.input(z.object({userId:z.number().int().positive()}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getAdminAccountVerificationDocuments(ctx.user.id,input.userId));}),
    updateAccountVerificationProfile:adminProcedure.input(z.object({userId:z.number().int().positive(),name:z.string().trim().min(3).max(120),birthDate:dateOnly,phoneNumber:phoneNumberSchema}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>updateAccountVerificationProfile(ctx.user.id,input.userId,{name:input.name,birthDate:input.birthDate,phoneNumber:input.phoneNumber}));}),
    reviewAccountVerification:adminProcedure.input(z.object({userId:z.number().int().positive(),decision:z.enum(["approve","reject"]),rejectionReason:z.string().trim().max(500).optional()}).superRefine((input,ctx)=>{if(input.decision==="reject"&&(!input.rejectionReason||input.rejectionReason.length<3))ctx.addIssue({code:"custom",path:["rejectionReason"],message:"سبب الرفض إلزامي"});})).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>reviewAccountVerification(ctx.user.id,input.userId,input.decision,input.rejectionReason));}),
    updateFeePolicy:adminProcedure.input(feePolicySchema).mutation(({ctx,input})=>paymentAction(()=>updateFeePolicy(ctx.user.id,input))),
    receipt:adminProcedure.input(z.object({requestId:z.number().int().positive()})).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>db.getRequestReceipt(ctx.user.id,input.requestId,true));}),
    requests:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return db.adminRequests();}),
    pendingPaymentRequests:adminProcedure.input(z.object({type:z.enum(["deposit","withdrawal"]),limit:z.number().int().min(1).max(50),cursor:z.object({createdAt:z.string().datetime(),id:z.number().int().positive().max(2147483647)}).strict().optional()}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>db.adminPendingPaymentRequests(input));}),
    paymentRequestById:adminProcedure.input(z.object({requestId:z.number().int().positive().max(2147483647)}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>db.adminPaymentRequestById(input.requestId));}),
    paymentRequestArchive:adminProcedure.input(z.object({offset:z.number().int().min(0).max(1000000),limit:z.number().int().min(1).max(50)}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return db.adminPaymentRequestArchive(input.offset,input.limit);}),
    customers:adminProcedure.input(z.object({search:z.string().trim().max(100).optional()}).optional()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAdminCustomers(ctx.user.id,input?.search));}),
    findCustomer:adminProcedure.input(z.object({customerId:z.string().regex(/^\d{10}$/)}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>findAdminCustomer(ctx.user.id,input.customerId));}),
    topUp:adminProcedure.input(z.object({customerId:z.string().regex(/^\d{10}$/),amount:money,reason:z.string().trim().min(3).max(500),operationId:z.string().min(12).max(80)})).mutation(({ctx,input})=>paymentAction(()=>db.topUpByCustomerId(ctx.user.id,input.customerId,input.amount,input.reason,input.operationId))),
    updatePaymentInstructions:adminProcedure.input(z.object({transferNumber:z.string().trim().min(5).max(120)})).mutation(({ctx,input})=>db.updatePaymentInstructions(ctx.user.id,input.transferNumber)),
    reviewRequest:adminProcedure.input(z.object({requestId:z.number().int().positive(),status:z.enum(["approved","rejected","completed"]),confirmedTransfer:z.boolean().optional(),payoutReference:z.string().trim().min(3).max(150).optional(),depositReference:z.string().trim().min(3).max(150).optional(),rejectionReason:z.string().trim().max(500).optional()}).superRefine((input,ctx)=>{if(input.status==="rejected"&&(!input.rejectionReason||input.rejectionReason.length<3))ctx.addIssue({code:"custom",path:["rejectionReason"],message:"سبب الرفض إلزامي"});})).mutation(({ctx,input})=>paymentAction(()=>db.reviewRequest(input.requestId,ctx.user.id,input.status,{confirmedTransfer:input.confirmedTransfer,payoutReference:input.payoutReference,depositReference:input.depositReference,rejectionReason:input.rejectionReason}))),
    savings:adminProcedure.input(z.object({status:z.enum(["all","pending_approval","active","rejected","completed","refunded","cancelled"]).optional()}).optional()).query(({ctx,input})=>paymentAction(()=>listAdminSavingsPlans(ctx.user.id,input?.status))),
    savingsPayoutSchedules:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAdminSavingsPayoutSchedules(ctx.user.id));}),
    savingsTransactions:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listAdminSavingsTransactions(ctx.user.id));}),
    confirmSavingsPayout:adminProcedure.input(z.object({planId:z.number().int().positive()})).mutation(({ctx,input})=>paymentAction(()=>confirmSavingsPayout(ctx.user.id,input.planId))),
    savingsFinancingWallet:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getAdminSavingsFinancingWallet(ctx.user.id));}),
    addSavingsFinancing:adminProcedure.input(z.object({amount:money,source:z.string().trim().min(2).max(200),operationId:z.string().trim().min(12).max(100)})).mutation(({ctx,input})=>paymentAction(()=>addSavingsFinancing(ctx.user.id,input))),
    savingsSettings:adminProcedure.query(({ctx})=>paymentAction(()=>getAdminSavingsSettings(ctx.user.id))),
    updateSavingsSettings:adminProcedure.input(savingsSettingsInputSchema).mutation(({ctx,input})=>paymentAction(()=>updateSavingsSettings(ctx.user.id,input))),
    ensureSavingsPayoutSchedule:adminProcedure.mutation(()=>paymentAction(()=>ensureSavingsAutoPayoutHeartbeat())),
    reviewSavings:adminProcedure.input(z.object({planId:z.number().int().positive(),decision:z.enum(["approve","reject"]),rejectionReason:z.string().trim().max(500).optional()}).superRefine((input,ctx)=>{if(input.decision==="reject"&&(!input.rejectionReason||input.rejectionReason.length<3))ctx.addIssue({code:"custom",path:["rejectionReason"],message:"سبب الرفض إلزامي"});})).mutation(({ctx,input})=>paymentAction(()=>reviewSavingsPlan(ctx.user.id,input.planId,input.decision,input.rejectionReason))),
    moneyTransfers:adminProcedure.input(z.object({search:z.string().trim().max(100).optional(),status:z.enum(["all","pending","approved","rejected","cancelled"]).optional(),fromDate:dateOnly.optional(),toDate:dateOnly.optional(),offset:z.number().int().min(0).max(100000).optional(),limit:z.number().int().min(1).max(100).optional()}).superRefine((input,ctx)=>{if(input.fromDate&&input.toDate&&input.fromDate>input.toDate)ctx.addIssue({code:"custom",path:["toDate"],message:"تاريخ النهاية لا يمكن أن يسبق تاريخ البداية"});}).optional()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listMoneyTransfersForAdmin(ctx.user.id,input??{}));}),
    reviewMoneyTransfer:adminProcedure.input(z.object({transferId:z.number().int().positive(),action:z.enum(["approved","rejected"]),rejectionReason:z.string().trim().max(500).optional()}).superRefine((input,ctx)=>{if(input.action==="rejected"&&(!input.rejectionReason||input.rejectionReason.length<3))ctx.addIssue({code:"custom",path:["rejectionReason"],message:"سبب الرفض إلزامي"});})).mutation(({ctx,input})=>paymentAction(()=>reviewMoneyTransfer(ctx.user.id,input.transferId,input.action,input.rejectionReason))),
    adjustBalance:adminProcedure.input(z.object({targetUserId:z.number().int().positive(),amount:z.string().regex(/^-?\d+(\.\d{1,2})?$/),reason:z.string().trim().min(3).max(500),operationId:z.string().min(4).max(80)})).mutation(({ctx,input})=>paymentAction(()=>db.adjustBalance(ctx.user.id,input.targetUserId,input.amount,input.reason,input.operationId))),
    customerDetails:adminProcedure.input(z.object({userId:z.number().int().positive(),offset:z.number().int().min(0).max(100000).optional(),limit:z.number().int().min(1).max(50).optional()}).strict()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getAdminCustomerDetails(ctx.user.id,input.userId,input.offset,input.limit));}),
    customerSessions:adminProcedure.input(z.object({userId:z.number().int().positive()})).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>listDeviceSessions(input.userId));}),
    shareFile:protectedProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getUserShareFile());}),
    shareFileAdmin:adminProcedure.query(({ctx})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getUserShareFile());}),
    uploadShareFile:adminProcedure.input(z.object({fileName:z.string().trim().min(1).max(120),mimeType:z.enum(["application/pdf","image/jpeg","image/png","image/webp"]),data:z.string().min(16).max(11_200_000)}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","no-store");return paymentAction(()=>uploadUserShareFile(ctx.user.id,input));}),
    customerInvoice:adminProcedure.input(z.object({userId:z.number().int().positive()})).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getAdminCustomerInvoice(ctx.user.id,input.userId));}),
    sendCustomerEmail:adminProcedure.input(z.object({userId:z.number().int().positive(),subject:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(20_000)}).strict()).mutation(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>sendCustomerEmail(ctx.user.id,input));}),
    emailDeliveryHistory:adminProcedure.input(z.object({userId:z.number().int().positive().optional()}).strict().optional()).query(({ctx,input})=>{ctx.res.setHeader("Cache-Control","private, no-store");return paymentAction(()=>getEmailDeliveryHistory(ctx.user.id,input?.userId));}),
  }),
});
export type AppRouter = typeof appRouter;
