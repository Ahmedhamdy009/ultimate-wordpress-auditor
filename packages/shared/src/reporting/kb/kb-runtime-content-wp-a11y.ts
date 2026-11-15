import { bi, dual, step, type RecommendationEntry } from './types.js';

const RUNTIME_LIMITATION = bi(
  'Observed during headless browser execution of the audited route; intermittent third-party network conditions or authenticated states may behave differently.',
  'تم الرصد أثناء تشغيل المتصفح الآلي للصفحة؛ قد تختلف ظروف الشبكة المؤقتة أو الجلسات المسجلة.',
);

const A11Y_LIMITATION = bi(
  'Automated accessibility rules check measurable DOM/ARIA conditions only and do not constitute formal legal WCAG compliance certification; keyboard and screen-reader testing remains required.',
  'الفحوص الآلية لإمكانية الوصول تقيس شروط DOM/ARIA القابلة للفحص آلياً فقط ولا تمثل شهادة مطابقة قانونية لـ WCAG؛ وتبقى المراجعة اليدوية بلوحة المفاتيح وقارئ الشاشة ضرورية.',
);

const WP_SURFACE_LIMITATION = bi(
  'Passive surface fingerprint only; public discovery does not prove vulnerability unless unpatched plugins/settings or insecure endpoints exist.',
  'هذه إشارة رصد سلبية للمنصة فقط ولا تعني وجود ثغرة مستغلة بحد ذاتها ما لم تصاحبها إعدادات ضعيفة أو مكونات غير محدثة.',
);

export const RUNTIME_CONTENT_WP_A11Y_KB_ENTRIES: readonly RecommendationEntry[] = [
  // --- HTTP Errors & Network Failures (14) ---
  {
    recommendationId: 'rec-http-main-document-404-and-4xx',
    ruleIds: [
      'HTTP_MAIN_DOCUMENT_404',
      'HTTP_CLIENT_ERROR_4XX',
      'HTTP_FORBIDDEN_403',
      'HTTP_UNAUTHORIZED_401',
    ],
    category: 'runtime-network',
    supportedPlatforms: ['generic', 'wordpress', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'A requested page or route returned an HTTP 4xx error (404 Not Found, 401 Unauthorized, 403 Forbidden, or other 4xx client error).',
      'أرجع رابط الصفحة أو المسار خطأ HTTP من فئة 4xx (مثل 404 غير موجود أو 403 محظور أو 401 غير مصرح).',
      'Document or endpoint request returned an HTTP 4xx status response during crawl or browser load.',
      'أرجع طلب الصفحة أو نقطة النهاية استجابة HTTP 4xx أثناء الزحف أو التحميل بالمتصفح.',
    ),
    impact: dual(
      'Visitors cannot view affected pages, and bots/users may hit broken routes (note: 401/403 on intentionally private endpoints can be normal, whereas 403 on public pages may indicate WAF/firewall blocking).',
      'يتعذر على الزوار عرض الصفحة (بينما قد يكون 401/403 طبيعياً لصفحات خاصة أو ناتجاً عن حجب جدار حماية WAF لصفحة عامة).',
      'Degrades route reachability and crawler accessibility when occurring on linked public URLs.',
      'يؤثر على إتاحة المسارات والزحف إذا ظهر على روابط عامة منشورة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'HTTP response recorded status >= 400 and < 500 for the reported target URL.',
        'سجلت استجابة الشبكة رمز حالة 4xx للرابط المبلغ عنه.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'For 404: deleted slug or broken internal link. For 401/403: intentional access control OR edge firewall/WAF/rate-limit challenge blocking automated headless traffic.',
        'في 404: مسار محذوف أو رابط مكسور. وفي 401/403: حماية مقصودة أو جدار حماية WAF حجب طلب المتصفح الآلي.',
      ),
    ],
    locationGuidance: dual(
      'Affected request URL and any internal linking source page.',
      'الرابط المتأثر وأي صفحة تحوي رابطاً يشير إليه.',
      'Check the reported URL HTTP status and origin/WAF rules or CMS permalink routing.',
      'افحص رمز الحالة وإعدادات التوجيه أو قواعد الحماية للرابط المتأثر.',
    ),
    remediationSteps: [
      step(
        1,
        'For public 404 URLs, fix broken links or restore/redirect moved slugs cleanly; for public 403s, verify firewall/WAF rules are not unexpectedly blocking valid visitors/crawlers.',
        'للروابط العامة المعطلة (404) صحح الرابط أو أنشئ تحويل 301؛ ولـ 403 العامة تأكد من عدم حجب الزوار أو الزاحف بالخطأ في جدار الحماية.',
        'Differentiate intentional auth-protected endpoints (leave 401/403 intact) from public broken slugs (fix links / 301 redirect) or unintended WAF blocks.',
        'ميّز بين المسارات المحمية عمداً والروابط العامة المعطوبة أو المحجوبة بالخطأ.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Test the public URL in a fresh browser session for HTTP 200 (if intended public) and re-scan.',
        'اختبر الرابط العام في المتصفح للتأكد من استجابة 200 ثم أعد الفحص.',
        'Confirm intended HTTP status code cleanly and re-run audit.',
        'تحقق من عودة رمز الحالة الصحيح ثم أعد تشغيل الفحص.',
      ),
    ],
    limitations: [RUNTIME_LIMITATION],
    references: [
      {
        label: 'MDN HTTP Status Codes',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status',
      },
    ],
  },
  {
    recommendationId: 'rec-http-broken-resource-and-iframe-404',
    ruleIds: ['HTTP_BROKEN_RESOURCE_404', 'HTTP_IFRAME_DOCUMENT_404'],
    category: 'runtime-network',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'An embedded subresource (image, script, CSS, font) or iframe returned HTTP 404 Not Found.',
      'أرجع مورد مضمّن (صورة أو سكربت أو CSS أو خط أو iframe) خطأ 404 غير موجود.',
      'Subresource or iframe document loaded with HTTP 404 status during browser rendering.',
      'فشل تحميل مورد فرعي أو إطار iframe برمز 404 أثناء العرض.',
    ),
    impact: dual(
      'Broken images, missing styling/icons, failed interactivity, or blank embedded frames.',
      'يسبب ظهور صور مكسورة أو غياب تنسيقات وخطوط أو تعطل إطارات مضمنة.',
      'Triggers failed network overhead and partial functional/visual degradation.',
      'يؤدي لتدهور بصري أو وظيفي مع محاولات تحميل فاشلة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Browser network listener recorded HTTP 404 on the reported resource or iframe URL.',
        'رصد مستمع الشبكة رمز 404 لرابط المورد أو الإطار المذكور.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Stale asset URLs after theme/plugin cache purge, moved uploads, or removed third-party embed URL.',
        'روابط أصول قديمة بعد تحديث قالب أو حذف ملف مرفوع أو رابط خارجي منتهٍ.',
      ),
    ],
    locationGuidance: dual(
      'Parent page URL + failing subresource/iframe URL in evidence.',
      'الصفحة الحاضنة + رابط المورد أو الإطار المعطل في الأدلة.',
      'Locate reference to the missing asset URL in HTML/CSS/widget configuration.',
      'حدد مرجع الرابط المفقود في HTML أو CSS أو إعدادات المكون.',
    ),
    remediationSteps: [
      step(
        1,
        'Restore the missing asset, regenerate outdated CSS/cache URLs, or replace/remove the stale URL reference.',
        'استعد الملف المفقود أو حدّث رابطه في الصفحة أو أعد توليد ملفات الكاش، أو احذف المرجع القديم.',
        'Update the broken `src`/`href` or regenerate compiled asset hashes cleanly.',
        'صحّح مسار `src`/`href` المعطل أو أعد بناء مراجع الأصول المجمعة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Check DevTools Network tab for zero 404 asset failures and re-scan.',
        'تحقق من خلو تبويب الشبكة من أخطاء 404 ثم أعد الفحص.',
        'Confirm HTTP 200 across all page subresources/iframes and re-scan.',
        'تأكد من تحميل جميع الموارد برمز 200 ثم أعد الفحص.',
      ),
    ],
    limitations: [RUNTIME_LIMITATION],
    references: [
      {
        label: 'MDN 404 Not Found',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404',
      },
    ],
  },
  {
    recommendationId: 'rec-http-5xx-server-errors',
    ruleIds: [
      'HTTP_MAIN_DOCUMENT_5XX',
      'HTTP_IFRAME_DOCUMENT_5XX',
      'HTTP_GATEWAY_UNAVAILABLE_5XX',
      'HTTP_INTERNAL_SERVER_ERROR_500',
      'HTTP_5XX_SERVER_ERROR',
    ],
    category: 'runtime-network',
    supportedPlatforms: ['generic', 'wordpress', 'woocommerce', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The server or gateway returned an HTTP 5xx server error (500, 502, 503, 504) during the request.',
      'أرجع الخادم أو البوابة خطأ خادم HTTP 5xx (مثل 500 أو 502 أو 503 أو 504) أثناء الطلب.',
      'Audited document, iframe, or asset request failed with an HTTP 500–599 server-side error.',
      'فشل الطلب برمز خطأ من الخادم 500–599.',
    ),
    impact: dual(
      'Pages fail to load, features break, and recurring 5xx errors harm search indexing and user trust.',
      'تتوقف الصفحة أو الميزة عن العمل وتضر الأخطاء المتكررة بثقة الزائر والأرشفة.',
      'Indicates unhandled backend exception, upstream gateway timeout, or service exhaustion.',
      'يشير إلى خطأ غير معالج في الخلفية أو انتهاء مهلة البوابة أو تعطل خدمة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed HTTP response status >= 500 on the reported URL.',
        'سُجِّل رمز استجابة 5xx للرابط المبلغ عنه.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Unhandled PHP/application exception, PHP memory exhaustion, upstream timeout (502/504), or transient overload (503).',
        'استثناء غير معالج في الكود أو نفاد ذاكرة PHP أو مهلة بوابة 502/504 أو ضغط مؤقت 503.',
      ),
    ],
    locationGuidance: dual(
      'Reported URL + server/application error logs matching the scan timestamp.',
      'الرابط المبلغ عنه وسجلات أخطاء الخادم والتطبيق المطابقة لوقت الفحص.',
      'Inspect origin error logs / PHP fatal logs / reverse-proxy upstream logs for the exact failing endpoint.',
      'راجع سجلات أخطاء الخادم وPHP ورسائل البوابة لنقطة النهاية المتأثرة.',
    ),
    remediationSteps: [
      step(
        1,
        'Inspect server/application error logs for the exact failing URL and resolve the backend exception or upstream gateway timeout in staging first.',
        'راجع سجلات أخطاء الخادم للرابط المحدد وأصلح الخطأ البرمجي أو سبب مهلة الخادم في بيئة تجريبية أولاً.',
        'Correlate HTTP 5xx timestamp with server/application logs, isolate failing plugin/handler/query, and verify stability under normal load.',
        'طابق توقيت خطأ 5xx مع سجلات الخادم وعالج العطل المسبب في البيئة التجريبية.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Reload the failing URL repeatedly to confirm consistent HTTP 200 and re-scan.',
        'اختبر الرابط عدة مرات للتأكد من استقرار استجابة 200 ثم أعد الفحص.',
        'Confirm HTTP 200 recovery across repeated requests and re-run audit.',
        'تأكد من عودة الاستجابة 200 باستقرار ثم أعد الفحص.',
      ),
    ],
    limitations: [RUNTIME_LIMITATION],
    references: [
      {
        label: 'MDN 5xx Server Errors',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#server_error_responses',
      },
    ],
  },
  {
    recommendationId: 'rec-net-connection-failures',
    ruleIds: ['NET_MAIN_DOCUMENT_FAILED', 'NET_IFRAME_DOCUMENT_FAILED', 'NET_RESOURCE_FAILED'],
    category: 'runtime-network',
    supportedPlatforms: ['generic', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'A network request failed to complete at transport level (DNS lookup failure, connection refused, TLS error, or timeout).',
      'فشل اتصال الشبكة لإحدى الطلبات قبل استلام رد HTTP (فشل DNS أو رفض الاتصال أو انتهاء المهلة).',
      'Browser recorded a failed network transfer without an HTTP status (`failureText` observed).',
      'سجّل المتصفح فشل طلب الشبكة على مستوى الاتصال دون استلام رمز HTTP.',
    ),
    impact: dual(
      'Main document failure makes the site unreachable; third-party script/iframe failure can stall widgets or features.',
      'فشل المستند الرئيسي يمنع فتح الموقع، وفشل مورد خارجي يعطل الوظيفة المرتبطة به.',
      'Impacts availability (main frame) or asset completeness (subresources/iframes).',
      'يؤثر في التوافر الكلي للمستند أو اكتمال الموارد والإطارات.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Browser network error event reported transport-level `failureText` on the URL.',
        'أبلغ حدث فشل الشبكة في المتصفح عن انقطاع أو فشل نقل للرابط المذكور.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Offline/expired third-party domain, transient DNS timeout, or blocked third-party tracker host.',
        'تعطل نطاق طرف ثالث خارجي أو انتهاء مهلة DNS مؤقتة أو تعذر الوصول للمضيف الخارجي.',
      ),
    ],
    locationGuidance: dual(
      'Failing URL and `failureText` error code in preserved evidence.',
      'الرابط الفاشل ونص خطأ الشبكة في الأدلة المحفوظة.',
      'Inspect `url`, `isFirstParty`, and `failureText` fields in raw evidence.',
      'افحص حقول `url` و`isFirstParty` و`failureText` في الأدلة.',
    ),
    remediationSteps: [
      step(
        1,
        'Check whether the failing URL belongs to your site or an obsolete third-party embed; fix DNS/server reachability or remove dead third-party scripts.',
        'تحقق مما إذا كان الرابط يتبع موقعك أو خدمة خارجية منتهية؛ عالج الوصول للخادم أو أزل التضمين الخارجي المعطل.',
        'Verify DNS/TLS reachability for first-party failures, or remove/replace broken third-party script/iframe embeds.',
        'تأكد من صحة DNS والاتصال للموارد التابعة للموقع، أو أزل السكربتات الخارجية المعطلة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify clean network completion in DevTools Network tab and re-scan.',
        'تأكد من تحميل جميع طلبات الشبكة بنجاح في أدوات المطور ثم أعد الفحص.',
        'Confirm zero failed network requests on reload and re-scan.',
        'تحقق من خلو إعادة التحميل من فشل الشبكة ثم أعد الفحص.',
      ),
    ],
    limitations: [RUNTIME_LIMITATION],
    references: [
      {
        label: 'MDN Network Monitoring',
        url: 'https://developer.mozilla.org/en-US/docs/Glossary/HTTP',
      },
    ],
  },

  // --- Browser Console & JS Runtime (5) ---
  {
    recommendationId: 'rec-js-runtime-errors',
    ruleIds: ['JS_RUNTIME_ERROR', 'JS_UNHANDLED_PROMISE_REJECTION'],
    category: 'runtime-network',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'An uncaught JavaScript error or unhandled Promise rejection occurred while running the page.',
      'حدث خطأ برمجي غير معالج في JavaScript أو Promise أثناء تشغيل الصفحة.',
      'Browser captured an uncaught runtime `pageerror` exception or `unhandledrejection` event.',
      'رصد المتصفح استثناء JavaScript غير ملتقط (`pageerror` أو `unhandledrejection`).',
    ),
    impact: dual(
      'Interactive elements such as menus, sliders, checkout buttons, or forms may silently stop working.',
      'قد تتعطل الأزرار التفاعلية أو القوائم أو نماذج الإرسال والدفع نتيجة توقف السكربت.',
      'Breaks subsequent JS execution blocks and degrades user interaction reliability.',
      'يعطل تنفيذ السكربتات اللاحقة ويؤثر على موثوقية التفاعل في الواجهة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Browser runtime captured uncaught exception message and source location.',
        'سجّل المتصفح رسالة الاستثناء وموقع الملف والسطر.',
      ),
    ],
    locationGuidance: dual(
      'Source file URL, line/column location, and error text in finding evidence.',
      'رابط الملف وموضع الخطأ ورسالة الاستثناء في الأدلة.',
      'Inspect `message`, `stack`, and `location` inside raw evidence.',
      'راجع حقول الرسالة والتتبع وموضع الملف في الأدلة الخام.',
    ),
    remediationSteps: [
      step(
        1,
        'Open the reported script/location, add null/type guards or `.catch()` error handling, and resolve plugin/script conflicts on staging.',
        'راجع الملف والسطر المذكورين وأضف معالجة للأخطاء (`try/catch` أو `.catch()`) وتأكد من عدم تعارض السكربتات.',
        'Fix the root exception at `evidence.location` (guard undefined DOM elements/API responses; handle async Promise rejections explicitly).',
        'عالج سبب الاستثناء في الموضع المرصود مع إضافة فحوص سلامة القيم ومعالجة الوعود غير المكتملة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Open DevTools Console while interacting with the page to confirm zero red uncaught errors, then re-scan.',
        'افتح DevTools Console وتأكد من خلوها من الأخطاء البرمجية الحمراء ثم أعد الفحص.',
        'Verify zero `pageerror` / `unhandledrejection` events across key flows and re-scan.',
        'تأكد من اختفاء أخطاء التشغيل في المسارات الرئيسية ثم أعد الفحص.',
      ),
    ],
    limitations: [RUNTIME_LIMITATION],
    references: [
      {
        label: 'MDN Using Promises & Errors',
        url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises#error_handling',
      },
    ],
  },
  {
    recommendationId: 'rec-browser-console-messages',
    ruleIds: ['BROWSER_CONSOLE_ERROR', 'BROWSER_CONSOLE_ASSERTION_FAILED', 'BROWSER_CONSOLE_WARN'],
    category: 'runtime-network',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'mixed',
    problem: dual(
      'The browser console logged error, assertion failure, or warning messages during page execution.',
      'سجّلت وحدة تحكم المتصفح (Console) رسائل خطأ أو فشل تحقق أو تحذيرات أثناء تشغيل الصفحة.',
      'Browser console listener recorded `console.error`, `console.assert`, or `console.warn` diagnostic output.',
      'رصد مستمع وحدة التحكم رسائل `console.error` أو `console.assert` أو تحذيرات `console.warn`.',
    ),
    impact: dual(
      'Console errors often reflect broken embeds, failed API calls, or deprecated APIs that may fail in future browsers.',
      'غالباً ما تشير أخطاء Console إلى فشل طلبات أو واجهات برمجية مهملة قد تتوقف مستقبلاً.',
      'Indicates runtime faults or deprecation/policy warnings (note: third-party embeds sometimes log non-fatal warnings).',
      'تشير لأعطال تشغيلية أو تحذيرات إهمال برمجي، وقد تصدر أحياناً من مكونات طرف ثالث.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Captured console entry text and origin URL recorded in evidence.',
        'تم تسجيل نص رسالة وحدة التحكم ومصدرها في الأدلة.',
      ),
    ],
    locationGuidance: dual(
      'Console message source URL and text in finding evidence.',
      'مصدر الرسالة ونصها داخل الأدلة المحفوظة.',
      'Review `evidence.text` and `evidence.location` to isolate first-party vs third-party scripts.',
      'افحص `evidence.text` و`evidence.location` لتحديد هل المصدر داخلي أم طرف ثالث.',
    ),
    remediationSteps: [
      step(
        1,
        'Prioritize resolving first-party console errors/failed assertions and audit noisy third-party embeds.',
        'ابدأ بمعالجة أخطاء Console الصادرة من كود الموقع نفسه ثم راجع إضافات الطرف الثالث.',
        'Inspect source script at `evidence.location`, fix failing calls/assertions, and update deprecated APIs.',
        'افحص السكربت المصدري وأصلح السبب أو حدّث الواجهات المهملة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Check DevTools Console for clean loading and re-scan.',
        'تحقق من نظافة DevTools Console عند التحميل ثم أعد الفحص.',
        'Confirm console errors clear and re-scan.',
        'تأكد من اختفاء أخطاء Console ثم أعد الفحص.',
      ),
    ],
    limitations: [RUNTIME_LIMITATION],
    references: [
      {
        label: 'Chrome DevTools Console Overview',
        url: 'https://developer.chrome.com/docs/devtools/console',
      },
    ],
  },

  // --- Content & DOM Quality (10) ---
  {
    recommendationId: 'rec-content-dom-bloat',
    ruleIds: ['CONTENT_DOM_BLOAT'],
    category: 'dom-quality',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The HTML DOM tree has an unusually high number of nodes/elements.',
      'يحتوي مستند الصفحة على عدد ضخم جداً من عناصر HTML (DOM Bloat).',
      'Document element count exceeded DOM size threshold (commonly >1,500–2,000 nodes), increasing style/layout work.',
      'تجاوز عدد عقد DOM في الصفحة الحد الموصى به، ما يثقل حسابات التنسيق والرسم.',
    ),
    impact: dual(
      'Large DOM trees increase memory use and slow down scrolling, animations, and mobile rendering.',
      'تضخم شجرة DOM يرفع استهلاك الذاكرة ويبطئ التمرير والاستجابة على الهواتف.',
      'Increases CSS selector matching, style recalculation, and reflow duration.',
      'يزيد زمن حساب الأنماط وإعادة التخطيط والذاكرة المستهلكة في المتصفح.',
    ),
    confirmedCauseTemplates: [
      bi(
        'DOM counter observed total node count exceeding threshold.',
        'تجاوز عداد عقد DOM الحد المعتمد في الصفحة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Deeply nested page-builder wrappers, huge mega-menus rendered inline, or unpaginated long product/post grids.',
        'تداخل حاويات منشئ الصفحات أو قوائم ضخمة مضمنة أو عرض مئات البطاقات في صفحة واحدة بدون تقسيم صفحات.',
      ),
    ],
    locationGuidance: dual(
      'Document body structure on the affected URL.',
      'بنية العناصر في جسم الصفحة المتأثرة.',
      'Inspect deeply nested wrappers, hidden responsive duplicates, and oversized repeating lists in DOM.',
      'افحص التداخل العميق للحاويات أو تكرار عناصر سطح المكتب والجوال المخفية أو القوائم الطويلة جداً.',
    ),
    remediationSteps: [
      step(
        1,
        'Simplify nested wrapper divs, avoid duplicating whole sections for mobile vs desktop, and paginate long grids.',
        'قلص طبقات التغليف المتداخلة، وتجنب تكرار نفس القسم مخفياً للموبايل، واستخدم الترقيم (Pagination) للقوائم الطويلة.',
        'Flatten unnecessary container wrappers, remove duplicate hidden DOM trees, and paginate large product/article archives.',
        'قلل الحاويات المتداخلة وأزل الشجرات المخفية المكررة وقسّم القوائم الطويلة لصفحات.',
      ),
    ],
    platformGuidance: [
      {
        platform: 'elementor',
        requiredEvidenceNote: bi(
          'Shown only because Elementor was detected in scan evidence.',
          'يظهر فقط لأن Elementor مكتشف في أدلة الفحص.',
        ),
        summary: dual(
          'In Elementor, avoid stacking inner sections unnecessarily; prefer Flexbox/Grid containers with cleaner nesting and turn on Elementor DOM optimization features where tested safely.',
          'في Elementor، قلص التداخل الزائد بين الأقسام والحاويات وتجنب تكرار الأقسام الكاملة عبر الأجهزة إن أمكن تعديلها بالـ CSS المتجاوب.',
          'Audit nested containers/widgets per section and minimize hidden device-duplicate sections where responsive styling suffices.',
          'راجع تداخل الحاويات والودجات وقلل تكرار الأقسام المخفية لكل جهاز.',
        ),
        steps: [
          bi(
            'Audit pages with deepest sections in staging before simplifying layout wrappers.',
            'اختبر تبسيط الحاويات على نسخة تجريبية قبل التعديل على الصفحة المباشرة.',
          ),
        ],
      },
    ],
    verificationSteps: [
      step(
        1,
        'Verify DOM node count (`document.querySelectorAll("*").length`) drops cleanly and re-scan.',
        'تحقق من انخفاض عدد عناصر DOM ثم أعد الفحص.',
        'Confirm reduced DOM node count and smooth scrolling, then re-scan.',
        'تأكد من انخفاض عقد DOM وسلاسة الصفحة ثم أعد الفحص.',
      ),
    ],
    limitations: [
      bi(
        'DOM node thresholds indicate complexity risk rather than a hard functional failure; complex data apps naturally have larger DOMs.',
        'حدود عدد العقد مؤشر على التعقيد والأداء وليست خطأً وظيفياً بحد ذاتها في صفحات التطبيقات المعقدة.',
      ),
    ],
    references: [
      {
        label: 'web.dev Avoid Excessive DOM Size',
        url: 'https://developer.chrome.com/docs/lighthouse/performance/dom-size',
      },
    ],
  },
  {
    recommendationId: 'rec-content-duplicates',
    ruleIds: [
      'CONTENT_DUPLICATE_TITLE',
      'CONTENT_DUPLICATE_DESCRIPTION',
      'CONTENT_DUPLICATE_PAGE_CANDIDATE',
    ],
    category: 'content-quality',
    supportedPlatforms: ['generic', 'wordpress', 'woocommerce'],
    causeConfidence: 'mixed',
    problem: dual(
      'Multiple crawled URLs share identical `<title>`, meta descriptions, or nearly identical page text.',
      'تشترك عدة روابط في العنوان `<title>` نفسه أو الوصف نفسه أو محتوى نصي متطابق تقريباً.',
      'Cross-page comparison flagged duplicate title strings, duplicate meta descriptions, or near-duplicate content similarity across distinct URLs.',
      'أظهرت المقارنة بين الصفحات تكرار العنوان أو الوصف التعريفي أو تشابه النص الأساسي عبر روابط مختلفة.',
    ),
    impact: dual(
      'Search engines struggle to distinguish which URL should rank, splitting relevance.',
      'تحتار محركات البحث أي صفحة يجب إظهارها في النتائج وتتشتت قوة الصفحات.',
      'Dilutes organic targeting clarity and crawl efficiency (unless controlled cleanly via canonical/noindex on pagination or filter URLs).',
      'يُضعف استهداف الكلمات البحثية ما لم يكن مضبوطاً بوسوم canonical أو noindex للصفحات التصفوية.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Cross-page text/metadata hashing matched duplicate values across multiple crawled URLs.',
        'طابقت مقارنة البيانات والمحتوى قيماً متطابقة بين الروابط المذكورة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Pagination/archive/filter variants, copied template drafts, or localized/regional pages missing distinct metadata.',
        'صفحات الأرشيف والترقيم أو مسودات منسوخة أو صفحات إقليمية بنفس العنوان.',
      ),
    ],
    locationGuidance: dual(
      'Set of overlapping URLs listed in finding evidence.',
      'قائمة الروابط المشتركة المذكورة في الأدلة.',
      'Compare the affected URLs in evidence (`urls` / `matchedPages`) to see if variants need distinct copy or canonical consolidation.',
      'قارن الروابط المذكورة لتحديد هل تستحق محتوى فريداً أم توحيداً بـ canonical.',
    ),
    remediationSteps: [
      step(
        1,
        'Give genuinely unique pages distinct titles/descriptions/copy, or consolidate duplicate URL variants using `rel="canonical"` / 301 redirects.',
        'امنح الصفحات المستقلة عناوين وأوصافاً ومحتوى فريداً، أو وحّد النسخ المكررة بـ `rel="canonical"` أو تحويل 301.',
        'Author unique metadata/content for standalone landing pages; enforce canonical consolidation on tracking parameters or variant views.',
        'اكتب بيانات ومحتوى فريداً لكل صفحة مستقلة أو وحّد المتغيرات بـ canonical.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify unique titles/descriptions across distinct pages and re-scan.',
        'تأكد من تفرد العناوين والأوصاف بين الصفحات المستقلة ثم أعد الفحص.',
        'Confirm duplicate groups resolve on fresh cross-page scan.',
        'أعد الفحص للتأكد من حل مجموعات التكرار.',
      ),
    ],
    limitations: [
      bi(
        'Similarity checks reflect static visible text extracted during crawl and require editorial judgment for intentional variations.',
        'مقارنة التشابه تعتمد على النص الظاهر المستخرج وتتطلب تقديراً تحريرياً للصفحات ذات الاختلافات البسيطة المقصودة.',
      ),
    ],
    references: [
      {
        label: 'Google Duplicate Content Consolidation',
        url: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
      },
    ],
  },
  {
    recommendationId: 'rec-content-empty-controls',
    ruleIds: ['CONTENT_EMPTY_BUTTON', 'CONTENT_EMPTY_LINK'],
    category: 'accessibility',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'One or more buttons or links have no accessible visible text or label.',
      'يوجد زر أو رابط بدون نص ظاهر أو اسم بديل مفهوم (مثل أزرار الأيقونات الفارغة).',
      'Static/DOM quality audit found `<button>` or `<a>` elements lacking text content, `aria-label`, `aria-labelledby`, or alt text inside nested images.',
      'رُصدت عناصر `<button>` أو `<a>` خالية من النص أو `aria-label` أو `aria-labelledby` أو `alt` لصورة داخلية.',
    ),
    impact: dual(
      'Screen-reader users only hear "button" or "link" without knowing what clicking it does.',
      'يسمع مستخدم قارئ الشاشة كلمة "زر" أو "رابط" دون معرفة وظيفته.',
      'Creates accessibility barriers (WCAG 2.4.4 / 4.1.2) and weakens internal anchor context.',
      'يعيق إمكانية الوصول (WCAG 2.4.4 / 4.1.2) ويُضعف دلالة الروابط الداخلية.',
    ),
    confirmedCauseTemplates: [
      bi(
        'HTML analyzer observed interactive `<a>` / `<button>` elements with zero accessible text.',
        'رصد الفحص عناصر `<a>` أو `<button>` بدون أي نص وصفي أو سمة تسمية.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Icon-only buttons/social links using CSS/SVG/font icons without an `aria-label` or screen-reader-only text span.',
        'أزرار أيقونات فقط (بحث/قائمة/تواصل اجتماعي) بدون إضافة `aria-label` أو نص مخفي بصرياً.',
      ),
    ],
    locationGuidance: dual(
      'Element selector/snippet reported in finding evidence.',
      'محدد العنصر أو مقتطف HTML في الأدلة.',
      'Add concise `aria-label` or `<span class="sr-only">` label describing the action or destination.',
      'أضف `aria-label` واضحاً أو نصاً مخصصاً لقارئات الشاشة يصف الفعل أو الوجهة.',
    ),
    remediationSteps: [
      step(
        1,
        'Give every icon-only button or link a clear `aria-label` (for example `aria-label="Open menu"` or `aria-label="Search"`) or remove accidental empty anchor tags.',
        'أضف `aria-label` يصف وظيفة كل زر/رابط يحتوي أيقونة فقط، أو احذف الروابط الفارغة الناتجة عن خطأ تنسيق.',
        'Supply descriptive `aria-label` / `<span class="visually-hidden">` on icon controls and remove stray empty `<a>`/`<button>` wrappers.',
        'أضف `aria-label` أو نصاً مخفياً بصرياً لأزرار الأيقونات واحذف الروابط الفارغة العرضية.',
      ),
    ],
    codeExamples: [
      {
        title: bi('Accessible icon button example', 'مثال زر أيقونة متاح لقارئات الشاشة'),
        language: 'html',
        scopeDisclaimer: bi(
          'Use accurate action descriptions in the page language.',
          'اكتب وصفاً دقيقاً للإجراء بلغة الصفحة نفسها.',
        ),
        requiredEvidenceTag: 'always_relevant',
        snippet:
          '<button type="button" aria-label="Open navigation menu">\n  <svg aria-hidden="true"><!-- icon --></svg>\n</button>',
      },
    ],
    verificationSteps: [
      step(
        1,
        'Inspect button/link Accessibility Name in browser DevTools and re-scan.',
        'تحقق من ظهور Accessible Name للأزرار والروابط في أدوات المطور ثم أعد الفحص.',
        'Confirm every interactive link/button exposes a non-empty accessible name and re-scan.',
        'تأكد من توفر اسم وصول لكل رابط وزر ثم أعد الفحص.',
      ),
    ],
    limitations: [A11Y_LIMITATION],
    references: [
      {
        label: 'WCAG Link Purpose',
        url: 'https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html',
      },
    ],
  },
  {
    recommendationId: 'rec-content-thin-or-empty-page',
    ruleIds: [
      'CONTENT_EMPTY_PAGE',
      'CONTENT_THIN_TEXT',
      'CONTENT_HIGH_LINK_DENSITY',
      'CONTENT_REPEATED_HEADINGS',
    ],
    category: 'content-quality',
    supportedPlatforms: ['generic', 'wordpress'],
    causeConfidence: 'mixed',
    problem: dual(
      'Page text quality flags detected very thin/empty body text, excessive link-to-text ratio, or repeated identical headings.',
      'رُصدت مؤشرات جودة محتوى منخفضة: صفحة فارغة/شحيحة النص أو كثافة روابط مرتفعة مقارنة بالنص أو تكرار عناوين متطابقة.',
      'Content quality heuristics flagged low word count, empty main body, high anchor-density percentage, or repeated identical heading strings.',
      'سجلت قياسات المحتوى نصاً ضعيفاً/معدوماً أو نسبة روابط مرتفعة مقارنة بالنص أو تكراراً لعناوين متطابقة.',
    ),
    impact: dual(
      'Thin or repetitive pages provide little value to visitors and may perform weakly in search.',
      'الصفحات قليلة المحتوى أو المكررة العناوين تقدم فائدة محدودة للزوار وقد يضعف ظهورها.',
      'Note: utility routes (login, sitemap/directory, or client-rendered SPAs before JS hydration on static crawl) can trigger thin-text heuristics if static HTML is sparse.',
      'ملاحظة: قد تنطبق هذه القاعدة على صفحات تسجيل الدخول أو تطبيقات JS التي تبني محتواها بالكامل في المتصفح عند الفحص الثابت.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Static HTML text extraction measured word count / link density / heading repetition crossing configured threshold.',
        'تجاوزت قياسات النص والروابط والعناوين المستخرجة الحدود المحددة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Client-side JS rendering delaying text into runtime only, placeholder pages, or unexpanded taxonomy/archive pages.',
        'صفحة تعتمد على JavaScript فقط للعرض أو صفحة تجريبية فارغة أو صفحة تصنيف محدودة المحتوى.',
      ),
    ],
    locationGuidance: dual(
      'Main body copy and heading blocks on the affected page URL.',
      'المحتوى النصي الرئيسي والعناوين في الصفحة المحددة.',
      'Review extracted word counts and heading occurrences in finding evidence.',
      'راجع عدد الكلمات والعناوين المكررة المسجلة في الأدلة.',
    ),
    remediationSteps: [
      step(
        1,
        'Check whether the page legitimately serves thin utility content (consider `noindex` if non-editorial) or enrich public pages with clear, helpful, well-structured text.',
        'إذا كانت صفحة عامة فحسّنها بمحتوى واضح وعناوين متنوعة؛ وإذا كانت صفحة خدمية خاصة فراجع ما إذا كانت تحتاج `noindex`.',
        'Add meaningful server-rendered copy & unique subheadings on editorial/landing pages; apply `noindex` or consolidate sparse utility/tag archives where appropriate.',
        'أضف محتوى واضحاً وعناوين مميزة للصفحات العامة أو ضع `noindex` لصفحات الأرشيف الفارغة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Review rendered visible content and re-run scan.',
        'راجع النص الظاهر وبنية العناوين ثم أعد الفحص.',
        'Confirm improved content depth/structure and re-scan.',
        'تحقق من تحسن جودة النص والعناوين ثم أعد الفحص.',
      ),
    ],
    limitations: [
      bi(
        'Automated word-count and link-density thresholds are advisory heuristics, not absolute editorial rules.',
        'عتبات عدد الكلمات وكثافة الروابط مؤشرات إرشادية وتحتاج تقييماً حسب طبيعة الصفحة.',
      ),
    ],
    references: [
      {
        label: 'Google Helpful Content Guidance',
        url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
      },
    ],
  },

  // --- WordPress Platform Signals (4) ---
  {
    recommendationId: 'rec-wp-detected-informational',
    ruleIds: ['WP_DETECTED'],
    category: 'wordpress',
    supportedPlatforms: ['wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Informational discovery: WordPress CMS indicators were detected on the site.',
      'معلومة استكشافية: تم اكتشاف مؤشرات نظام إدارة المحتوى WordPress في الموقع.',
      'Passive HTTP/HTML inspection detected standard WordPress markers (`wp-content`, `wp-includes`, `wp-json`, or meta generator).',
      'رصد الفحص السلبي مؤشرات ووردبريس القياسية مثل `wp-content` أو `wp-json` أو وسم المولد.',
    ),
    impact: dual(
      'Not a vulnerability itself; this finding records platform detection so WordPress-specific maintenance and hardening checks stay relevant.',
      'ليست مشكلة بحد ذاتها؛ إنما توثيق لاكتشاف المنصة لتخصيص الإرشادات المرتبطة بصيانة وأمان ووردبريس.',
      'Confirms WordPress footprint for context-aware recommendations without asserting any flaw.',
      'يوثق اكتشاف ووردبريس لتقديم إرشادات متوافقة مع المنصة دون افتراض خلل أمني.',
    ),
    confirmedCauseTemplates: [
      bi(
        'WordPress HTML/header/asset markers were directly observed in crawl evidence.',
        'تم رصد مؤشرات ووردبريس مباشرة في أدلة الصفحات والترويسات.',
      ),
    ],
    possibleCauseTemplates: [],
    locationGuidance: dual(
      'Observed markers noted in finding evidence.',
      'المؤشرات المرصودة الموثقة في الأدلة.',
      'See `evidence` for specific detected paths, plugins, themes, or version clues.',
      'راجع حقل الأدلة لمعرفة القوالب أو الإضافات أو المسارات المكتشفة.',
    ),
    remediationSteps: [
      step(
        1,
        'No fix needed for platform presence; maintain regular WordPress core, theme, and plugin security updates and backups.',
        'لا يوجد خلل لإصلاحه هنا؛ احرص فقط على التحديث المنتظم لنواة ووردبريس والقوالب والإضافات والنسخ الاحتياطي.',
        'Keep WordPress core, active plugins, and themes updated and verify least-privilege admin access.',
        'حافظ على تحديث النواة والإضافات والقوالب وصلاحيات المدراء.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm your plugin/theme inventory aligns with observed WordPress markers.',
        'تأكد من أن القوالب والإضافات المرصودة مطابقة لما تستخدمه فعلاً.',
        'Review WordPress Site Health in admin dashboard during routine maintenance.',
        'راجع حالة الموقع (Site Health) في لوحة ووردبريس ضمن الصيانة الدورية.',
      ),
    ],
    limitations: [WP_SURFACE_LIMITATION],
    references: [
      {
        label: 'WordPress Hardening Guide',
        url: 'https://developer.wordpress.org/advanced-administration/security/hardening/',
      },
    ],
  },
  {
    recommendationId: 'rec-wp-version-disclosed',
    ruleIds: ['WP_VERSION_DISCLOSED'],
    category: 'wordpress',
    supportedPlatforms: ['wordpress'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The site publicly advertises its exact WordPress version number in HTML or asset query strings.',
      'يعرض الموقع رقم إصدار ووردبريس الدقيق علناً في الكود المصدري أو روابط الأصول.',
      'Passive crawl observed `<meta name="generator" content="WordPress ...">` or core `?ver=` asset signatures disclosing version info.',
      'كشف الفحص السلبي عن رقم إصدار ووردبريس في `<meta name="generator">` أو معلمات `?ver=`.',
    ),
    impact: dual(
      'Informational/Low defense-in-depth note: hiding the version does not patch bugs, so keeping core updated matters far more than hiding version strings.',
      'تأثير منخفض الوقائية: إخفاء الرقم لا يعالج الثغرات إذا وُجدت، لذا يظل التحديث الفعلي للنواة هو الأهم.',
      'Minor information disclosure used by automated scanners for fingerprinting.',
      'يكشف معلومات الإصدار لبرامج المسح الآلية لكنه يظل إجراء تحصين ثانوي بعد التحديث الفوري.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Exact WordPress version string observed in HTML meta generator or asset URLs.',
        'رُصد رقم إصدار ووردبريس مباشرة في وسم المولد أو روابط الملفات.',
      ),
    ],
    locationGuidance: dual(
      'Document `<head>` `<meta name="generator">` and asset links.',
      'وسم `<meta name="generator">` أو روابط الأصول في `<head>`.',
      'Inspect generator tag / RSS feeds / core CSS query strings.',
      'افحص وسم generator أو روابط ملفات النواة.',
    ),
    remediationSteps: [
      step(
        1,
        'First verify WordPress core and plugins are up to date; optionally remove the HTML generator tag if desired for minimal fingerprinting.',
        'تأكد أولاً من تحديث ووردبريس والإضافات، ويمكنك اختيارياً إزالة وسم `generator` لتقليل البصمة الظاهرة.',
        'Ensure latest WordPress core patch level is installed; optionally strip `wp_generator` output via a clean mu-plugin/theme filter tested in staging.',
        'أبقِ ووردبريس محدثاً أولاً، ويمكنك إزالة `wp_generator` عبر فلتر نظيف في بيئة تجريبية.',
      ),
    ],
    codeExamples: [
      {
        title: bi(
          'Optional WordPress generator meta removal hook (staging-tested)',
          'مثال اختياري لإزالة وسم المولد في ووردبريس',
        ),
        language: 'php',
        scopeDisclaimer: bi(
          'Only apply inside a custom child theme/mu-plugin if desired; test in staging first and do NOT rely on this in place of updates.',
          'استخدمه فقط في قالب فرعي أو mu-plugin بعد التجربة ولا تستبدل به التحديثات الأمنية.',
        ),
        requiredEvidenceTag: 'wordpress_core',
        snippet: "remove_action('wp_head', 'wp_generator');",
      },
    ],
    verificationSteps: [
      step(
        1,
        'View page source to check generator tag removal and verify WordPress Site Health reports up-to-date core.',
        'راجع مصدر الصفحة للتأكد من إزالة الوسم ومن تحديث النواة ثم أعد الفحص.',
        'Confirm generator meta omission and current core update status, then re-scan.',
        'تحقق من اختفاء الوسم وحداثة الإصدار ثم أعد الفحص.',
      ),
    ],
    limitations: [WP_SURFACE_LIMITATION],
    references: [
      {
        label: 'WordPress Security Hardening',
        url: 'https://developer.wordpress.org/advanced-administration/security/hardening/',
      },
    ],
  },
  {
    recommendationId: 'rec-wp-rest-api-advertised',
    ruleIds: ['WP_REST_API_ADVERTISED'],
    category: 'wordpress',
    supportedPlatforms: ['wordpress', 'woocommerce'],
    causeConfidence: 'mixed',
    problem: dual(
      'WordPress advertises its public REST API discovery links (`wp-json`).',
      'يعلن الموقع علناً عن روابط واجهة WordPress REST API (`wp-json`).',
      'Observed `Link: <.../wp-json/>; rel="https://api.w.org/"` HTTP header or HTML link discovery.',
      'رُصدت ترويسة أو رابط استكشاف REST API القياسي الخاص بووردبريس.',
    ),
    impact: dual(
      'Note: Block Editor (Gutenberg), WooCommerce blocks, Contact Form plugins, and Elementor rely on REST API endpoints; disabling REST API entirely often breaks site features.',
      'ملاحظة: يعتمد محرر المكونات وWooCommerce وElementor وكثير من النماذج على REST API، لذا تعطيلها كلياً قد يكسر وظائف الموقع.',
      'Informational surface note: validate endpoint permissions (e.g. user enumeration or custom route auth) rather than blindly disabling `/wp-json/`.',
      'ملاحظة استطلاعية: يُنصح بالتحقق من صلاحيات نقاط النهاية الحساسة بدلاً من تعطيل REST API بالكامل لما قد يسببه من أعطال.',
    ),
    confirmedCauseTemplates: [
      bi(
        'HTTP headers or HTML `<head>` advertised `api.w.org` REST discovery.',
        'أعلنت ترويسات HTTP أو `<head>` عن نقطة اكتشاف REST API.',
      ),
    ],
    locationGuidance: dual(
      'HTTP `Link` header or `<head>` `<link rel="https://api.w.org/">`.',
      'ترويسة HTTP `Link` أو وسم `<link rel="https://api.w.org/">`.',
      'Audit which REST API namespaces are intentionally public vs unneeded.',
      'افحص مساحات الأسماء المكشوفة في `/wp-json/` وتأكد من صلاحياتها.',
    ),
    remediationSteps: [
      step(
        1,
        'Keep REST API working for editor/forms/WooCommerce, while ensuring unauthenticated endpoints do not expose unintended sensitive data.',
        'أبقِ REST API عاملاً للنماذج والمحرر والمتجر مع التأكد من تقييد نقاط النهاية الخاصة فقط.',
        'Verify authentication permissions on custom endpoints and review `/wp-json/wp/v2/users` disclosure policy per your security baseline without breaking required frontend plugins.',
        'تحقق من صلاحيات النقاط المخصصة وسياسة كشف أسماء المستخدمين دون تعطيل الإضافات المعتمدة عليها.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Test forms, cart/checkout, and admin block editor after any REST hardening tweak, then re-scan.',
        'اختبر النماذج والسلة ومحرر المقالات بعد أي تعديل ثم أعد الفحص.',
        'Confirm critical WordPress frontend/editor workflows work cleanly.',
        'تأكد من استمرار عمل النماذج والمحرر بشكل طبيعي.',
      ),
    ],
    limitations: [WP_SURFACE_LIMITATION],
    references: [
      { label: 'WordPress REST API Handbook', url: 'https://developer.wordpress.org/rest-api/' },
    ],
  },
  {
    recommendationId: 'rec-wp-xmlrpc-pingback',
    ruleIds: ['WP_XMLRPC_PINGBACK_ADVERTISED'],
    category: 'wordpress',
    supportedPlatforms: ['wordpress', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'WordPress advertises `xmlrpc.php` / `X-Pingback` support.',
      'يعلن الموقع عن دعم `xmlrpc.php` وترويسة `X-Pingback`.',
      'Response exposed `X-Pingback` HTTP header or `<link rel="pingback">` pointing to `/xmlrpc.php`.',
      'كشفت الاستجابة عن ترويسة `X-Pingback` أو وسم `<link rel="pingback">` نحو `/xmlrpc.php`.',
    ),
    impact: dual(
      'If unused, XML-RPC endpoints are frequently targeted by credential brute-force amplification or pingback abuse bots.',
      'إذا لم تكن تستخدم XML-RPC، غالباً ما يستهدفه المهاجمون بمحاولات تخمين كلمات المرور المتسارعة.',
      'Increases authentication brute-force surface unless required by Jetpack/mobile apps or protected by WAF/rate-limiting.',
      'يوسع سطح محاولات التخمين ما لم يكن محمياً أو مستخدماً من تطبيقات موثوقة مثل Jetpack.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Response advertised `X-Pingback` header or pingback link to `xmlrpc.php`.',
        'أعلنت الاستجابة صراحة عن `X-Pingback` أو رابط `xmlrpc.php`.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Default WordPress behavior leaves `xmlrpc.php` and `X-Pingback` active unless explicitly disabled.',
        'الإعداد الافتراضي في ووردبريس يُبقي `xmlrpc.php` و`X-Pingback` مفعلين.',
      ),
    ],
    locationGuidance: dual(
      'HTTP `X-Pingback` header / `<head>` link and `/xmlrpc.php`.',
      'ترويسة `X-Pingback` وملف `/xmlrpc.php`.',
      'Verify first if Jetpack, WordPress mobile app, or legacy integrations depend on `xmlrpc.php`.',
      'تحقق أولاً من عدم اعتماد إضافات مثل Jetpack أو تطبيق الجوال على `xmlrpc.php`.',
    ),
    remediationSteps: [
      step(
        1,
        'Confirm no active service (like Jetpack or WordPress app) needs XML-RPC; if unused, disable XML-RPC authentication or block `/xmlrpc.php` via WAF/server rule.',
        'تأكد أولاً من عدم الحاجة لـ XML-RPC (مثل Jetpack)، ثم يمكنك تعطيله أو تقييد الوصول لـ `/xmlrpc.php` عبر الخادم أو WAF.',
        'Test disabling `xmlrpc_enabled` filter or restricting `/xmlrpc.php` at web server/CDN level if unused, keeping Jetpack allowlists intact if active.',
        'اختبر تعطيل فلتر `xmlrpc_enabled` أو تقييد `/xmlrpc.php` في الخادم إذا لم يكن مطلوباً.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm integrations still operate and verify expected XML-RPC policy, then re-scan.',
        'تأكد من عمل الموقع وتطبيقاته المرتبطة ثم أعد الفحص.',
        'Verify targeted XML-RPC posture without breaking legitimate integrations.',
        'تحقق من تطبيق السياسة المطلوبة دون تعطيل التكاملات المشروعة.',
      ),
    ],
    limitations: [WP_SURFACE_LIMITATION],
    references: [
      {
        label: 'WordPress Hardening & Security',
        url: 'https://developer.wordpress.org/advanced-administration/security/hardening/',
      },
    ],
  },

  // --- System Telemetry (1) ---
  {
    recommendationId: 'rec-sys-browser-unavailable',
    ruleIds: ['SYS_BROWSER_UNAVAILABLE'],
    category: 'system',
    supportedPlatforms: ['generic'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Headless browser checks could not run in this audit environment (Chromium/Playwright unavailable or failed to launch).',
      'تعذّر تشغيل فحوص المتصفح الآلي في هذه البيئة، لذا تم استبعاد الفحوص البصرية والتشغيلية أو تأشيرها كغير متاحة.',
      'Browser runtime/accessibility/CLS/viewport verification could not execute because browser engine launch failed or binary was unavailable.',
      'تعذّر تنفيذ فحوص المتصفح (التشغيل، إمكانية الوصول، CLS، الشاشات المتجاوبة) لعدم توافر المتصفح أو فشل تشغيله.',
    ),
    impact: dual(
      'Notice: Runtime errors, visual responsiveness, CLS, and accessibility checks remain unverified for this scan — they are NOT passing checks.',
      'تنبيه: فحوص إمكانية الوصول والاستجابة وأخطاء التشغيل وCLS غير مفحوصة في هذا التقرير ولا تعني نجاحاً.',
      'System meta-telemetry warning (excluded from Health Index numerator penalties while reducing Audit Coverage & Confidence).',
      'ملاحظة نظامية (تُستبعد من خصم مؤشر الصحة وتُخفض نسبة التغطية وموثوقية التقرير بشفافية).',
    ),
    confirmedCauseTemplates: [
      bi(
        'Audit orchestrator emitted SYS_BROWSER_UNAVAILABLE because browser launch/binary initialization failed.',
        'أصدر منسق الفحص التنبيه `SYS_BROWSER_UNAVAILABLE` لفشل تهيئة المتصفح.',
      ),
    ],
    locationGuidance: dual(
      'Local auditor runtime / Playwright Chromium executable configuration.',
      'إعدادات المتصفح المحلي Playwright داخل أداة الفحص.',
      'Verify `.browsers` Chromium installation and OS sandbox/dependency readiness.',
      'تحقق من وجود حزمة المتصفح في مجلد `.browsers` وصلاحيات تشغيله محلياً.',
    ),
    remediationSteps: [
      step(
        1,
        'Verify the project Chromium browser binary is installed in the configured local `.browsers` folder, then re-run a Full Audit.',
        'تأكد من توفر متصفح Chromium في المسار المحلي المعتمد `.browsers` ثم أعد تشغيل فحص كامل.',
        'Confirm Chromium binary integrity under project browser cache path without bypassing security policies, then re-run the scan.',
        'تحقق من وجود ملفات متصفح المشروع محلياً وسلامتها ثم أعد تشغيل الفحص الكامل.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Re-run the scan and confirm D3 (Runtime/A11y) and D4 (Responsive/CLS) show executed coverage.',
        'أعد الفحص وتأكد من تفعيل أبعاد D3 وD4 في التغطية.',
        'Verify `SYS_BROWSER_UNAVAILABLE` disappears and browser coverage > 0.',
        'تحقق من اختفاء التنبيه وعمل أبعاد المتصفح.',
      ),
    ],
    limitations: [
      bi(
        'This is an audit execution telemetry alert rather than a website defect.',
        'هذا تنبيه تشغيلي يتعلق ببيئة الفحص نفسها وليس خللاً في الموقع المفحوص.',
      ),
    ],
    references: [
      { label: 'Project Browser Runtime Docs', url: 'https://playwright.dev/docs/browsers' },
    ],
  },

  // --- High-Impact Specific WCAG Rules + Dynamic axe-core Families ---
  {
    recommendationId: 'rec-a11y-color-contrast',
    ruleIds: ['a11y-color-contrast', 'a11y-color-contrast-enhanced'],
    category: 'accessibility',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Text color contrast against its background is too low to read comfortably.',
      'تباين لون النص مع الخلفية منخفض ويصعّب القراءة.',
      'Automated WCAG contrast check detected foreground/background luminance contrast ratio below 4.5:1 (normal text) or 3:1 (large text).',
      'رصد فحص WCAG نسبة تباين أقل من الحد الأدنى المطلوب (4.5:1 للنص العادي أو 3:1 للنص الكبير).',
    ),
    impact: dual(
      'Users with low vision, color blindness, or bright-sunlight screens struggle to read buttons and copy.',
      'يعاني ضعاف البصر ومستخدمو الشاشات في الإضاءة القوية من صعوبة قراءة النصوص والأزرار.',
      'Fails WCAG 1.4.3 Contrast (Minimum) AA readability criteria.',
      'يخالف معيار التباين الأدنى WCAG 1.4.3 AA.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Computed CSS color and background luminance fell below WCAG contrast minimum.',
        'كانت نسبة التباين المحسوبة بين لون النص والخلفية دون الحد الأدنى في WCAG.',
      ),
    ],
    locationGuidance: dual(
      'Reported element selector(s) in node evidence.',
      'محددات العناصر المذكورة في أدلة الفحص.',
      'Inspect computed `color` and `background-color` (and overlay opacity) on listed node selectors.',
      'افحص لون النص والخلفية المحسوبين للعناصر المحددة.',
    ),
    remediationSteps: [
      step(
        1,
        'Darken light text on light backgrounds (or lighten text on dark backgrounds) until contrast reaches at least 4.5:1 (3:1 for large headings).',
        'غمّق النص على الخلفية الفاتحة أو افتح اللون على الخلفية الداكنة ليصل التباين إلى 4.5:1 على الأقل.',
        'Adjust CSS color tokens/element styles to achieve >= 4.5:1 for normal text and >= 3.0:1 for bold >= 18.66px or >= 24px text.',
        'اضبط ألوان النص أو الخلفية في CSS لتحقيق >= 4.5:1 للنص العادي و>= 3:1 للنص الكبير.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Check contrast ratio badge in DevTools Elements / Accessibility inspector and re-scan.',
        'تحقق من نسبة التباين في فاحص الألوان بأدوات المطور ثم أعد الفحص.',
        'Verify updated computed contrast passes AA ratio and re-run audit.',
        'تأكد من تجاوز نسبة التباين للحد الأدنى ثم أعد الفحص.',
      ),
    ],
    limitations: [A11Y_LIMITATION],
    references: [
      {
        label: 'WCAG 1.4.3 Contrast Minimum',
        url: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
      },
    ],
  },
  {
    recommendationId: 'rec-a11y-image-alt',
    ruleIds: [
      'a11y-image-alt',
      'a11y-input-image-alt',
      'a11y-area-alt',
      'a11y-svg-img-alt',
      'a11y-object-alt',
    ],
    category: 'accessibility',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Images or graphical controls lack accessible alternative text.',
      'تفتقد صور أو رسوم أو أزرار مصورة إلى نص بديل مقروء لقارئات الشاشة.',
      'Automated WCAG non-text check flagged `<img>`, `<input type="image">`, `<svg role="img">`, or `<area>` missing an accessible name.',
      'رصد فحص إمكانية الوصول عناصر صور أو رسومات SVG بدون نص بديل أو اسم وصول.',
    ),
    impact: dual(
      'Screen-reader users receive no information about visual content or image buttons.',
      'يحرم مستخدمي قارئات الشاشة من فهم محتوى الصورة أو وظيفة الزر المصور.',
      'Fails WCAG 1.1.1 Non-text Content.',
      'يخالف معيار المحتوى غير النصي WCAG 1.1.1.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Rendered image/graphic node had empty or missing accessible name.',
        'كان للعنصر الرسومي المرصود اسم وصول مفقود أو فارغ.',
      ),
    ],
    locationGuidance: dual(
      'Reported selector(s) in `evidence.nodes`.',
      'المحددات المذكورة في `evidence.nodes`.',
      'Check `alt` attribute (for `<img>`) or `aria-label` / `<title>` (for `<svg role="img">`).',
      'تحقق من سمة `alt` للصور أو `aria-label` لرسوم SVG.',
    ),
    remediationSteps: [
      step(
        1,
        'Add descriptive `alt="..."` for informative images, `alt=""` (plus `aria-hidden="true"` on decorative SVGs) for purely decorative visuals.',
        'أضف `alt="..."` وصفياً للصور المهمة، أو `alt=""` للصور الزخرفية البحتة.',
        'Provide meaningful concise alt text or explicitly mark purely decorative media with `alt=""` / `aria-hidden="true"`.',
        'أضف نصاً بديلاً دقيقاً أو ضع `alt=""` / `aria-hidden="true"` للعناصر الزخرفية.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Inspect Accessibility Tree name for reported elements and re-scan.',
        'تحقق من اسم العنصر في شجرة الوصول ثم أعد الفحص.',
        'Confirm non-decorative visuals expose meaningful names and re-scan.',
        'تأكد من ظهور الاسم البديل المناسب ثم أعد الفحص.',
      ),
    ],
    limitations: [A11Y_LIMITATION],
    references: [
      {
        label: 'WCAG 1.1.1 Non-text Content',
        url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
      },
    ],
  },
  {
    recommendationId: 'rec-a11y-accessible-names-and-labels',
    ruleIds: [
      'a11y-label',
      'a11y-button-name',
      'a11y-link-name',
      'a11y-select-name',
      'a11y-input-button-name',
    ],
    category: 'accessibility',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Form inputs, buttons, or links are missing descriptive labels or accessible names.',
      'تفتقد حقول النماذج أو الأزرار أو الروابط إلى تسميات واضحة مقروءة.',
      'Rendered interactive element (`input`, `select`, `button`, `a`) exposes no programmatic accessible name.',
      'العنصر التفاعلي المرصود (`input` أو `select` أو `button` أو `a`) لا يمتلك اسماً برمجياً متاحاً.',
    ),
    impact: dual(
      'Screen-reader and keyboard users cannot tell what field they are filling or what a button submits.',
      'لا يعرف مستخدم قارئ الشاشة وظيفة الحقل أو الزر الذي ينقر عليه.',
      'Fails WCAG 4.1.2 Name, Role, Value and 3.3.2 Labels/Instructions.',
      'يخالف معايير WCAG 4.1.2 و3.3.2.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Accessibility tree computed empty accessible name for interactive control.',
        'حسبت شجرة الوصول اسماً برمجياً فارغاً لعنصر التحكم.',
      ),
    ],
    locationGuidance: dual(
      'Reported form/control selector(s) in node evidence.',
      'محددات الحقول والأزرار في الأدلة.',
      'Inspect `<label for="...">`, `aria-label`, or inner visible text on the listed control.',
      'تحقق من وجود `<label for="...">` أو `aria-label` أو نص ظاهر للعنصر.',
    ),
    remediationSteps: [
      step(
        1,
        'Associate a visible `<label for="id">` with every input/select and ensure every button/link has descriptive text or `aria-label`.',
        'اربط كل حقل بوسم `<label for="id">` واضح وأضف نصاً أو `aria-label` لكل زر ورابط.',
        'Bind explicit `<label for>` elements (never rely solely on `placeholder`) and provide programmatic names for icon controls.',
        'اربط كل حقل بـ `<label>` صريح ولا تعتمد على `placeholder` وحده، وأضف `aria-label` لأزرار الأيقونات.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify Accessibility Name in DevTools for each flagged control and re-scan.',
        'تحقق من ظهور الاسم البرمجي لكل عنصر في أدوات المطور ثم أعد الفحص.',
        'Confirm populated accessible names in accessibility tree and re-scan.',
        'تأكد من اكتمال أسماء الوصول ثم أعد الفحص.',
      ),
    ],
    limitations: [A11Y_LIMITATION],
    references: [
      { label: 'W3C Labeling Controls', url: 'https://www.w3.org/WAI/tutorials/forms/labels/' },
    ],
  },
  // --- Generic Dynamic Prefix Fallbacks for all remaining axe-core rules ---
  {
    recommendationId: 'rec-a11y-needs-manual-review-generic',
    ruleIds: [],
    ruleIdPrefixes: ['a11y-review-'],
    category: 'accessibility',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'needs_manual_review',
    problem: dual(
      'An automated accessibility check was inconclusive and requires manual verification.',
      'أرجع فحص إمكانية الوصول نتيجة غير حاسمة وتتطلب تحققاً يدوياً.',
      'Automated axe-core incomplete rule could not conclusively pass or fail due to visual overlays, dynamic states, canvas, or context-dependent contrast.',
      'تعذّر على الفحص الآلي الحسم في هذه القاعدة بسبب تداخل خلفيات أو حالات ديناميكية أو سياق يتطلب تقييماً بشرياً.',
    ),
    impact: dual(
      'Could affect assistive-technology users if confirmed during manual review; not treated as a confirmed failure automatically.',
      'قد يؤثر على مستخدمي التقنيات المساعدة إذا تأكد بالفحص اليدوي، ولا يُعد فشلاً مؤكداً تلقائياً.',
      'Preserved explicitly as `needs_manual_review` / `potential` confidence without inflating failure severity.',
      'محفوظ بصفته يتطلب مراجعة يدوية وبثقة محتملة دون تضخيم تلقائي.',
    ),
    confirmedCauseTemplates: [],
    possibleCauseTemplates: [
      bi(
        'Automated analyzer encountered an indeterminate condition (review `reviewReason` and node selector in preserved evidence).',
        'واجه المحلل شرطاً غير حاسم (راجع سبب المراجعة والمحدد في الأدلة المحفوظة).',
      ),
    ],
    locationGuidance: dual(
      'Inspect `reviewReason` and listed element selector(s) in raw evidence.',
      'راجع سبب المراجعة ومحددات العناصر في الأدلة الخام.',
      'Review `evidence.reviewReason`, `wcagCriteria`, and `nodes` to manually inspect rendered state.',
      'راجع `reviewReason` والمعايير المرتبطة في الأدلة للفحص البصري اليدوي.',
    ),
    remediationSteps: [
      step(
        1,
        'Manually inspect the listed element in the browser using keyboard Tab navigation and a contrast/screen-reader check; fix only if confirmed problematic.',
        'افحص العنصر يدوياً في المتصفح بالتنقل بلوحة المفاتيح وفحص التباين وقارئ الشاشة، وأصلحه فقط إذا ثبت وجود خلل فعلي.',
        'Verify the rendered state manually against `evidence.wcagCriteria` and `evidence.helpUrl`; remediate if human review confirms non-conformance.',
        'تحقق من الحالة الفعلية مع المرجع المذكور وعالجها إذا أثبتت المراجعة اليدوية وجود عائق.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Document manual review conclusion (confirmed fixed vs verified compliant).',
        'وثّق نتيجة المراجعة اليدوية للتأكد من سلامة التجربة.',
        'Verify via keyboard and assistive-tech manual inspection.',
        'تحقق يدوياً عبر لوحة المفاتيح وقارئ الشاشة.',
      ),
    ],
    limitations: [A11Y_LIMITATION],
    references: [
      { label: 'W3C WCAG Evaluation Methodology', url: 'https://www.w3.org/WAI/test-evaluate/' },
    ],
  },
  {
    recommendationId: 'rec-a11y-best-practice-generic',
    ruleIds: [],
    ruleIdPrefixes: ['a11y-bp-'],
    category: 'accessibility-best-practice',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'An accessibility best-practice structural improvement was detected on this page.',
      'تم رصد فرصة تحسين في أفضل ممارسات بنية إمكانية الوصول في هذه الصفحة.',
      'Automated accessibility engine flagged a non-strict-WCAG best-practice rule (such as landmarks, heading progression, or region naming).',
      'رصد محرك الفحص ملاحظة ضمن أفضل ممارسات إمكانية الوصول (مثل تنظيم المعالم أو تسلسل العناوين).',
    ),
    impact: dual(
      'Improves navigation ease and structural clarity for keyboard and screen-reader users.',
      'تحسين هذه الممارسات يسهل التنقل وفهم بنية الصفحة لمستخدمي قارئات الشاشة.',
      'Enhances semantic navigation landmarks and assistive-tech usability beyond minimum baseline rules.',
      'يعزز وضوح البنية الدلالية وسهولة التنقل.',
    ),
    confirmedCauseTemplates: [
      bi(
        'DOM accessibility best-practice rule flagged the reported selector(s).',
        'رصدت قاعدة أفضل الممارسات العناصر المحددة في الأدلة.',
      ),
    ],
    locationGuidance: dual(
      'Reported element selector(s) and `helpUrl` in raw evidence.',
      'محددات العناصر والرابط المرجعي في الأدلة.',
      'Follow exact element targets and rule description in preserved `evidence.nodes` and `evidence.helpUrl`.',
      'اتبع محددات العناصر ورابط القاعدة في الأدلة الخام.',
    ),
    remediationSteps: [
      step(
        1,
        'Apply semantic HTML improvements (proper landmarks like `<main>`, `<nav>`, unique region labels, sequential headings) on the flagged elements.',
        'طبّق البنية الدلالية الصحيحة مثل `<main>` و`<nav>` وتسلسل العناوين على العناصر المذكورة.',
        'Update markup at the flagged selector(s) following the axe best-practice rule specification.',
        'عدّل البنية الدلالية في المواضع المحددة وفق مواصفات القاعدة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Re-check Accessibility Tree landmarks/structure and re-scan.',
        'تحقق من شجرة الوصول في أدوات المطور ثم أعد الفحص.',
        'Verify updated semantics clear the rule on fresh browser scan.',
        'تأكد من اجتياز الفحص عند إعادة التشغيل.',
      ),
    ],
    limitations: [A11Y_LIMITATION],
    references: [
      {
        label: 'W3C WAI Page Structure Tutorials',
        url: 'https://www.w3.org/WAI/tutorials/page-structure/',
      },
    ],
  },
  {
    recommendationId: 'rec-a11y-wcag-generic',
    ruleIds: [],
    ruleIdPrefixes: ['a11y-'],
    category: 'accessibility',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'An automated WCAG accessibility rule violation was detected on page elements.',
      'تم رصد مخالفة لقاعدة إمكانية الوصول (WCAG) في عناصر بالصفحة.',
      'Automated axe-core WCAG rule violation observed in rendered DOM; see exact rule details, WCAG criteria, and node selectors in evidence.',
      'رُصدت مخالفة WCAG آلية في شجرة DOM المعروضة؛ راجع المعيار والمحددات الدقيقة في الأدلة.',
    ),
    impact: dual(
      'Can prevent users with disabilities or keyboard-only users from accessing content or controls reliably.',
      'قد تعيق ذوي الإعاقة البصرية أو مستخدمي لوحة المفاتيح عن قراءة المحتوى أو التفاعل معه.',
      'Affects measurable WCAG conformance criteria listed in finding evidence.',
      'يؤثر على استيفاء معايير WCAG المذكورة في الأدلة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Automated DOM/ARIA inspection failed the cited WCAG rule on the listed node selector(s).',
        'فشل الفحص الآلي في القاعدة المذكورة على المحددات المسجلة.',
      ),
    ],
    locationGuidance: dual(
      'Reported selector(s), HTML snippet, and `helpUrl` in evidence.',
      'محددات العناصر والمقتطف ورابط القاعدة في الأدلة.',
      'Inspect `evidence.nodes` and `evidence.wcagCriteria` for exact target markup.',
      'افحص `evidence.nodes` و`evidence.wcagCriteria` لتحديد الكود المتأثر بدقة.',
    ),
    remediationSteps: [
      step(
        1,
        'Inspect the flagged element(s) and update semantic HTML / ARIA attributes / focus handling to meet the cited WCAG criterion.',
        'افحص العناصر المذكورة وعدّل وسوم HTML أو سمات ARIA أو دعم لوحة المفاتيح وفق المعيار المذكور.',
        'Resolve the failing check reported in `evidence.nodes[*].failureSummary` following `evidence.helpUrl`.',
        'عالج سبب الفشل الموثق في `failureSummary` وفق إرشادات `helpUrl`.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Test the updated component using keyboard navigation and screen reader/DevTools inspector, then re-scan.',
        'اختبر العنصر بلوحة المفاتيح وأدوات الفحص ثم أعد الفحص.',
        'Confirm automated WCAG rule passes and manually spot-check keyboard usability.',
        'تأكد من نجاح القاعدة عند إعادة الفحص مع اختبار لوحة المفاتيح.',
      ),
    ],
    limitations: [A11Y_LIMITATION],
    references: [
      { label: 'W3C WCAG 2.1 Quick Reference', url: 'https://www.w3.org/WAI/WCAG21/quickref/' },
    ],
  },
];
