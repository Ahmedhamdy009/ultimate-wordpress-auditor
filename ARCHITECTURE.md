# Technical Architecture --- تأسيسي

## الهدف

تطبيق محلي على Windows لإدارة تدقيق مواقع الويب وWordPress، مع محرك فحص
خارجي وإضافة WordPress اختيارية لجمع معلومات داخلية محدودة.

## اختيارات مبدئية

-   Desktop: Electron.
-   UI: React + TypeScript + Vite.
-   Main process: Node.js.
-   Scanner: خدمة/عملية محلية منفصلة عن واجهة العرض.
-   Database: SQLite.
-   WordPress plugin: PHP.
-   Workspace: pnpm.
-   Tests: Vitest وPlaywright.
-   Reports: HTML أولًا ثم PDF.

تحقق من الإصدارات المستقرة وقت التنفيذ وثبتها في lockfile؛ لا تخترع
أرقام إصدارات.

## المكونات

``` text
Desktop (Electron)
  Renderer (React)
  Preload (typed, limited API)
  Main Process
    Project/Site Manager
    Scan Orchestrator
    Report Service
    SQLite Persistence
  Scanner Worker
    Scope Guard
    HTTP Crawler
    Playwright Checks
    Lighthouse Adapter
    axe-core Adapter

WordPress Companion Plugin (مرحلة لاحقة)
  Pairing & Authentication
  Read-only Diagnostics
  Core/Plugin/Theme Inventory
  Roles & Configuration Checks
  Audit Log
```

## حدود الثقة

صفحات المواقع محتوى غير موثوق. لا تشغّل شيفراتها داخل Electron main. لا
تسمح لنتائج الزاحف بتوسيع النطاق. لا تنفذ أوامر shell أو SQL من الإضافة.
لا تخزن كلمات مرور أو أسرار.

## Scope لكل موقع

-   عنوان البداية والنطاقات المسموحة.
-   الحد الأقصى للصفحات وعمق الزحف.
-   المهلة ومعدل الطلبات.
-   أنواع الاختبارات المسموح بها.
-   الاختبارات النشطة معطلة افتراضيًا وتتطلب تصريحًا ونطاقًا واضحًا.

## تدفق الفحص

إنشاء الموقع والفحص ← التحقق من النطاق ← تطبيق حدود الأمان ← تشغيل
الوحدات ← توحيد النتائج ← حفظ الأدلة ← إنشاء التقرير ← إعادة اختبار
النتائج المختارة.

## Finding schema

`id, siteId, scanRunId, module, category, title, description, severity, confidence, status, affectedUrl, evidence, source, detectedAt, remediation, verificationSteps`.

Severity: Critical/High/Medium/Low/Informational. Confidence:
High/Medium/Low. Status:
Confirmed/Potential/NeedsManualReview/FalsePositive/Fixed/AcceptedRisk/RetestRequired.

لا تعرض درجة صحة عامة قبل تعريف معادلة شفافة. اعرض نتائج المجالات
والاختبارات التي لم تنفذ.

## هيكل مستودع مقترح

``` text
apps/desktop/{src/main,src/preload,src/renderer}
apps/scanner/src/{scope,orchestration,modules,findings}
packages/{shared,database,reporting}
wordpress-plugin/companion
tests/{fixtures,integration}
docs/
```

ابدأ بأقل هيكل مطلوب للمرحلة الحالية، ولا تنشئ مجلدات فارغة بلا حاجة.

## تخزين البيانات

SQLite محلية: projects, sites, scan_profiles, scan_runs, scan_modules,
findings, evidence, reports, audit_logs. لا تخزن كلمات مرور أو مفاتيح
API. أي رمز ربط مستقبلي يجب أن يخزن بأمان وقابل للإبطال.

## Companion Plugin

لا تنفذ الإضافة قبل تصميم Threat Model وبروتوكول pairing آمن. لا
endpoint إداري عام، ولا أوامر shell أو SQL عن بعد. اجمع أقل قدر من
البيانات وبصلاحيات محدودة.

## حدود المنتج

لا تضمن الأداة اكتشاف جميع الثغرات أو البرمجيات الخبيثة. كل نتيجة يجب أن
توضح الدليل والمصدر والقيود.
