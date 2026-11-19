# خيارات التكامل الإنتاجي — Atheer

> هذا التقرير يميّز بين ما تؤكده الصفحات الرسمية وما يحتاج عرضًا تجاريًا أو موافقة. لا توجد مفاتيح API داخل المشروع، والوضع الحالي هو `integrations_not_configured`.

## 1. بيانات سوق EGX

### الخيار الأقوى للتقييم الأول: ICE Data Services

- **الجهة:** ICE Data Services.
- **الرابط الرسمي:** https://developer.ice.com/fixed-income-data-services/catalog/egyptian-exchange-egx
- **ما هو مؤكد علنًا:** صفحة EGX لدى ICE تذكر بيانات equities/ETFs/bonds/indices، وLevel 1 وLevel 2، وبيانات intraday وhistorical/end-of-day، مع ICE Data API وICE Consolidated Feed وملفات البيانات.
- **الملاءمة:** مناسب تقنيًا لتغذية سوق مؤسسية، لكن يجب التحقق من حق إعادة النشر داخل تطبيق للعملاء ومن تغطية الأسهم المصرية المطلوبة.
- **التكلفة:** لا يوجد سعر منشور في الصفحة؛ يلزم طلب عرض من المبيعات وتحديد التغطية وreal-time/historical وعدد المستخدمين وحقوق redistribution.
- **الخطوة التالية:** إرسال وصف Atheer وعدد العملاء المتوقع واحتياج Level 1/Level 2 وhistorical إلى صفحة التواصل الرسمية: https://www.ice.com/catalog/fixed-income-data-services/contact-us?venue=EGX

### المصدر المباشر: EGX

- **الرابط الرسمي:** https://www.egx.com.eg/en/homepage.aspx
- **ما هو مؤكد علنًا:** EGX تنشر مؤشرات وملخص السوق وقائمة الشركات، وتوضح أن الأسعار المنشورة indicative ومقدمة من مزودين يتحملون مسؤولية البيانات.
- **المتطلب:** التواصل مع EGX بشأن Data Services/حقوق الترخيص أو استخدام مزود معتمد. لا ينبغي كشط الموقع أو إعادة نشره تجاريًا دون اتفاق.
- **التكلفة:** غير معلنة على الصفحة العامة.

## 2. الوساطة وتنفيذ أوامر EGX

لم أعثر في الصفحات العامة التي أمكن التحقق منها على API تجزئة مفتوح أو sandbox عام لشركة وساطة مصرية. لذلك القائمة التالية هي **جهات مرخصة/أعضاء محتملون للتواصل المؤسسي، وليست وعدًا بوجود API**:

- **Thndr Securities Brokerage:** https://thndr.app/ — موقع Thndr يذكر أن تداول الأوراق المالية المصرية يتم عبر Thndr Securities Brokerage المرخصة والمنظمة من FRA. توجد شراكة معلنة مع Alpaca Broker API للتجربة الاستثمارية، لكن ذلك لا يثبت أن API لأسهم EGX متاحًا لطرف ثالث؛ يجب طلب مؤسسة/embedded brokerage API وبيئة sandbox صراحة.
- **Beltone Securities Brokerage:** https://www.beltoneholding.com/business-line/securities-brokerage — الموقع الرسمي يصف نشاط الوساطة للمستثمرين الأفراد والمؤسسات. لا توجد في الصفحة العامة مواصفات API أو أسعار تكامل؛ يلزم طلب institutional connectivity/FIX أو API وsandbox.
- **قائمة أعضاء EGX الرسمية:** https://www.egx.com.eg/en/memberfirmslist.aspx — استخدمها للتحقق النهائي من العضوية قبل توقيع أي عقد.
- **FRA:** https://fra.gov.eg/en/ — استخدم صفحات Licensing وLicensed institutions للتحقق من الترخيص الحالي ونطاقه.

### المتطلبات المتوقعة قبل تنفيذ التداول

1. عقد مع شركة وساطة مصرية مرخصة يحدد أن Atheer واجهة/قناة تقنية وليست وسيطًا غير مرخص.
2. تحديد نموذج الحساب: حساب عميل منفصل لدى الوسيط أم omnibus ممنوع/مقيّد، والحفظ والتسوية مع الجهات المختصة.
3. API أو FIX spec، بيئة sandbox، شهادات/مفاتيح اختبار، webhook أو drop-copy للتنفيذات، وسياسة idempotency والإلغاء.
4. KYC/AML، شكاوى العملاء، الإفصاحات، حدود المخاطر، سجلات التدقيق، وخطة التشغيل في حال فشل الوسيط.
5. تحقق قانوني مع FRA قبل استقبال أوامر عملاء أو أموالهم.

## 3. التحصيل والدفع

### Paymob

- **الرابط الرسمي:** https://www.paymob.com/en/pricing
- **ما هو مؤكد علنًا:** Standard Plan بسعر معلن **2.75% + 3 جنيه لكل معاملة**، دون رسوم شهرية/اشتراك، والتسوية البنكية أسبوعية حسب الصفحة. Enterprise بالتسعير عبر المبيعات.
- **الواجهات:** https://developers.paymob.com/ — توثيق المحافظ يتضمن Vodafone Cashin ومرجع عميل UUID وحالات العملية.
- **الرابط الرسمي لـ Vodafone Cashin:** https://developers.paymob.com/paymob-docs/developers/payouts-apis/cashin-api/vodafone-cashin
- **المتطلبات:** حساب أعمال، قبول نموذج النشاط، موافقة Paymob على استخدام المنتج، مفاتيح sandbox/production، webhook أو استعلام reconciliation، وسياسة رد الأموال.
- **تنبيه:** السعر المعلن هو لخدمة الدفع القياسية وقد لا يمثل سعر payouts أو نشاطًا ماليًا منظمًا؛ اطلب عرضًا مكتوبًا يوافق على نموذج Atheer.

### Fawry Accept

- **الرابط الرسمي:** https://www.fawry.com/business/acceptance/online-checkout/
- **ما هو مؤكد علنًا:** قبول البطاقات، Fawry Pay، المحافظ الإلكترونية، وروابط الدفع، مع onboarding ولوحة تقارير وdeveloper guide. تذكر الصفحة ترخيص CBE وPCI، لكن يجب التحقق من نطاق الخدمة ونوع نشاط Atheer.
- **التكلفة:** غير منشورة في الصفحة؛ يبدأ التواصل من نموذج الشركات: https://www.fawry.com/sme-registration-form/
- **المتطلبات:** بيانات الشركة والنشاط، حساب التسوية البنكي، فحص الامتثال، موافقة على نموذج الأموال/الاستثمار، مفاتيح sandbox/production، webhooks وreconciliation.

### Vodafone Cash مباشرة

- **الرابط الرسمي:** https://web.vodafone.com.eg/en/vodafone-cash
- **المؤكد:** Vodafone Cash محفظة إلكترونية للأفراد/Businessline، وتعرض الصفحة الخدمات والحدود؛ هذا لا يثبت وجود API عام لقبول أموال عملاء منصة استثمار.
- **المطلوب:** حساب أعمال واتفاقية/منتج تجاري مع Vodafone أو PSP معتمد؛ لا تستخدم رقم Vodafone Cash شخصيًا.

## 4. المسار التنظيمي المصري

- **FRA — الترخيص والمؤسسات المرخصة:** https://fra.gov.eg/en/
- **FRA — إرشاد الاستثمار في البورصة:** https://fra.gov.eg/en/ufaq/%D9%83%D9%8A%D9%81-%D8%AA%D8%B3%D8%AA%D8%AB%D9%85%D8%B1-%D9%81%D9%8A-%D8%A7%D9%84%D8%A8%D9%88%D8%B1%D8%B5%D8%A9%D8%9F/
- **CBE Regulatory Sandbox:** https://www.cbe.org.eg/en/financial-technology/regulatory-sandbox — مفتوح لمزودي FinTech المسجلين تجاريًا والمؤسسات المرخصة، وليس مرحلة فكرة فقط. مدة الاختبار عادة 6 أشهر وقد تمتد إلى 12، والخدمة نفسها بلا رسوم بحسب الصفحة، مع تحمّل المتقدم موارد الاختبار.

لا يكفي التسجيل في بوابة دفع أو امتلاك API لتشغيل تداول أو حفظ أموال العملاء. يجب إنهاء هيكل الشركة والترخيص ونموذج الحفظ والتسوية وKYC/AML وحماية البيانات والعقود مع الوسيط ومزود الدفع قبل تفعيل الميزات الحية.

## 5. ما تم تجهيزه في الكود

المشروع يحتوي على عقود منفصلة `MarketDataProvider` و`BrokerAdapter` و`PaymentProvider`، ومزودات `not_configured` لا ترسل طلبات خارجية. كما أضيفت جداول السوق والاقتباسات والأوامر والتنفيذات والمراكز والسجل النقدي والتحويلات والإشعارات، ومفاتيح idempotency ومراجع فريدة. عند اختيار مزود، تتم إضافة adapter خاص به واختباره في sandbox، ثم تفعيل أعلام البيئة فقط بعد نجاح الاختبارات والموافقات.
