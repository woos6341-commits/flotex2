# ملخص ميزات الخادم والقاعدة

تم تنفيذ الميزات المطلوبة داخل طبقة الخادم ومخطط Drizzle فقط، دون تعديل ملفات `app/` أو `components/` أو `package.json` ودون إنشاء migration يدوي.

## ملف المشاركة

- أضيف المفتاح الثابت `user_share_file_v1` داخل `appSettings`.
- أضيفت خدمة `server/share-file.ts` لقراءة JSON المشاركة والتحقق من اسم الملف ونوعه وBase64 والحجم الأقصى (8 MiB)، ثم الرفع عبر `storagePut` وتحديث الإعداد مع `updatedAt`.
- أضيفت مسارات `shareFile` للمستخدم المحمي، و`shareFileAdmin` للإدارة، و`uploadShareFile` كـ admin mutation.
- استجابات القراءة والرفع تستخدم `Cache-Control: private, no-store` أو `no-store`.

## الفاتورة الإدارية

- أضيفت `getAdminCustomerInvoice(adminId, userId)` في `server/customer-invoice.ts`.
- تتحقق الخدمة من صلاحية المدير ووجود مستخدم عميل، ثم تعيد المستخدم والمحفظة وقائمة موحدة مرتبة زمنيًا تشمل المعاملات والطلبات والتحويلات الداخلية وخطط/دفعات الادخار والتحويلات الخارجية.
- كل عنصر يضم `reference`, `type`, `status`, `amount`, `fee`, `direction`, `currency`, `createdAt`, `note`، مع totals للائتمانات والخصومات والرسوم.
- لا تنفذ الخدمة أي تعديل مالي.

## البريد الإداري

- صُدّر `sendConfiguredEmail` من `server/manual-auth.ts`، ويعيد استخدام Nodemailer و`AUTH_OTP_APP_PASSWORD` من بيئة الخادم دون كشف السر.
- أضيف جدول `user_email_deliveries` إلى `drizzle/schema.ts` لتسجيل `reference`, `adminId`, `userId`, `toEmail`, `subject`, `body`, `status`, `error`, `createdAt`, `sentAt`.
- أضيفت خدمة `sendCustomerEmail` التي تبحث بريد العميل، تحفظ سجلًا pending، ترسل عبر Gmail، ثم تحدّثه إلى sent أو failed، إضافة إلى `getEmailDeliveryHistory`.

## مسارات الإدارة

أضيفت إلى كتلة الإدارة في `server/routers.ts`:

- `shareFileAdmin`
- `uploadShareFile`
- `customerInvoice`
- `sendCustomerEmail`
- `emailDeliveryHistory`

وأضيف مسار المستخدم المحمي `shareFile`. جميع المدخلات محدودة وآمنة عبر Zod، والمسارات الحساسة تستخدم `adminProcedure` و`paymentAction` وno-store حيث يلزم.

## التحقق

تم تشغيل `pnpm check` بنجاح دون أخطاء TypeScript في الحالة النهائية. ظهر تحذير pnpm المعتاد بأن إعدادات حقل `pnpm` في `package.json` لم تعد تُقرأ، ولم يتم تعديل الملف.
