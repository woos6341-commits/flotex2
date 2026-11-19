import { eq } from "drizzle-orm";
import { notifications, users } from "../drizzle/schema";
import {
  registrationSchema,
  type RegistrationInput,
} from "../shared/registration";
import { getDb } from "./db";
import { findUsersByPhone } from "./manual-auth";

export const PROFILE_LOCKED_MESSAGE =
  "بيانات التسجيل ثابتة ولا يمكن تعديلها بعد إكمال التسجيل";
export async function completeRegistration(
  userId: number,
  input: RegistrationInput,
) {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message ?? "تحقق من بيانات التسجيل",
    );
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    if (!user) throw new Error("الحساب غير موجود");
    const phoneMatches = await findUsersByPhone(tx, parsed.data.phoneNumber);
    if (phoneMatches.some((match) => match.id !== userId))
      throw new Error("رقم الهاتف مستخدم بالفعل لحساب عميل آخر");
    if (user.profileCompletedAt) {
      if (
        user.givenName !== parsed.data.givenName ||
        user.fatherName !== parsed.data.fatherName ||
        user.phoneNumber !== parsed.data.phoneNumber ||
        user.birthDate !== parsed.data.birthDate ||
        (parsed.data.governorate !== undefined && user.governorate !== parsed.data.governorate)
      )
        throw new Error(PROFILE_LOCKED_MESSAGE);
      return user;
    }
    if (user.phoneVerifiedAt && user.phoneNormalized !== parsed.data.phoneNumber) {
      throw new Error("رقم الهاتف موثّق وثابت؛ لا يمكن تغييره أثناء استكمال التسجيل");
    }
    if (!user.email)
      throw new Error("سجّل الدخول بحساب له بريد إلكتروني لإكمال التسجيل");
    const completedAt = new Date();
    await tx
      .update(users)
      .set({
        ...parsed.data,
        phoneNormalized: parsed.data.phoneNumber,
        ...(parsed.data.governorate ? { governorate: parsed.data.governorate } : {}),
        name: `${parsed.data.givenName} ${parsed.data.fatherName}`,
        profileCompletedAt: completedAt,
      })
      .where(eq(users.id, userId));
    await tx
      .insert(notifications)
      .values({
        userId,
        title: "تم تسجيل حسابك في Flotex EGP",
        body: "تم حفظ بيانات حسابك وربطها برقم العميل الخاص بك.",
        type: "registration",
        operationId: `profile:${userId}`,
      });
    const [saved] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return saved;
  });
}
