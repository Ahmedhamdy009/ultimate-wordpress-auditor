import { bi, dual, step, type RecommendationEntry } from './types.js';

const PERF_LAB_LIMITATION = bi(
  'Performance timings reflect controlled laboratory audit runs rather than field user monitoring (CrUX); server distance, cold caches, and device CPU affect results.',
  'تعكس قياسات الأداء ظروف الاختبار المعملي أثناء الفحص ولا تمثل بيانات المستخدمين الفعلية (CrUX)؛ وتتأثر بحالة الكاش وبُعد الخادم.',
);

const RESPONSIVE_LIMITATION = bi(
  'Evaluated across the audited headless browser viewport sizes only; real physical devices, OS font scaling, and user interactions can vary.',
  'تم التقييم عبر مقاسات الشاشات المفحوصة في المتصفح فقط؛ وقد يختلف السلوك على الأجهزة الفعلية أو عند تكبير الخطوط.',
);

const WP_PERF_CACHE_NOTE = {
  platform: 'wordpress' as const,
  requiredEvidenceNote: bi(
    'Shown only because WordPress was detected in scan evidence.',
    'يظهر فقط لأن ووردبريس مكتشف في أدلة الفحص.',
  ),
  summary: dual(
    'On WordPress sites, consider page caching and avoiding heavy unused plugins or uncompressed assets if confirmed by response telemetry.',
    'في مواقع ووردبريس، يُساعد التخزين المؤقت للصفحات وتقليل الإضافات الثقيلة غير المستخدمة عند تأكيد البطء في الأدلة.',
    'Review active WordPress plugins enqueuing frontend assets on unrelated routes and ensure valid page/object cache headers (only when not bypassing logged-in/cart cookies).',
    'راجع الإضافات التي تحمّل ملفات CSS/JS في كل الصفحات دون حاجة، وتحقق من فاعلية التخزين المؤقت دون التأثير على الجلسات أو السلة.',
  ),
  steps: [
    bi(
      'Dequeue unused plugin scripts/styles on non-matching templates in a staging environment first.',
      'جرّب تعطيل أصول الإضافات في الصفحات التي لا تحتاجها داخل بيئة تجريبية أولاً.',
    ),
  ],
};

const CDN_CACHE_HINT_NOTE = {
  platform: 'cdn_cache' as const,
  requiredEvidenceNote: bi(
    'Shown only because CDN/cache headers were observed in HTTP evidence.',
    'يظهر فقط لوجود مؤشرات CDN أو تخزين مؤقت في ترويسات الاستجابة.',
  ),
  summary: dual(
    'Response headers indicate a CDN or cache layer is present; check cache hit status and compression/edge rules there.',
    'تُظهر ترويسات الاستجابة وجود طبقة CDN أو تخزين مؤقت؛ راجع حالة إصابة الكاش وقواعد الضغط فيها.',
    'Inspect CDN/cache response headers (cache status, Cache-Control TTL, Brotli/Gzip edge compression) to confirm origin bottlenecks are not simply cold cache misses.',
    'افحص ترويسات الـ CDN والكاش للتأكد من تفعيل الضغط وفاعلية Cache-Control وعدم هدر زمن الاستجابة بسبب Cache Miss.',
  ),
  steps: [
    bi(
      'Compare first uncached request vs warm cached response before attributing TTFB solely to origin hosting.',
      'قارن الطلب الأول غير المخزن بالطلب المخزن مؤقتاً قبل نسبة البطء للخادم الأصلي وحده.',
    ),
  ],
};

export const PERFORMANCE_RESPONSIVE_KB_ENTRIES: readonly RecommendationEntry[] = [
  // --- Performance TTFB / Server Latency (2) ---
  {
    recommendationId: 'rec-perf-slow-ttfb',
    ruleIds: ['PERF_SLOW_SERVER_RESPONSE', 'PERF_LAB_SLOW_TTFB'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'woocommerce', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'Initial server response time (TTFB) is slower than recommended thresholds.',
      'زمن استجابة الخادم الأولى (TTFB) أبطأ من الحد المستحسن.',
      'Observed laboratory Time to First Byte (TTFB) exceeded performance threshold before document download completed.',
      'تجاوز زمن البايت الأول (TTFB) المعملي الحد الموصى به قبل بدء استلام المستند.',
    ),
    impact: dual(
      'All subsequent rendering waits until the server sends the first HTML bytes, delaying FCP and LCP.',
      'يتأخر عرض كل ما في الصفحة (مثل FCP وLCP) بانتظار استجابة الخادم الأولى.',
      'Delays critical rendering path start across every subresource discovery step.',
      'يؤخر بدء مسار العرض الحرج واكتشاف الموارد اللاحقة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Measured TTFB exceeded threshold on the audited request.',
        'تجاوز زمن TTFB المقاس الحد المعتمد في الطلب المفحوص.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Cold cache miss during the test, heavy backend database queries, uncached dynamic rendering, or network distance to origin.',
        'قد يعود ذلك لعدم وجود نسخة مخبأة وقت الفحص أو بطء استعلامات الخادم أو بعد المسافة الجغرافية.',
      ),
    ],
    locationGuidance: dual(
      'Document navigation request and server/cache response timing.',
      'الطلب الرئيسي للمستند وتوقيت استجابة الخادم والكاش.',
      'Inspect initial document TTFB and response cache status headers.',
      'افحص توقيت TTFB وترويسات الكاش لطلب المستند الأولي.',
    ),
    remediationSteps: [
      step(
        1,
        'Measure whether repeated requests are fast (cache miss vs consistent slowness) and enable page caching where appropriate.',
        'اختبر الطلبات المتكررة لتمييز برودة الكاش عن البطء الدائم، وفعّل التخزين المؤقت للصفحات العامة.',
        'Profile backend generation/DB latency on cache miss and configure proper `Cache-Control`/edge caching for anonymous GET HTML.',
        'حلل بطء توليد الصفحة في الخادم عند غياب الكاش واضبط سياسات الكاش المناسبة للصفحات العامة.',
      ),
    ],
    platformGuidance: [WP_PERF_CACHE_NOTE, CDN_CACHE_HINT_NOTE],
    verificationSteps: [
      step(
        1,
        'Verify improved TTFB across multiple warm checks and re-run scan.',
        'تحقق من تحسن زمن TTFB في اختبارات متتالية ثم أعد الفحص.',
        'Confirm laboratory TTFB drops within threshold across test runs.',
        'تأكد من انخفاض TTFB المعملي ضمن الحد المستحسن ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev Optimize TTFB', url: 'https://web.dev/articles/optimize-ttfb' }],
  },
  // --- Lab Vitals FCP / LCP / TBT / Bottleneck (4) ---
  {
    recommendationId: 'rec-perf-lab-slow-fcp',
    ruleIds: ['PERF_LAB_SLOW_FCP'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'First Contentful Paint (FCP) took longer than recommended in lab testing.',
      'تأخر ظهور أول عنصر مرئي (First Contentful Paint - FCP) عن الحد المستحسن.',
      'Measured browser laboratory FCP exceeded budget; initial visible text or graphics appeared late.',
      'تجاوز قياس FCP المعملي الميزانية المستهدفة لتأخر رسم أول محتوى مرئي.',
    ),
    impact: dual(
      'Visitors stare at a blank screen longer before seeing confirmation that the page is loading.',
      'يشاهد الزائر شاشة بيضاء لفترة أطول قبل بدء ظهور المحتوى.',
      'Delayed visual feedback increases perceived bounce risk.',
      'يضعف الانطباع الأولي لسرعة استجابة الصفحة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Browser lab audit measured FCP exceeding target budget.',
        'قاس الفحص المعملي تأخراً في FCP عن الحد المعتمد.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Render-blocking CSS/JS in `<head>`, slow TTFB, or unpreloaded webfont blocking text paint.',
        'قد يكون السبب ملفات CSS/JS الحاجبة للعرض أو بطء TTFB أو تأخر الخطوط.',
      ),
    ],
    locationGuidance: dual(
      'Document `<head>` render-blocking stylesheets/scripts and initial server TTFB.',
      'ملفات الرأس `<head>` الحاجبة للعرض وزمن استجابة الخادم.',
      'Check render-blocking stylesheets/scripts prior to first paint.',
      'افحص موارد CSS/JS الحاجبة قبل أول رسم في `<head>`.',
    ),
    remediationSteps: [
      step(
        1,
        'Address slow TTFB, reduce render-blocking CSS/JS in `<head>`, and set `font-display: swap` on webfonts.',
        'عالج بطء TTFB وقلل ملفات CSS/JS الحاجبة في `<head>` مع استخدام `font-display: swap`.',
        'Eliminate unnecessary render-blocking stylesheets/scripts above the fold and ensure webfonts do not hide text (`font-display: swap`).',
        'أزل حجب العرض للأنماط والسكربتات غير الحرجة واستخدم `font-display: swap` للخطوط.',
      ),
    ],
    platformGuidance: [WP_PERF_CACHE_NOTE, CDN_CACHE_HINT_NOTE],
    verificationSteps: [
      step(
        1,
        'Verify FCP improves on laboratory re-test and re-scan.',
        'تحقق من تحسن FCP عند إعادة الاختبار ثم أعد الفحص.',
        'Re-run browser audit and confirm FCP returns within budget.',
        'أعد الفحص للتأكد من تحسن قيمة FCP المعملية.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev FCP Optimization', url: 'https://web.dev/articles/fcp' }],
  },
  {
    recommendationId: 'rec-perf-lab-slow-lcp',
    ruleIds: ['PERF_LAB_SLOW_LCP'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'Largest Contentful Paint (LCP) was slow during browser lab testing.',
      'استغرق أكبر عنصر محتوى مرئي (LCP) وقتاً طويلاً للظهور.',
      'Measured laboratory LCP exceeded target budget before the main hero image or text block painted.',
      'تجاوز مؤشر LCP المعملي الحد المستهدف قبل رسم المحتوى الرئيسي فوق الطية.',
    ),
    impact: dual(
      'The primary visual headline or hero banner loads noticeably late for visitors.',
      'يتأخر ظهور الصورة أو العنوان الرئيسي في أعلى الصفحة.',
      'Degrades perceived page load speed and Core Web Vitals LCP readiness.',
      'يؤثر مباشرة في سرعة الإدراك البصري واستعداد مؤشر LCP.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Laboratory performance collector recorded LCP above threshold.',
        'سجل جامع قياسات الأداء قيماً متأخرة لمؤشر LCP.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Uncompressed/oversized hero image, lazy-loaded LCP `<img>`, slow TTFB, or blocking head assets.',
        'قد ينتج عن صورة رئيسية ضخمة أو تأجيل تحميلها بـ lazy-load أو بطء TTFB أو موارد حاجبة.',
      ),
    ],
    locationGuidance: dual(
      'Above-the-fold hero image or main headline block (`lcpElement` if recorded in evidence).',
      'عنصر الصورة أو العنوان الرئيسي في أعلى الصفحة.',
      'Inspect the LCP element and waterfall discovery timing reported in telemetry.',
      'راجع العنصر المحدد لـ LCP وتسلسل تحميله في الأدلة.',
    ),
    remediationSteps: [
      step(
        1,
        'Optimize the hero image size/format (WebP/AVIF), ensure `loading="lazy"` is NOT applied to it, and prioritize its fetch (`fetchpriority="high"`).',
        'حسّن حجم وصيغة صورة الواجهة الرئيسية (WebP/AVIF) وتجنب `loading="lazy"` عليها واستخدم `fetchpriority="high"`.',
        'Compress & size LCP media accurately, remove lazy-loading on LCP elements, and eliminate render-blocking CSS delays.',
        'اضغط صورة LCP بالأبعاد المناسبة، أزل التحميل الكسول عنها، وقلل حجب العرض في `<head>`.',
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
          'In Elementor, avoid applying lazy load to top hero images and optimize large background images.',
          'في Elementor، تجنب تفعيل التحميل الكسول لصورة الواجهة الأولى واضغط صور الخلفية الكبيرة.',
          'Disable lazy-loading on the hero Image widget (`loading="eager"` / fetchpriority) and ensure hero background images are appropriately sized.',
          'أزل التحميل الكسول عن صورة الواجهة واضبط أبعاد صور الخلفية.',
        ),
        steps: [
          bi(
            'Check top section hero media size and lazy-load settings.',
            'راجع حجم صورة القسم العلوي وإعدادات التحميل الكسول لها.',
          ),
        ],
      },
      WP_PERF_CACHE_NOTE,
    ],
    verificationSteps: [
      step(
        1,
        'Confirm LCP image loads early without lazy delay and re-scan.',
        'تأكد من تحميل عنصر LCP مبكراً ثم أعد الفحص.',
        'Re-run browser audit and inspect LCP timing and candidate selector.',
        'أعد الفحص وتحقق من انخفاض LCP المعملي.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev Optimize LCP', url: 'https://web.dev/articles/optimize-lcp' }],
  },
  {
    recommendationId: 'rec-perf-lab-high-tbt',
    ruleIds: ['PERF_LAB_HIGH_TBT'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'mixed',
    problem: dual(
      'High Total Blocking Time (TBT) kept the browser main thread busy during loading.',
      'ارتفع زمن حجب الخيط الرئيسي (Total Blocking Time - TBT) أثناء تحميل الصفحة.',
      'Observed laboratory TBT exceeded threshold due to long JavaScript main-thread tasks.',
      'تجاوز مؤشر TBT المعملي الحد المعتمد نتيجة مهام JavaScript طويلة تعطل الاستجابة.',
    ),
    impact: dual(
      'Clicks, scrolling, and menus may feel sluggish or unresponsive right after the page appears.',
      'قد تتأخر استجابة الأزرار والقوائم والتمرير فور ظهور الصفحة.',
      'Correlates strongly with poor interaction responsiveness (INP risk) during startup.',
      'يرتبط مباشرة بضعف استجابة التفاعل أثناء بدء التحميل.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Browser lab trace observed excessive main-thread blocking duration (TBT).',
        'رصد تتبع المتصفح فترات حجب طويلة للخيط الرئيسي (TBT).',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Large JavaScript bundles, third-party trackers/chat widgets, or heavy hydration/animation scripts.',
        'قد ينتج عن حزم JS ضخمة أو سكربتات أطراف ثالثة (إعلانات/دردشة) أو سكربتات حركة ثقيلة.',
      ),
    ],
    locationGuidance: dual(
      'Large `<script>` resources and third-party tags loaded on the page.',
      'ملفات JavaScript الكبيرة والسكربتات الخارجية المحملة في الصفحة.',
      'Audit long tasks in DevTools Performance trace to isolate heaviest scripts.',
      'افحص المهام الطويلة لتحديد السكربتات الأكثر استهلاكاً للمعالج.',
    ),
    remediationSteps: [
      step(
        1,
        'Remove unused scripts/plugins, defer non-critical third-party widgets, and split heavy JS bundles.',
        'احذف السكربتات غير الضرورية وأجّل تحميل المكونات الثانوية وقسّم حزم JS الكبيرة.',
        'Defer/lazy-load non-essential third-party tags and break up long synchronous JS initialization tasks.',
        'أجّل السكربتات غير الحرجة وقسّم مهام التهيئة الطويلة.',
      ),
    ],
    platformGuidance: [WP_PERF_CACHE_NOTE],
    verificationSteps: [
      step(
        1,
        'Verify main-thread blocking time declines on re-scan.',
        'تحقق من انخفاض قيمة TBT عند إعادة الفحص.',
        'Re-run browser audit and verify improved laboratory TBT.',
        'أعد تشغيل الفحص وتحقق من انخفاض TBT.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [
      { label: 'web.dev Optimize Long Tasks', url: 'https://web.dev/articles/optimize-long-tasks' },
    ],
  },
  {
    recommendationId: 'rec-perf-bottleneck-diagnosis',
    ruleIds: ['PERF_BOTTLENECK_DIAGNOSIS'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'Automated bottleneck diagnosis identified a dominant performance limiting factor.',
      'حدد التشخيص الآلي عنق زجاجة رئيسياً يبطئ أداء الصفحة.',
      'Telemetry correlation isolated a primary bottleneck category from observed TTFB, asset, or main-thread data.',
      'استنتج التشخيص عاملاً رئيسياً مقيداً للأداء بناءً على قياسات TTFB والأصول والخيط الرئيسي.',
    ),
    impact: dual(
      'Focusing optimization on the primary bottleneck usually yields the largest speed improvement.',
      'معالجة عنق الزجاجة الأساسي تحقق أكبر تحسن فعلي في سرعة الموقع.',
      'Prioritizes engineering effort toward the highest-weight measured latency contributor.',
      'يوجه أولوية المعالجة نحو السبب الأكثر تأثيراً وفق القياس الفعلي.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Measured telemetry matched bottleneck classification rules (see exact bottleneck metrics in raw evidence).',
        'تطابقت القياسات مع قاعدة تصنيف الاختناق المذكورة في الأدلة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Secondary factors such as uncached cold requests or device variance may contribute.',
        'قد تسهم عوامل ثانوية مثل عدم وجود تخزين مؤقت لحظة القياس.',
      ),
    ],
    locationGuidance: dual(
      'Inspect the bottleneck category and contributing asset/timing details in preserved evidence.',
      'راجع نوع الاختناق وتفاصيل التوقيت أو المورد في الأدلة المحفوظة.',
      'Review `bottleneckType`, `primaryEvidence`, and metric breakdown in evidence.',
      'افحص حقول نوع الاختناق والمؤشرات في الأدلة الخام.',
    ),
    remediationSteps: [
      step(
        1,
        'Resolve the specific bottleneck flagged in evidence (server latency vs render-blocking resources vs large media vs JS blocking) first.',
        'ابدأ بمعالجة نوع الاختناق المحدد في الدليل (بطء الخادم أو حجب العرض أو الصور الضخمة أو سكربتات JS).',
        'Target remediation at the identified bottleneck subsystem and confirm secondary bottlenecks do not remain masked.',
        'ابدأ بإصلاح الجزء المحدد في التشخيص ثم أعد القياس لاكتشاف أي اختناق تالٍ.',
      ),
    ],
    platformGuidance: [WP_PERF_CACHE_NOTE, CDN_CACHE_HINT_NOTE],
    verificationSteps: [
      step(
        1,
        'Re-scan after addressing the top bottleneck to verify metric improvement.',
        'أعد الفحص بعد معالجة السبب الرئيسي للتحقق من تحسن الأداء.',
        'Verify bottleneck finding clears or drops in severity on subsequent audit.',
        'أعد الفحص وتأكد من زوال الاختناق أو انخفاض حدته.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev Web Vitals', url: 'https://web.dev/articles/vitals' }],
  },

  // --- Static HTML / Asset / Resource Performance (12) ---
  {
    recommendationId: 'rec-perf-large-html-document',
    ruleIds: ['PERF_LARGE_HTML_DOCUMENT'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The HTML document payload itself is unusually large.',
      'حجم ملف HTML الأساسي للصفحة كبير بشكل ملحوظ.',
      'Observed uncompressed/transferred HTML document size exceeded threshold.',
      'تجاوز حجم مستند HTML المرصود الحد الموصى به.',
    ),
    impact: dual(
      'Large HTML delays download, DOM parsing, and memory use before subresources even start rendering.',
      'كبر حجم HTML يبطئ التنزيل وبناء الشجرة DOM واستهلاك الذاكرة.',
      'Slows initial parse and increases TTFB/FCP transfer overhead.',
      'يبطئ التحليل الأولي للمستند ويزيد حجم النقل الأولي.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Document byte size exceeded scanner threshold.',
        'تجاوز حجم بايتات HTML حد الفحص المعتمد.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Large inline base64 images/SVGs, embedded JSON state blobs, or huge repeating menus/DOM sections.',
        'قد ينتج عن تضمين صور Base64 كبيرة أو بيانات JSON ضخمة أو قوائم/عناصر مكررة.',
      ),
    ],
    locationGuidance: dual(
      'Initial HTML response for the affected URL.',
      'مستند HTML الأساسي للرابط المتأثر.',
      'Inspect inline `<style>`, `<script>`, data URIs, and bloated DOM blocks inside document HTML.',
      'افحص الكتل المضمنة والصور المشفرة بـ base64 أو تكرار العناصر داخل HTML.',
    ),
    remediationSteps: [
      step(
        1,
        'Move large inline scripts/styles/SVGs/base64 assets to external cacheable files and trim redundant markup.',
        'انقل الأنماط والبيانات الكبيرة المضمنة إلى ملفات خارجية وقلص التكرار في البنية.',
        'Eliminate base64 `data:` images from HTML, trim unused DOM markup, and enable server HTTP compression.',
        'أزل الصور المضمنة base64 وبسّط بنية HTML مع ضمان تفعيل الضغط من الخادم.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Check HTML document size in DevTools Network and re-scan.',
        'تحقق من انخفاض حجم مستند HTML في أدوات المطور ثم أعد الفحص.',
        'Confirm HTML size drops below threshold and re-run audit.',
        'تأكد من انخفاض حجم HTML وأعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [
      {
        label: 'web.dev Reduce Network Payloads',
        url: 'https://web.dev/articles/total-byte-weight',
      },
    ],
  },
  {
    recommendationId: 'rec-perf-excessive-scripts-stylesheets',
    ruleIds: ['PERF_EXCESSIVE_SCRIPTS', 'PERF_EXCESSIVE_STYLESHEETS'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The page loads an excessive number of separate JavaScript or CSS files.',
      'تحمّل الصفحة عدداً مفرطاً من ملفات JavaScript أو CSS المنفصلة.',
      'Document triggers high request count for `<script>` or `<link rel="stylesheet">` assets.',
      'يحتوي المستند على عدد كبير من طلبات ملفات السكربتات أو الأنماط.',
    ),
    impact: dual(
      'Too many asset requests increase connection/scheduling overhead and CPU parsing work.',
      'كثرة الملفات تزيد عبء الشبكة وجدولة التحميل واستهلاك المعالج.',
      'Inflates main-thread parsing/evaluation and contention for critical rendering resources.',
      'يزيد زمن الجدولة والتحليل ويُبطئ إكمال مسار العرض.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Parsed page referenced more script/stylesheet resources than recommended limits.',
        'تضمنت الصفحة عدداً من ملفات JS أو CSS يتجاوز الحد المعتمد.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Multiple active plugins/widgets each enqueueing independent unbundled stylesheets or scripts globally.',
        'إضافات أو مكونات متعددة تضيف ملفاتها المنفردة في جميع الصفحات.',
      ),
    ],
    locationGuidance: dual(
      'Script and stylesheet tags in page `<head>` and footer.',
      'وسوم `<script>` و`<link rel="stylesheet">` في الصفحة.',
      'Inspect the loaded asset list in DevTools Network or evidence.',
      'راجع قائمة الملفات المحملة في الأدلة أو تبويب الشبكة.',
    ),
    remediationSteps: [
      step(
        1,
        'Remove unused libraries/plugins and avoid loading widget assets on pages where those widgets do not appear.',
        'أزل المكتبات غير المستخدمة وامنع تحميل أصول المكونات في الصفحات التي لا تحتاجها.',
        'Audit enqueued scripts/CSS, remove redundant bundles, and load route-specific assets conditionally.',
        'راجع الأصول المحملة واحذف المكرر أو غير المستخدم منها في المسارات التي لا تحتاجه.',
      ),
    ],
    platformGuidance: [WP_PERF_CACHE_NOTE],
    verificationSteps: [
      step(
        1,
        'Verify reduced script/CSS request counts and test interactive features, then re-scan.',
        'تحقق من انخفاض عدد ملفات JS/CSS مع سلامة التفاعل ثم أعد الفحص.',
        'Verify request counts drop without functional regressions and re-scan.',
        'تأكد من انخفاض عدد الملفات وسلامة الموقع ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev Fast Load Times', url: 'https://web.dev/explore/fast' }],
  },
  {
    recommendationId: 'rec-perf-img-dimensions-missing',
    ruleIds: ['PERF_IMG_DIMENSIONS_MISSING'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'One or more `<img>` tags do not specify explicit `width` and `height` attributes.',
      'تفتقد صورة أو أكثر سمات العرض والارتفاع الصريحة (`width` و`height`).',
      'HTML `<img>` elements omit `width` and/or `height` dimensions needed for aspect-ratio reservation.',
      'تفتقد عناصر `<img>` إلى سمات `width` و`height` اللازمة لحجز المساحة مسبقاً.',
    ),
    impact: dual(
      'Browsers do not know image dimensions until download, causing page text to jump suddenly (layout shift / CLS).',
      'يتحرك المحتوى فجأة عند اكتمال تحميل الصورة (إزاحة التخطيط CLS) لعدم حجز المساحة مسبقاً.',
      'Primary contributor to Cumulative Layout Shift (CLS).',
      'أحد الأسباب المباشرة لارتفاع إزاحة التخطيط (CLS).',
    ),
    confirmedCauseTemplates: [
      bi(
        'Static DOM audit observed `<img>` elements missing `width` or `height`.',
        'رصد فحص HTML عناصر `<img>` بدون سمات الأبعاد `width`/`height`.',
      ),
    ],
    locationGuidance: dual(
      'Affected `<img>` tags on the reported page URL.',
      'وسوم `<img>` المتأثرة في الصفحة المحددة.',
      'Inspect `img:not([width]):not([height])` elements in evidence or page source.',
      'افحص عناصر `<img>` التي تنقصها سمات الأبعاد.',
    ),
    remediationSteps: [
      step(
        1,
        'Add intrinsic `width` and `height` attributes matching the image aspect ratio alongside CSS responsive sizing (`max-width: 100%; height: auto;`).',
        'أضف `width` و`height` بالأبعاد الحقيقية للصورة مع قاعدة CSS (`max-width: 100%; height: auto;`).',
        'Declare explicit `width` and `height` attributes on `<img>` tags so CSS `aspect-ratio` reserves layout space before decode.',
        'أضف `width` و`height` في HTML لتخصيص المساحة تلقائياً قبل اكتمال التنزيل.',
      ),
    ],
    codeExamples: [
      {
        title: bi('Responsive image with intrinsic dimensions', 'مثال صورة متجاوبة بأبعاد صريحة'),
        language: 'html',
        scopeDisclaimer: bi(
          'Use the image natural width and height values.',
          'استخدم العرض والارتفاع الطبيعيين للصورة.',
        ),
        requiredEvidenceTag: 'media_asset',
        snippet:
          '<img src="hero.webp" width="1200" height="675" alt="Descriptive alt text" style="max-width: 100%; height: auto;" />',
      },
    ],
    verificationSteps: [
      step(
        1,
        'Inspect `<img>` markup for both `width` and `height` attributes and re-scan.',
        'تحقق من وجود `width` و`height` في وسوم الصور ثم أعد الفحص.',
        'Confirm images reserve layout height cleanly during throttled reload and re-scan.',
        'اختبر التحميل المتدرج وتأكد من وجود الأبعاد ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev Optimize CLS', url: 'https://web.dev/articles/optimize-cls' }],
  },
  {
    recommendationId: 'rec-perf-lcp-img-lazy-loaded',
    ruleIds: ['PERF_LCP_IMG_LAZY_LOADED'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The primary above-the-fold hero/LCP image is marked `loading="lazy"`, delaying its display.',
      'تم تعيين `loading="lazy"` على الصورة الرئيسية في أعلى الصفحة (LCP)، مما يؤخر ظهورها.',
      'Observed LCP candidate `<img>` includes `loading="lazy"`, deferring fetch priority until layout completes.',
      'تحمل صورة العنصر الأكبر (LCP) سمة `loading="lazy"` مما يؤخر جلبها عن أولوية العرض الأولى.',
    ),
    impact: dual(
      'Hurts Largest Contentful Paint (LCP) directly because the browser waits instead of loading the top image immediately.',
      'يبطئ مؤشر LCP مباشرة لأن المتصفح يؤخر طلب الصورة الأهم في الشاشة الأولى.',
      'Adds avoidable scheduling delay to LCP image fetch.',
      'يسبب تأخيراً غير مبرر في تحميل صورة LCP الحرجة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Browser telemetry matched LCP image element with `loading="lazy"`.',
        'رصد المتصفح وجود `loading="lazy"` على عنصر صورة LCP.',
      ),
    ],
    locationGuidance: dual(
      'The hero / above-the-fold LCP image element selector.',
      'محدد صورة الواجهة الرئيسية في أعلى الصفحة.',
      'Inspect the LCP `<img>` selector reported in evidence.',
      'راجع محدد عنصر `<img>` الخاص بـ LCP في الأدلة.',
    ),
    remediationSteps: [
      step(
        1,
        'Remove `loading="lazy"` from above-the-fold hero/LCP images and add `fetchpriority="high"`.',
        'أزل `loading="lazy"` من الصورة الرئيسية فوق الطية وأضف لها `fetchpriority="high"`.',
        'Set eager loading (omit `loading="lazy"`) and `fetchpriority="high"` on the hero image while keeping `loading="lazy"` only for below-the-fold images.',
        'اجعل تحميل صورة البطل فورياً (`fetchpriority="high"`) واحصر التحميل الكسول للصور السفلية فقط.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Inspect hero `<img>` attributes to verify `loading="lazy"` is removed and re-scan.',
        'تحقق من إزالة `loading="lazy"` من صورة البطل ثم أعد الفحص.',
        'Confirm eager load + `fetchpriority="high"` and verify improved LCP on re-scan.',
        'تأكد من التحميل الفوري وتحسن LCP عند إعادة الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [
      {
        label: 'web.dev Fetch Priority & Lazy Loading',
        url: 'https://web.dev/articles/fetch-priority',
      },
    ],
  },
  {
    recommendationId: 'rec-perf-res-large-js',
    ruleIds: ['PERF_RES_LARGE_JAVASCRIPT'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'One or more JavaScript files exceed recommended size thresholds.',
      'ملف JavaScript أو أكثر يتجاوز الحجم الموصى به.',
      'Observed JavaScript resource byte transfer/decoded size exceeds bundle threshold.',
      'تجاوز حجم مورد JavaScript المرصود الحد الموصى به.',
    ),
    impact: dual(
      'Large scripts take longer to download, parse, and execute—slowing mobile devices in particular.',
      'تستغرق السكربتات الضخمة وقتاً أطول في التنزيل والتحليل وتنفيذ المعالج خاصة على الجوال.',
      'Increases network transfer cost and browser main-thread parse/compile time.',
      'يزيد استهلاك الشبكة ووقت التحليل والتنفيذ في المتصفح.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Captured network resource metrics recorded oversized JavaScript file.',
        'سجلت قياسات الشبكة ملف JavaScript بحجم كبير.',
      ),
    ],
    locationGuidance: dual(
      'Resource URL listed in finding evidence.',
      'رابط ملف JavaScript المذكور في الأدلة.',
      'Inspect the reported script URL and its bundle contents.',
      'افحص رابط السكربت المذكور ومحتوياته لتقليل حجمه.',
    ),
    remediationSteps: [
      step(
        1,
        'Minify, compress (Brotli/Gzip), remove unused libraries/dead code, and code-split non-initial features.',
        'اضغط الملف (Minify + Brotli/Gzip) واحذف المكتبات غير المستخدمة وقسّم الأجزاء غير الحرجة.',
        'Enable tree-shaking/code-splitting, strip unused polyfills/dependencies, and serve minified compressed JS.',
        'فعّل التصغير والضغط وتقسيم الحزم وأزل المكتبات غير اللازمة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify reduced transferred/decoded script size in Network DevTools and re-scan.',
        'تحقق من انخفاض حجم الملف في تبويب الشبكة ثم أعد الفحص.',
        'Confirm script asset bytes fall below threshold and re-run audit.',
        'تأكد من انخفاض حجم السكربت ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [
      {
        label: 'web.dev Reduce JavaScript Payloads',
        url: 'https://web.dev/articles/reduce-javascript-payloads-with-code-splitting',
      },
    ],
  },
  {
    recommendationId: 'rec-perf-res-large-css',
    ruleIds: ['PERF_RES_LARGE_STYLESHEET'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'confirmed',
    problem: dual(
      'A CSS stylesheet file is overly large.',
      'ملف أنماط CSS يتجاوز الحجم المستحسن.',
      'Observed stylesheet resource byte size exceeded threshold.',
      'تجاوز حجم ملف CSS المرصود الحد المستحسن.',
    ),
    impact: dual(
      'Large stylesheets delay CSSOM construction and first paint.',
      'تؤخر ملفات CSS الكبيرة بناء شجرة التنسيق وأول رسم للصفحة.',
      'Increases render-blocking download/parse overhead before paint.',
      'يزيد عبء التحميل والتحليل قبل بدء عرض الصفحة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Captured resource telemetry measured oversized CSS payload.',
        'رصدت قياسات الموارد ملف CSS بحجم يتجاوز الحد المعتمد.',
      ),
    ],
    locationGuidance: dual(
      'Stylesheet URL reported in finding evidence.',
      'رابط ملف CSS المحدد في الأدلة.',
      'Inspect reported CSS asset URL and unused CSS coverage.',
      'افحص رابط ملف CSS ونسبة القواعد غير المستخدمة فيه.',
    ),
    remediationSteps: [
      step(
        1,
        'Purge unused CSS rules, minify output, and split non-critical page-only styles.',
        'أزل قواعد CSS غير المستخدمة واضغط الملف وافصل أنماط الصفحات الفرعية.',
        'Remove unused CSS frameworks/styles, minify, and serve compressed with Brotli/Gzip.',
        'احذف الأنماط غير المستعملة وفعّل التصغير والضغط على الخادم.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify stylesheet size drops in Network DevTools without visual breaks, then re-scan.',
        'تحقق من صغر حجم الملف مع سلامة التصميم ثم أعد الفحص.',
        'Confirm reduced stylesheet size across routes and re-run audit.',
        'تأكد من انخفاض الحجم وسلامة الواجهة ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev Minify CSS', url: 'https://web.dev/articles/minify-css' }],
  },
  {
    recommendationId: 'rec-perf-res-oversized-image',
    ruleIds: ['PERF_RES_OVERSIZED_IMAGE'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'An image asset has excessive file size (bytes) or unnecessarily huge pixel dimensions.',
      'توجد صورة بحجم ملف ضخم أو أبعاد بكسل أكبر بكثير من اللازم.',
      'Image asset transfer size exceeded recommended payload budget.',
      'تجاوز حجم تنزيل الصورة المحددة الحد المستحسن للأصول.',
    ),
    impact: dual(
      'Wastes visitor mobile data and significantly delays page & LCP loading.',
      'يستنزف باقة الزائر ويبطئ تحميل الصفحة وعنصر LCP.',
      'High network bandwidth consumption and slow image decode.',
      'يرفع استهلاك النطاق ويبطئ فك تشفير الصورة وعرضها.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Resource metrics observed image file bytes above limit.',
        'سجل الفحص تجاوز حجم بايتات الصورة للحد الموصى به.',
      ),
    ],
    locationGuidance: dual(
      'Image asset URL reported in finding evidence.',
      'رابط الصورة المذكور في الأدلة.',
      'Inspect the exact image URL, dimensions, and MIME format.',
      'افحص رابط الصورة وأبعادها وصيغتها الحالية.',
    ),
    remediationSteps: [
      step(
        1,
        'Resize the image to its display dimensions, compress it, and convert to modern WebP or AVIF.',
        'صغّر أبعاد الصورة لتناسب حجم العرض الفعلي واضغطها بصيغة WebP أو AVIF.',
        'Convert heavy JPEG/PNG images to WebP/AVIF and serve responsive `srcset` widths.',
        'حوّل الصور الثقيلة إلى WebP/AVIF مع توفير أبعاد متجاوبة عبر `srcset`.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify compressed image file weight in Network DevTools and re-scan.',
        'تحقق من انخفاض حجم الصورة في أدوات المطور ثم أعد الفحص.',
        'Confirm image bytes fall below budget without visual pixelation and re-scan.',
        'تأكد من تقليص حجم الصورة مع الحفاظ على وضوحها ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [
      {
        label: 'web.dev Serve Images in Modern Formats',
        url: 'https://web.dev/articles/uses-webp-images',
      },
    ],
  },
  {
    recommendationId: 'rec-perf-render-blocking',
    ruleIds: ['PERF_RES_RENDER_BLOCKING_CSS', 'PERF_RES_RENDER_BLOCKING_JS'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Render-blocking CSS or synchronous JavaScript in `<head>` pauses visual display until downloaded.',
      'تؤخر ملفات CSS أو سكربتات JavaScript المتزامنة في `<head>` عرض الصفحة حتى يكتمل تنزيلها.',
      'Head `<link rel="stylesheet">` or non-deferred `<script>` blocks initial browser paint.',
      'تمنع ملفات الأنماط أو السكربتات غير المؤجلة في `<head>` رسم الصفحة الأولي.',
    ),
    impact: dual(
      'Delays both First Contentful Paint (FCP) and Largest Contentful Paint (LCP).',
      'يؤخر كلاً من أول ظهور للمحتوى (FCP) والمحتوى الرئيسي (LCP).',
      'Stalls critical rendering path progression until round-trips complete.',
      'يعطل تقدم مسار العرض الحرج حتى انتهاء تنزيل وتنفيذ الموارد الحاجبة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Head resource audit observed render-blocking stylesheet or non-async/defer script.',
        'رصد الفحص مورداً حاجباً للعرض داخل `<head>`.',
      ),
    ],
    locationGuidance: dual(
      'Reported blocking CSS/JS asset URL inside `<head>`.',
      'رابط الملف الحاجب في `<head>` المذكور في الدليل.',
      'Inspect `<head>` placement and `defer`/`async`/`media` attributes of the reported URL.',
      'افحص موضع الملف وسمات `defer` أو `async` أو `media` في `<head>`.',
    ),
    remediationSteps: [
      step(
        1,
        'Add `defer` (or `async` for independent scripts) to non-critical `<script>` tags, and extract critical CSS or apply `media` attributes on print/conditional stylesheets.',
        'أضف `defer` أو `async` للسكربتات غير الحرجة، واستخرج CSS الأساسي لأعلى الصفحة أو خصص `media` للأنماط الشرطية.',
        'Defer non-critical JS (`<script defer>`), inline critical above-the-fold CSS cautiously, and defer non-critical CSS.',
        'أضف `defer` لسكربتات الرأس غير الأساسية وخفف حجم CSS الحاجب.',
      ),
    ],
    platformGuidance: [WP_PERF_CACHE_NOTE],
    verificationSteps: [
      step(
        1,
        'Verify scripts use `defer`/`async` cleanly without console errors and re-scan.',
        'تأكد من عمل الموقع بعد التأجيل بدون أخطاء Console ثم أعد الفحص.',
        'Verify critical-path improvement and zero JS ordering errors, then re-scan.',
        'تحقق من خلو الواجهة من أخطاء ترتيب السكربتات ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [
      {
        label: 'web.dev Eliminate Render-Blocking Resources',
        url: 'https://web.dev/articles/render-blocking-resources',
      },
    ],
  },
  {
    recommendationId: 'rec-perf-res-uncompressed-asset',
    ruleIds: ['PERF_RES_UNCOMPRESSED_ASSET'],
    category: 'static-performance',
    supportedPlatforms: ['generic', 'server_headers', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Text-based assets (HTML, CSS, JS, JSON, SVG) were served without HTTP compression (Gzip or Brotli).',
      'يتم إرسال ملفات نصية (HTML/CSS/JS/SVG) بدون تفعيل ضغط HTTP مثل Brotli أو Gzip.',
      'Compressible text response lacked `Content-Encoding: br` or `gzip` over significant byte size.',
      'استجابة نصية كبيرة الحجم لم تُضغط بـ `Content-Encoding: br` أو `gzip`.',
    ),
    impact: dual(
      'Downloads can be 3x–5x larger and slower than necessary.',
      'يزيد حجم التنزيل الفعلي بنحو 3 إلى 5 أضعاف بدون داعٍ.',
      'Directly increases network transit duration for text resources.',
      'يزيد زمن نقل البيانات للموارد النصية مباشرة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Response headers for a large text asset omitted `Content-Encoding: br` or `gzip`.',
        'ترويسة الاستجابة للمورد النصي لم تتضمن `Content-Encoding` مضغوطاً.',
      ),
    ],
    locationGuidance: dual(
      'Web server or CDN compression settings for the reported URL.',
      'إعدادات الضغط في خادم الويب أو طبقة CDN.',
      'Inspect `Content-Encoding` response header for the reported asset URL.',
      'افحص ترويسة `Content-Encoding` للمورد المحدد.',
    ),
    remediationSteps: [
      step(
        1,
        'Enable Brotli (`br`) with Gzip fallback for `text/html`, `text/css`, `application/javascript`, `application/json`, and `image/svg+xml`.',
        'فعّل ضغط Brotli (مع Gzip احتياطياً) لأنواع HTML وCSS وJS وJSON وSVG على الخادم أو الـ CDN.',
        'Configure server/CDN HTTP compression for text MIME types while excluding already-compressed binary formats (WOFF2/WebP/PNG).',
        'اضبط ضغط Brotli/Gzip للأنواع النصية فقط على الخادم أو طبقة الحافة.',
      ),
    ],
    platformGuidance: [CDN_CACHE_HINT_NOTE],
    verificationSteps: [
      step(
        1,
        'Check Network headers for `Content-Encoding: br` or `gzip` and re-scan.',
        'تحقق من ظهور `Content-Encoding: br` أو `gzip` في أدوات المطور ثم أعد الفحص.',
        'Confirm compressed response delivery and reduced transfer size, then re-scan.',
        'تأكد من استلام الملف مضغوطاً ثم أعد الفحص.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [
      {
        label: 'web.dev Enable Text Compression',
        url: 'https://web.dev/articles/uses-text-compression',
      },
    ],
  },

  // --- Layout Stability / CLS (3) ---
  {
    recommendationId: 'rec-layout-shift',
    ruleIds: ['LAYOUT_SHIFT_HIGH', 'LAYOUT_SHIFT_NEEDS_IMPROVEMENT', 'LAYOUT_INSTABILITY'],
    category: 'layout-stability',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'mixed',
    problem: dual(
      'Visible elements shifted unexpectedly while the page loaded (Cumulative Layout Shift / CLS).',
      'تحركت عناصر مرئية من مكانها فجأة أثناء تحميل الصفحة (عدم استقرار التخطيط CLS).',
      'Observed laboratory Cumulative Layout Shift (CLS) exceeded stability threshold during page load.',
      'تجاوز مؤشر إزاحة التخطيط التراكمية (CLS) الحد المستهدف أثناء التحميل المعملي.',
    ),
    impact: dual(
      'Visitors can accidentally tap the wrong button or lose their reading place as banners or images pop in.',
      'قد ينقر الزائر على زر خاطئ بالخطأ أو يفقد موضع القراءة عند قفز المحتوى.',
      'Degrades visual stability and Core Web Vitals CLS readiness.',
      'يضعف الاستقرار البصري وتجربة التفاعل.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Layout shift telemetry recorded non-zero unexpected element displacement.',
        'سجل مقياس إزاحة التخطيط تحركاً مفاجئاً للعناصر أثناء التحميل.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Images/embeds missing dimensions, late-loading ads/banners injected above existing content, or webfont swap reflow.',
        'صور بدون أبعاد محددة أو حقن إعلانات/شرائط علوية متأخرة أو تغير مقاس الخط عند التحميل.',
      ),
    ],
    locationGuidance: dual(
      'Inspect the shifted element selectors and shift timestamps in evidence.',
      'راجع محددات العناصر المتحركة في الأدلة.',
      'Review recorded layout shift source selectors in finding evidence.',
      'افحص قائمة العناصر المسببة للإزاحة في الأدلة.',
    ),
    remediationSteps: [
      step(
        1,
        'Reserve explicit `width`/`height` (or CSS `min-height` / `aspect-ratio`) on images, videos, embeds, and banner containers.',
        'احجز مساحة مسبقة عبر `width`/`height` أو `min-height` في CSS للصور والفيديو والشرائط العلوية.',
        'Reserve fixed aspect-ratio slots for media/embeds/ad containers and avoid inserting dynamic DOM banners above existing viewport content after paint.',
        'خصّص أبعاداً ثابتة للحاويات والصور وتجنب إدراج عناصر أعلى المحتوى بعد بدء الرسم.',
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
          'In Elementor, disable entrance animations on top hero sections and ensure header/menu height stays stable during font load.',
          'في Elementor، تجنب حركات الظهور المفاجئة في أعلى الصفحة واحفظ ارتفاع الترويسة ثابتاً أثناء تحميل الخطوط.',
          'Reserve height on sticky headers/sliders and avoid delayed JS-driven layout recalculations above the fold.',
          'احجز ارتفاعاً ثابتاً للقوائم العلوية والسلايدر وتجنب الحركات المؤجلة فوق الطية.',
        ),
        steps: [
          bi(
            'Set explicit dimensions on slider/carousel containers and hero images.',
            'حدّد أبعاداً صريحة لحاويات السلايدر والصور العلوية.',
          ),
        ],
      },
    ],
    verificationSteps: [
      step(
        1,
        'Reload the page on throttled network and verify content does not jump, then re-scan.',
        'أعد تحميل الصفحة وتأكد من ثبات العناصر بدون قفز ثم أعد الفحص.',
        'Re-run browser audit and confirm CLS returns below 0.1.',
        'أعد تشغيل الفحص للتحقق من انخفاض CLS دون 0.1.',
      ),
    ],
    limitations: [PERF_LAB_LIMITATION],
    references: [{ label: 'web.dev Optimize CLS', url: 'https://web.dev/articles/optimize-cls' }],
  },

  // --- Responsive Design (6) ---
  {
    recommendationId: 'rec-responsive-horizontal-and-element-overflow',
    ruleIds: [
      'RESPONSIVE_HORIZONTAL_OVERFLOW',
      'RESPONSIVE_ELEMENT_OVERFLOW',
      'RESPONSIVE_FIXED_WIDTH_CONTAINER',
    ],
    category: 'responsive-design',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Page content extends wider than the screen width, causing unwanted horizontal scrolling.',
      'يتمدد عرض عناصر الصفحة خارج حدود الشاشة، ما يسبب تمريرأ أفقياً مزعجاً.',
      'Browser viewport check measured `scrollWidth > clientWidth` or element bounding box extending past viewport right edge.',
      'أظهر فحص المتصفح أن عرض العنصر أو المستند يتجاوز عرض شاشة العرض المتاح.',
    ),
    impact: dual(
      'Mobile/tablet users must pan sideways or see clipped layouts.',
      'يضطر مستخدم الجوال إلى السحب يميناً ويساراً أو يرى الصفحة مقصوصة.',
      'Breaks mobile responsive usability across affected viewports.',
      'يُفسد التجاوب البصري وسهولة القراءة على الشاشات الصغيرة والمتوسطة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Viewport layout probe observed horizontal overflow and offending container selector(s).',
        'رصد فحص التجاوب تجاوزاً أفقياً ومحددات العناصر المتسببة فيه.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Fixed pixel `width` (instead of `max-width: 100%`), wide unscrolling tables, or negative margins.',
        'قد ينتج عن عرض ثابت بالبكسل بدلاً من `max-width: 100%` أو جداول عريضة أو هوامش سالبة.',
      ),
    ],
    locationGuidance: dual(
      'Inspect offending element selectors and affected viewport dimensions in evidence.',
      'راجع محددات العناصر المتجاوزة ومقاس الشاشة المسجل في الأدلة.',
      'Target the reported selector(s) at the flagged viewport width.',
      'افحص المحددات المبلغ عنها عند عرض الشاشة المذكور في الأدلة.',
    ),
    remediationSteps: [
      step(
        1,
        'Replace fixed pixel widths (`width: 600px`) with flexible rules (`width: 100%; max-width: 600px; box-sizing: border-box;`) and wrap wide tables in scrollable containers.',
        'استبدل العرض الثابت بـ `max-width: 100%` مع `box-sizing: border-box` وضع الجداول العريضة داخل حاوية قابلة للتمرير.',
        'Update reported CSS selectors to use fluid sizing (`max-width: 100%`, responsive flex/grid wrapping, and `overflow-x: auto` strictly on wide table wrappers rather than hiding page bugs with `body { overflow-x: hidden }`).',
        'عدّل قواعد CSS للمحددات المرصودة لتكون مرنة بدلاً من إخفاء المشكلة على `body`.',
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
          'In Elementor responsive mode, check custom desktop pixel widths/paddings/negative margins overridden on Mobile/Tablet.',
          'في وضع التجاوب داخل Elementor، راجع قيم العرض الثابتة والهوامش السالبة على الجوال والتابلت.',
          'Inspect responsive breakpoint overrides for desktop fixed widths or absolute-positioned elements overflowing mobile breakpoints.',
          'راجع إعدادات Breakpoints في Elementor للقيم الثابتة أو العناصر المطلقة التي تتجاوز شاشة الجوال.',
        ),
        steps: [
          bi(
            'Switch Elementor editor to Mobile/Tablet preview and reset excessive negative margins or fixed px widths.',
            'بدّل محرر Elementor لمعاينة الجوال وصفّر الهوامش السالبة أو العروض الثابتة.',
          ),
        ],
      },
    ],
    codeExamples: [
      {
        title: bi('Fluid container CSS pattern', 'مثال CSS لمنع تجاوز العرض'),
        language: 'css',
        scopeDisclaimer: bi(
          'Apply specifically to the reported overflowing selector rather than masking root overflow.',
          'طبّقه على العنصر المتجاوز نفسه لا لإخفاء الخلل الجذري.',
        ),
        requiredEvidenceTag: 'css_layout',
        snippet:
          '.target-container {\n  width: 100%;\n  max-width: 100%;\n  box-sizing: border-box;\n}',
      },
    ],
    verificationSteps: [
      step(
        1,
        'Test the exact flagged viewport width in DevTools Responsive mode and verify zero horizontal scrollbar, then re-scan.',
        'اختبر العرض عند المقاس نفسه في أدوات المطور وتأكد من اختفاء التمرير الأفقي ثم أعد الفحص.',
        'Verify `document.documentElement.scrollWidth <= window.innerWidth` on flagged viewports and re-scan.',
        'تأكد من تساوي عرض المستند مع الشاشة ثم أعد الفحص.',
      ),
    ],
    limitations: [RESPONSIVE_LIMITATION],
    references: [
      {
        label: 'web.dev Responsive Web Design Basics',
        url: 'https://web.dev/articles/responsive-web-design-basics',
      },
    ],
  },
  {
    recommendationId: 'rec-responsive-image-and-control-overflow',
    ruleIds: ['RESPONSIVE_IMAGE_OVERFLOW', 'RESPONSIVE_CONTROL_OVERFLOW'],
    category: 'responsive-design',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Images or interactive controls (buttons, inputs, menus) overflow or collide on smaller viewports.',
      'تتجاوز صور أو أزرار وحقول إدخال حدود حاويتها أو الشاشة على المقاسات الصغيرة.',
      'Rendered `<img>` or interactive control element exceeded container/viewport width at audited breakpoint.',
      'تجاوز عنصر `<img>` أو عنصر تحكم تفاعلي حدود حاويته في نقطة الفحص.',
    ),
    impact: dual(
      'Users on phones may see cropped buttons/images or struggle to tap interactive forms.',
      'تظهر الأزرار أو الصور مقصوصة على الهاتف ويصعب النقر أو الملء.',
      'Breaks mobile visual integrity and touch-target usability.',
      'يعيق التفاعل باللمس ويشوّه عرض الصور والنماذج على الجوال.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Responsive layout geometry inspection caught overflowing `<img>` or control selector.',
        'رصد الفحص الهندسي تجاوزاً لعنصر صورة أو تحكم.',
      ),
    ],
    locationGuidance: dual(
      'Reported `<img>` or form/button selector and viewport width.',
      'محدد الصورة أو الزر ومقاس الشاشة المسجل في الأدلة.',
      'Inspect CSS width/flex-shrink rules on the reported selector.',
      'افحص خصائص CSS للعرض والالتفاف على المحدد المرصود.',
    ),
    remediationSteps: [
      step(
        1,
        'Apply `max-width: 100%; height: auto;` to images and `max-width: 100%; min-width: 0;` on flex/grid inputs and buttons.',
        'أضف `max-width: 100%; height: auto;` للصور و`max-width: 100%; min-width: 0;` للحقول والأزرار.',
        'Ensure fluid max-width rules on media and interactive controls inside flex/grid items (`min-width: 0`, wrap flex rows where needed).',
        'اضبط `max-width: 100%` و`min-width: 0` لعناصر التحكم والصور داخل حاويات Flex/Grid.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Inspect buttons, forms, and images at mobile breakpoints and re-scan.',
        'تحقق من ظهور الأزرار والحقول والصور بالكامل على الجوال ثم أعد الفحص.',
        'Confirm element bounding rects fit within viewport bounds and re-scan.',
        'تأكد من احتواء العناصر داخل الشاشة ثم أعد الفحص.',
      ),
    ],
    limitations: [RESPONSIVE_LIMITATION],
    references: [
      {
        label: 'MDN CSS Box Sizing & Overflow',
        url: 'https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design',
      },
    ],
  },
  {
    recommendationId: 'rec-responsive-text-clipped',
    ruleIds: ['RESPONSIVE_TEXT_CLIPPED'],
    category: 'responsive-design',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'mixed',
    problem: dual(
      'Visible text is clipped or truncated inside a fixed box without wrapping cleanly.',
      'يُقتطع نص مرئي داخل حاوية ضيقة أو ثابتة الارتفاع دون التفاف أو إتاحة قراءته.',
      'Element text box measured scroll overflow clipped by `overflow: hidden` / fixed height or non-wrapping rules.',
      'رُصد نص مقصوص يتجاوز حدود عنصر مقيد بـ `overflow: hidden` أو ارتفاع ثابت أو منع الالتفاف.',
    ),
    impact: dual(
      'Words get cut off mid-sentence on narrower viewports, hiding key labels or prices.',
      'تنقطع الكلمات أو الأرقام في منتصفها على الشاشات الصغيرة.',
      'Loss of readable content and potential WCAG 1.4.4 / 1.4.10 reflow usability impact.',
      'يُفقد جزءاً من النص المقروء ويضر بالتوافق مع إعادة تدفق النصوص.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Viewport inspection detected clipped text element geometry.',
        'اكتشف فحص الشاشات عنصر نص مقصوص الأبعاد.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Long unbreakable tokens/URLs or intentional single-line ellipsis truncation vs unintended fixed-height cards.',
        'كلمات طويلة غير قابلة للالتفاف أو بطاقة بارتفاع ثابت يقص النص عند زيادة طوله.',
      ),
    ],
    locationGuidance: dual(
      'Selector of the clipped text container in finding evidence.',
      'محدد عنصر النص المقصوص المذكور في الأدلة.',
      'Check height, `white-space`, `overflow`, and `overflow-wrap` CSS on the reported selector.',
      'افحص خصائص الارتفاع و`overflow` و`white-space` و`overflow-wrap` على المحدد.',
    ),
    remediationSteps: [
      step(
        1,
        'Replace rigid `height` with `min-height`, remove unnecessary `white-space: nowrap`, and allow natural word wrapping (`overflow-wrap: break-word`).',
        'استبدل الارتفاع الثابت بـ `min-height` وأزل `white-space: nowrap` غير اللازمة واسمح بالتفاف الكلمات الطويلة.',
        'Use `min-height` instead of fixed `height` on text cards and enable `overflow-wrap: anywhere` / wrapping cleanly across breakpoints.',
        'استخدم `min-height` بدلاً من `height` ثابت وفعّل التفاف الكلمات الطويلة في CSS.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Inspect rendered text across mobile and tablet widths, then re-scan.',
        'تحقق من ظهور النص كاملاً في الشاشات الصغيرة ثم أعد الفحص.',
        'Confirm full text visibility without unintended clipping and re-scan.',
        'تأكد من اكتمال قراءة النص ثم أعد الفحص.',
      ),
    ],
    limitations: [RESPONSIVE_LIMITATION],
    references: [
      {
        label: 'W3C WCAG Reflow Understanding',
        url: 'https://www.w3.org/WAI/WCAG21/Understanding/reflow.html',
      },
    ],
  },
];
