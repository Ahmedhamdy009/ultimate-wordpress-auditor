# Development Roadmap

قاعدة العمل: مرحلة واحدة في كل مرة. لا تنتقل قبل نجاح معايير القبول، ولا
تطلب بناء المنتج كله دفعة واحدة.

## Phase 0 --- Environment & Repository

-   التحقق من Git وNode.js وpnpm.
-   إنشاء مستودع ومجلد مشروع.
-   إعداد pnpm workspace وTypeScript وESLint وPrettier.
-   إضافة scripts: lint, typecheck, test, build.
-   تشغيل التحقق وتسجيل النتائج وإنشاء أول commit.

**القبول:** install وlint وtypecheck تنجح، Git مضبوط، ولا توجد أسرار.

## Phase 1 --- Desktop Shell

-   Electron + Vite + React + TypeScript.
-   فصل main/preload/renderer.
-   contextIsolation=true وnodeIntegration=false.
-   Dashboard أولية وIPC محدود typed.
-   Smoke tests.

**القبول:** التطبيق يفتح على Windows، ولا يصل renderer مباشرة إلى Node
APIs، والاختبارات تنجح. [مكتملة ومحققة بالكامل 100% بنجاح 417 اختبارًا واجتياز كافة بوابات الجودة في Phase 1.2.5].

## Phase 2 --- Local Data & Site Management

-   SQLite وmigrations وrepositories (Phase 2.1 — مكتملة بنجاح).
-   Projects/Sites CRUD عبر Domain Services وSecure IPC وPreload Bridge وواجهة ProjectsView (Phase 2.2 — مكتملة بنجاح).
-   Scan History وFindings وReports Layer وDatabase CLI والأدوات الصيانة (Phase 2.3 — مكتملة بنجاح مع 600 اختبارًا عبر 44 ملفًا).

**القبول:** إدارة المشاريع والمواقع وسجل الفحوص والنتائج والتقارير تعمل محليًا بنسبة 100%، ولا يلمس Renderer محرك SQLite إطلاقًا، وتعمل كافة العمليات عبر IPC آمن وأدوات CLI صيانة متكاملة وبوابات جودة خضراء بالكامل (600 اختبارًا ناجحًا). [مكتملة ومحققة بالكامل 100% لإغلاق المرحلة Phase 2].

### القيود المعمارية المعتمدة للمرحلة Phase 2 (Documented Architectural Limitations):
1. **ثنائية البناء لملف Better-SQLite3 الأصلي (Dual-ABI Native Build):** دعم Node ABI 137 لاختبارات Vitest السريعة وElectron ABI 149 لتشغيل التطبيق والبيئة الحية عبر المسار المعزول `apps/desktop/src/main/db/native/`.
2. **قصر إدارة اتصالات وقفل قاعدة البيانات على العملية الرئيسية (Exclusive Main-Process SQLite Ownership):** العملية الرئيسية (Main Process) هي المالكة الحصرية لجميع اتصالات ومعاملات SQLite؛ يُحظر تمامًا وصول Renderer إلى نظام الملفات أو SQLite، ويتم تمرير كافة العمليات عبر IPC مقيد.
3. **الحدود الصارمة للصفحات وحجم الأدلة (Bounded Pagination & Evidence Limits):** حصر صفحات الاستعلام بين 1 و200 عنصر لمنع استهلاك الذاكرة، وقصر حجم دليل النتيجة الواحدة على 64 كيلوبايت كحد أقصى مع تنقيح وتعمية الأسرار (Secret Redaction) تلقائيًا.

## Phase 3 --- Safe External Scanner MVP

-   Scope Guard.
-   فحص توفر الموقع والصفحات.
-   زحف محدود لنفس النطاق.
-   روابط معطوبة وأكواد HTTP.
-   حدود للصفحات والعمق والسرعة والمهلة.
-   إلغاء الفحص وحفظ النتائج.

**القبول:** لا خروج عن النطاق، والحدود والإلغاء تعمل.

## Phase 4 --- Browser & Quality Checks

-   **Batch 4.1 --- Playwright Core Foundation, Browser Manager & SSRF-Safe Network Interception:** اكتشاف المتصفحات، إدارة دورة الحياة وتجمع الصفحات المتزامنة، وكيل HTTP محلي مع ربط المقابس IP-pinning، وعزل تام لشبكة Chromium (مقبولة رسمياً).
-   **Batch 4.2 --- Runtime Errors & Network Resource Auditor:** التقاط أخطاء JavaScript والاستثناءات غير الملتقطة، رسائل Console والتحذيرات، مراقبة الموارد والشبكة (4xx/5xx)، وتصنيف الأثر، وتعمية الأسرار والبيانات الحساسة، وتحجيم الأدلة (مقبولة رسمياً).
-   **Batch 4.3 --- Viewport Emulation, Layout Shifts & Visual Evidence:** محاكاة مصفوفة أحجام الشاشات (8 أحجام افتراضية من Small Mobile حتى Large Desktop، مع قيود صارمة على الأحجام المخصصة)، فحص التجاوب الأفقي والتجاوزات بهامش دقة 2px مع تصفية العناصر التزيينية المقتطعة، قياس استقرار التخطيط وتجميع نوافذ جلسات CLS القياسية مع استبعاد التفاعلات البشرية وتوضيح الفارق بين القياس المعملي والبيانات الميدانية، محرك التقاط وتخزين لقطات الشاشة الآمن والذري على القرص D: مع تحجيم السعة وحصص التخزين والتجزئة التشفيرية SHA-256 (مقبولة رسمياً).
-   **Batch 4.4 --- Accessibility Engine (axe-core) & Fixture Tests:** محرك فحص إمكانية الوصول المستند إلى حزمة axe-core@4.14.0 المجمعة محلياً وبشكل معزول (100% Offline دون أي استدعاءات خارجية أو CDN)، تقييم معايير WCAG 2.0 A/AA وWCAG 2.1 A/AA وWCAG 2.2 AA، استخراج أدلة دقيقة ومحددة على مستوى عناصر DOM مع استخراج محددات CSS ومقتطفات HTML معقمة ومنقحة من البيانات السرية وكلمات المرور، الفصل القاطع بين الانتهاكات المؤكدة ونتائج المراجعة اليدوية (needs_manual_review) والملاحظات الإرشادية (best-practice)، التجميع الذكي وتجنب التكرار، قيود صارمة على الموارد والأدلة والمهل الزمنية (منفذة ومحققة بنجاح — بانتظار المراجعة والاعتماد).

-   **Batch 4.5 --- Unified ScanOrchestrator Integration, Desktop UI & Reporting:** دمج وتوحيد كافة محركات الفحص (الزاحف المقيد Phase 3، ومحللات WordPress والأمان وSEO، ومحرك المتصفح الآمن، ومراقب أخطاء وقت التشغيل والشبكة، ومحلل التجاوب واستقرار التخطيط CLS ولقطات الشاشة، ومحرك إمكانية الوصول axe-core مع تنقيح الخصوصية) داخل ScanOrchestrator في تدفق واحد متماسك؛ تكوين فحص موحد وخيارات وحدات التدقيق القابلة للتخصيص والتعطيل الانتقائي؛ تجميع ودمج النتائج وإزالة التكرار مع حفظ عدد التكرارات والمحددات وسياقات العرض؛ عزل إخفاقات المتصفح لكل صفحة وتفادي انهيار الفحص الكلي؛ تحديث واجهة سطح المكتب ScansView بمراقبة حية للمحركات والتصنيفات وتفاصيل الأدلة البصرية؛ توليد وتصدير التقارير الموحدة (HTML, JSON, CSV) مع إخلاء المسؤولية وحدود القياس الآلي (منفذة ومحققة بنجاح — بانتظار المراجعة والاعتماد).

## Phase 5 --- Lighthouse & Reports

-   Lighthouse mobile/desktop.
-   حفظ ظروف القياس.
-   تقرير HTML يوضح ما نُفذ وما لم ينفذ.

## Phase 6 --- WordPress Companion Plugin

-   Threat Model وبروتوكول pairing أولًا.
-   Plugin read-only.
-   جرد Core/Plugins/Themes.
-   مراجعة أدوار وإعدادات محددة.
-   إبطال الاتصال واختبارات أمان الإضافة.

## Phase 7 --- WordPress & Vulnerability Intelligence

-   مصادر ثغرات موثوقة وتاريخ تحديثها.
-   مطابقة المنتج والإصدار وشروط التأثر.
-   سلامة الملفات عند توفر بصمات موثوقة.
-   تمييز Potential عن Confirmed.

## Phase 8 --- Security Scanning

-   سياسة فحص نشط منفصلة.
-   OWASP ZAP بنطاق ومعدل آمنين.
-   منع الاختبارات التخريبية.
-   مراجعة الأدلة والنتائج المحتملة.

## Phase 9 --- Elementor & WooCommerce

-   اختبارات الواجهة وResponsive.
-   WooCommerce على Staging/Sandbox.
-   forms وemail والتكاملات ببيانات اختبار.

## Phase 10 --- Diagnosis & Retest

-   توصيات مبنية على الأدلة.
-   ترتيب الأولويات وحالات النتائج.
-   إعادة اختبار ومقارنة النتائج.

## Phase 11 --- Packaging & Release

-   Windows installer.
-   توثيق الاستخدام.
-   مراجعة تراخيص الأدوات.
-   اختبار التحديثات والسجلات والأمان.
