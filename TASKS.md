# Task Tracker

لا تضع علامة Complete إلا بعد تشغيل الاختبارات وتسجيل النتائج.

## Phase 0

-   [x] التحقق من Windows وGit وNode.js وpnpm.
-   [x] إنشاء مجلد ومستودع المشروع.
-   [x] تهيئة pnpm workspace.
-   [x] إعداد TypeScript.
-   [x] إعداد ESLint وPrettier.
-   [x] إضافة lint/typecheck/test/build scripts.
-   [x] تشغيل التحقق وتسجيل النتائج.
-   [x] أول Git commit.
-   [x] ربط وتكامل مستودع GitHub الخاص والرفع على فرع main (المرحلة 0.5).

## Phase 1

-   [x] Electron + Vite + React (Phase 1.2.1).
-   [x] فصل main/preload/renderer (Phase 1.2.1, 1.2.3).
-   [x] إعدادات Electron الآمنة: contextIsolation, CSP, SenderGuard (Phase 1.2.2, 1.2.4).
-   [x] Dashboard أولية وتكامل الـ IPC وواجهات Overview, Target Validator, System Diagnostics (Phase 1.2.5).
-   [x] Smoke test وتشغيل Windows واختبارات تكامل Electron الحية (417 اختبار ناجح).

## Phase 2

-   [x] SQLite وmigrations وrepositories وDatabaseConnection مع أفضلية الأداء والأمان (Phase 2.1).
-   [x] Projects CRUD عبر Domain Services وSecure IPC (Phase 2.2).
-   [x] Sites CRUD عبر Domain Services وSecure IPC (Phase 2.2).
-   [x] URL normalization and validation وفق RFC 3986 (Phase 2.2).
-   [x] Preload API Bridge الموسع بـ 15 دالة محكمة ومعزولة (Phase 2.2).
-   [x] واجهة React كاملة لإدارة المشاريع والمواقع (ProjectsView) مع التحقق الحي (Phase 2.2).
-   [x] اختبارات persistence وتوافقية Electron 44.10.2 (ABI 149) واجتياز 515 اختبارًا (Phase 2.2).
-   [x] Scan History & Findings & Reports Layer مع دورة حياة الفحص وقواعد الانتقال المحددة (Phase 2.3).
-   [x] Database CLI & Maintenance Tools (status, migrate, verify, diagnostics, backup) محليًا على Drive D: (Phase 2.3).
-   [x] توسيع Preload Bridge إلى 24 دالة محكمة واجتياز 600 اختبارًا عبر 44 ملفًا بنجاح 100% (Phase 2.3) مع اجتياز كامل اختبارات القفل التنافسي والتعافي من الانهيار (Crash-Consistency).

## Phase 3 --- Safe External Scanner MVP (Planning & Architecture)

-   [x] مراجعة وتدقيق الشيفرة الحالية (Audit Existing Codebase) وحصر المكونات القابلة لإعادة الاستخدام والناقصة.
-   [x] تصميم نموذج التهديدات الشامل (SSRF & DNS Rebinding Threat Model) والحدود الافتراضية الآمنة.
-   [x] تصميم معمارية المكونات الأساسية (Scope Guard, Reachability Engine, Bounded Crawler, Broken Link Checker, Scan Orchestrator).
-   [x] تقييم التوافق مع قاعدة البيانات والـ IPC (Database & IPC Compatibility Assessment) وتأكيد عدم الحاجة لـ Migrations.
-   [x] إعداد خطة التنفيذ الموزعة على 5 دفعات جوهرية (5 Implementation Batches) مع بوابات الجودة ومعايير القبول.
-   [x] تنفيذ الدفعة 3.1: Scope Guard & SSRF Protection Foundation (مكتملة ومختبرة بـ 100 اختبار لوحدة النطاق).
-   [x] تنفيذ الدفعة 3.2: Safe HTTP Client & Socket IP Pinning (مكتملة ومختبرة بـ 44 اختباراً للعميل والشبكة).
-   [x] تنفيذ الدفعة 3.3: Bounded Crawler & HTML Parser Engine (مكتملة ومختبرة).
-   [x] تنفيذ الدفعة 3.4: Broken Link Checker & Finding Generation (مكتملة ومختبرة).
-   [x] تنفيذ الدفعة 3.5: Specialized Audit Analyzers & Engine (مكتملة ومختبرة).
-   [x] تنفيذ الدفعة 3.6: Scan Orchestration, Lifecycle & Persistence (مكتملة ومختبرة).
-   [x] تنفيذ الدفعة 3.7: Scanner Desktop UI & End-to-End Integration (مكتملة ومقبولة رسمياً).

## Phase 4 --- Browser & Quality Checks

-   [x] Batch 4.1: Playwright Core Foundation, Browser Manager & SSRF-Safe Network Interception (مكتملة ومقبولة رسمياً).
-   [x] Batch 4.2: Runtime Errors & Network Resource Auditor (مكتملة ومقبولة رسمياً).
-   [x] Batch 4.3: Viewport Emulation, Layout Shifts & Visual Evidence (مكتملة ومقبولة رسمياً).
-   [x] Batch 4.4: Accessibility Engine (axe-core) & Fixture Tests (مكتملة ومقبولة رسمياً).
-   [ ] Batch 4.5: Unified ScanOrchestrator Integration, Desktop UI & Reporting (تم التنفيذ والتحقق واجتياز بوابات الجودة بالكامل — بانتظار المراجعة والاعتماد).

## قرارات مفتوحة

-   [ ] حد الصفحات الافتراضي.
-   [ ] سياسة robots.txt.
-   [ ] آلية ربط Companion Plugin.
-   [ ] الأدوات وتراخيصها قبل التوزيع.
