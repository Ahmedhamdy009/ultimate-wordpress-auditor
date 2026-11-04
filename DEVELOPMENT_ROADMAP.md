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
APIs، والاختبارات تنجح.

## Phase 2 --- Local Data & Site Management

-   SQLite وmigrations.
-   Projects/Sites CRUD.
-   URL validation.
-   واجهة إدارة المواقع واختبارات persistence.

## Phase 3 --- Safe External Scanner MVP

-   Scope Guard.
-   فحص توفر الموقع والصفحات.
-   زحف محدود لنفس النطاق.
-   روابط معطوبة وأكواد HTTP.
-   حدود للصفحات والعمق والسرعة والمهلة.
-   إلغاء الفحص وحفظ النتائج.

**القبول:** لا خروج عن النطاق، والحدود والإلغاء تعمل.

## Phase 4 --- Browser & Quality Checks

-   Playwright screenshots.
-   أخطاء Console والموارد.
-   أحجام شاشات محددة.
-   axe-core واختبارات fixtures.

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
