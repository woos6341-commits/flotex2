# ملخص ميزات واجهة العميل ولوحة التحكم

## ما تم تنفيذه

- أضيف زر **«مشاركة»** داخل اختصارات الحساب في `app/(tabs)/profile.tsx`.
  - يستدعي `shareFile.get`.
  - يكوّن الرابط من `getApiBaseUrl()` عند الحاجة.
  - ينزّل الملف إلى cache باستخدام `expo-file-system/legacy` ثم يفتحه عبر `expo-sharing` على native.
  - يستخدم `Share.share` و`window.open` على web.
  - يعرض رسائل عربية عند غياب الملف أو فشل التنزيل/المشاركة.
- أُنشئ `components/control/ShareFileAdmin.tsx` لرفع ملف المشاركة.
  - يدعم `expo-document-picker` وقراءة base64 على native عبر FileSystem legacy.
  - يدعم asset base64 وFileReader على web.
  - يعرض اسم الملف ويرسل `admin.uploadShareFile`.
- أضيف قسم **«ملف المشاركة»** إلى قائمة لوحة التحكم ونظرة المالك والتصديرات، وربط في `app/control.tsx`.
- أضيف إلى `CustomerDossier`:
  - زر **«إنشاء فاتورة»** يستدعي `admin.customerInvoice` ويعرض بطاقة عربية منظمة للهوية والرصيد والإجماليات والعمليات.
  - التقاط البطاقة PNG عبر `react-native-view-shot`، حفظها في cache، محاولة حفظها في المعرض بعد طلب الإذن، ثم مشاركة fallback عبر `expo-sharing`.
  - نموذج عنوان/محتوى لإرسال البريد عبر `admin.sendCustomerEmail`.
  - حالة نجاح/فشل وآخر سجل مختصر عبر `admin.emailDeliveryHistory`.
- أضيف plugin `expo-media-library` برسالة إذن عربية في `app.config.ts`.

## التحقق

- تم تشغيل `pnpm check` بنجاح.
- تم تشغيل `git diff --check` بنجاح.
- لم تُجرَ تعديلات مقصودة على `server/` أو `drizzle/`. توجد تغييرات سابقة/موجودة في المستودع ضمن تلك المسارات، وقد تركت كما هي.

## ملاحظة تكامل

الواجهة تستخدم أسماء إجراءات الخادم التي ستُضاف في طبقة `appRouter` كما طلبت المهمة. تم استخدام ربط مرن لبعض الإجراءات الجديدة حتى يظل فحص TypeScript ناجحًا قبل وصول تعريفات Router النهائية.
