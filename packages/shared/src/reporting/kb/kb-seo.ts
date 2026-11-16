import { bi, dual, step, type RecommendationEntry } from './types.js';

const SEO_LIMITATION = bi(
  'Observed via static HTML/header/sitemap inspection of crawled URLs; final search-engine indexing and ranking remain controlled by external crawlers and live rendering.',
  'تم التقييم من فحص HTML والترويسات وخرائط الموقع للروابط المزحوفة؛ قرار الفهرسة النهائي والترتيب يخضعان لمحركات البحث.',
);

function simpleSeoEntry(params: {
  id: string;
  ruleIds: readonly string[];
  category?: 'technical-seo' | 'content-structure' | 'accessibility';
  causeConfidence?: 'confirmed' | 'potential' | 'mixed';
  problemSimpleEn: string;
  problemSimpleAr: string;
  problemTechEn: string;
  problemTechAr: string;
  impactSimpleEn: string;
  impactSimpleAr: string;
  impactTechEn: string;
  impactTechAr: string;
  confirmedCauseEn: string;
  confirmedCauseAr: string;
  possibleCauseEn?: string;
  possibleCauseAr?: string;
  locationEn: string;
  locationAr: string;
  step1SimpleEn: string;
  step1SimpleAr: string;
  step1TechEn: string;
  step1TechAr: string;
  verifyEn: string;
  verifyAr: string;
  refLabel: string;
  refUrl: string;
  codeExamples?: RecommendationEntry['codeExamples'];
  platformGuidance?: RecommendationEntry['platformGuidance'];
}): RecommendationEntry {
  return {
    recommendationId: params.id,
    ruleIds: params.ruleIds,
    category: params.category ?? 'technical-seo',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'woocommerce'],
    causeConfidence: params.causeConfidence ?? 'confirmed',
    problem: dual(
      params.problemSimpleEn,
      params.problemSimpleAr,
      params.problemTechEn,
      params.problemTechAr,
    ),
    impact: dual(
      params.impactSimpleEn,
      params.impactSimpleAr,
      params.impactTechEn,
      params.impactTechAr,
    ),
    confirmedCauseTemplates: [bi(params.confirmedCauseEn, params.confirmedCauseAr)],
    possibleCauseTemplates:
      params.possibleCauseEn && params.possibleCauseAr
        ? [bi(params.possibleCauseEn, params.possibleCauseAr)]
        : [],
    locationGuidance: dual(
      params.locationEn,
      params.locationAr,
      params.locationEn,
      params.locationAr,
    ),
    remediationSteps: [
      step(1, params.step1SimpleEn, params.step1SimpleAr, params.step1TechEn, params.step1TechAr),
    ],
    ...(params.platformGuidance ? { platformGuidance: params.platformGuidance } : {}),
    ...(params.codeExamples ? { codeExamples: params.codeExamples } : {}),
    verificationSteps: [
      step(1, params.verifyEn, params.verifyAr, params.verifyEn, params.verifyAr),
    ],
    limitations: [SEO_LIMITATION],
    references: [{ label: params.refLabel, url: params.refUrl }],
  };
}

const WP_SEO_PLUGIN_NOTE = {
  platform: 'wordpress' as const,
  requiredEvidenceNote: bi(
    'Shown only because WordPress was detected in scan evidence.',
    'يظهر فقط لأن ووردبريس مكتشف في أدلة الفحص.',
  ),
  summary: dual(
    'Check your WordPress SEO plugin settings or theme head template if metadata is overwritten across pages.',
    'راجع إعدادات إضافة السيو أو قالب رأس الصفحة في ووردبريس إذا كان الإخراج يُولَّد آلياً.',
    'Inspect active WordPress SEO plugin output hooks (`wp_head`) and theme `header.php` to avoid conflicting tags.',
    'افحص مخرجات إضافة SEO وقالب `header.php` عبر خطاف `wp_head` لتجنب الوسوم المتعارضة.',
  ),
  steps: [
    bi(
      'Review the page SEO metabox or global title/meta template in WordPress without assuming a specific SEO plugin unless observed.',
      'راجع قالب العنوان والوصف العام أو إعدادات الصفحة في ووردبريس.',
    ),
  ],
};

export const SEO_KB_ENTRIES: readonly RecommendationEntry[] = [
  // --- On-page SEO & structure (13) ---
  simpleSeoEntry({
    id: 'rec-seo-title-missing',
    ruleIds: ['SEO_TITLE_MISSING'],
    problemSimpleEn: 'The page is missing a <title> tag or its title is empty.',
    problemSimpleAr: 'تفتقد الصفحة وسم العنوان <title> أو أن قيمته فارغة.',
    problemTechEn: 'Document `<head>` omits a non-empty `<title>` element.',
    problemTechAr: 'يفتقد قسم `<head>` عنصر `<title>` غير فارغ.',
    impactSimpleEn:
      'Search results and browser tabs cannot display a descriptive page name, reducing click clarity.',
    impactSimpleAr: 'لن تعرض محركات البحث وتبويبات المتصفح عنواناً وصفياً للصفحة.',
    impactTechEn:
      'Degrades search snippet relevance and document title accessibility identification.',
    impactTechAr: 'يؤثر سلباً في مقتطف البحث وفي تعريف عنوان المستند لقارئات الشاشة.',
    confirmedCauseEn: 'Static HTML inspection found no populated <title> element in <head>.',
    confirmedCauseAr: 'أظهر فحص HTML عدم وجود وسم <title> مملوء داخل <head>.',
    possibleCauseEn:
      'Theme template may omit `title-tag` support or custom head rendering cleared the title.',
    possibleCauseAr: 'قد يفتقد القالب دعم عنوان المستند أو يقوم قالب مخصص بحذفه.',
    locationEn: 'Document <head> -> <title> on the affected URL.',
    locationAr: 'داخل قسم <head> في وسم <title> للصفحة المتأثرة.',
    step1SimpleEn: 'Add a unique, descriptive <title> summarizing the page topic.',
    step1SimpleAr: 'أضف وسم <title> فريداً وواضحاً يلخص موضوع الصفحة.',
    step1TechEn:
      'Render a single unique `<title>` element inside `<head>` (typically 30–60 characters).',
    step1TechAr: 'أنشئ وسم `<title>` وحيداً وفريداً داخل `<head>` (غالباً بين 30 و60 حرفاً).',
    verifyEn: 'Inspect rendered `<head>` source for `<title>` and re-run the scan.',
    verifyAr: 'تحقق من وجود <title> في مصدر الصفحة ثم أعد الفحص.',
    refLabel: 'Google Title Links Guide',
    refUrl: 'https://developers.google.com/search/docs/appearance/title-link',
    codeExamples: [
      {
        title: bi('Document title example', 'مثال وسم العنوان'),
        language: 'html',
        scopeDisclaimer: bi(
          'Customize the text to match each unique page.',
          'خصّص النص ليعكس محتوى كل صفحة بدقة.',
        ),
        requiredEvidenceTag: 'html_meta_evidence',
        snippet: '<title>Services Overview | Example Brand</title>',
      },
    ],
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-title-length',
    ruleIds: ['SEO_TITLE_LENGTH'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'The page <title> length is outside optimal display bounds (too short or likely truncated in search results).',
    problemSimpleAr:
      'طول وسم <title> خارج النطاق المثالي (قصير جداً أو طويل قد يُقتطع في نتائج البحث).',
    problemTechEn:
      'Observed `<title>` character length falls outside configured lower/upper bounds.',
    problemTechAr: 'طول النص داخل `<title>` يتجاوز الحد الأعلى أو يقل عن الحد الأدنى الموصى به.',
    impactSimpleEn:
      'Very short titles convey little context; overly long titles get truncated on search result pages.',
    impactSimpleAr: 'العنوان القصير يفتقر للتوضيح والطويل يُقتطع في نتائج البحث.',
    impactTechEn: 'Reduces SERP snippet readability and keyword focus.',
    impactTechAr: 'يقلل وضوح العنوان المعروض في صفحات نتائج البحث.',
    confirmedCauseEn: 'Extracted `<title>` length crossed configured min/max character limits.',
    confirmedCauseAr: 'تجاوز طول `<title>` الفعلي الحدود المحددة للعرض.',
    locationEn: 'Document <head> -> <title> text.',
    locationAr: 'نص وسم <title> داخل <head>.',
    step1SimpleEn:
      'Adjust the page title to concise descriptive wording (roughly 30–60 characters) with primary keywords early.',
    step1SimpleAr:
      'عدّل طول العنوان ليكون واضحاً ومختصراً (حوالي 30–60 حرفاً) مع الكلمة الأساسية في البداية.',
    step1TechEn: 'Refine `<title>` copy to target ~30–60 characters without keyword stuffing.',
    step1TechAr: 'حسّن صياغة `<title>` لتكون ضمن ~30–60 حرفاً بدون حشو كلمات.',
    verifyEn: 'Confirm updated character count on staging and re-scan.',
    verifyAr: 'تحقق من طول العنوان بعد التعديل ثم أعد الفحص.',
    refLabel: 'Google Title Links',
    refUrl: 'https://developers.google.com/search/docs/appearance/title-link',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-description-missing',
    ruleIds: ['SEO_DESCRIPTION_MISSING'],
    problemSimpleEn: 'The page does not define a meta description tag.',
    problemSimpleAr: 'تفتقد الصفحة وسم الوصف التعريفي (meta description).',
    problemTechEn: 'Document `<head>` contains no non-empty `<meta name="description">`.',
    problemTechAr: 'قسم `<head>` لا يحتوي على وسم `<meta name="description">` غير فارغ.',
    impactSimpleEn:
      'Search engines will auto-generate a snippet from arbitrary page text instead of your intended summary.',
    impactSimpleAr: 'ستقتبس محركات البحث نصاً عشوائياً من الصفحة بدلاً من الوصف المخصص الذي تريده.',
    impactTechEn: 'Loss of snippet summary control on search result listings.',
    impactTechAr: 'فقدان التحكم في النص التلخيصي الظاهر في نتائج البحث.',
    confirmedCauseEn: 'Static HTML inspection found no `<meta name="description">` content.',
    confirmedCauseAr: 'أظهر فحص HTML غياب وسم `<meta name="description">`.',
    locationEn: 'Document <head> -> <meta name="description">.',
    locationAr: 'داخل <head> -> <meta name="description">.',
    step1SimpleEn:
      'Write a clear, accurate 1–2 sentence summary for this page in its meta description field.',
    step1SimpleAr: 'أضف ملخصاً واضحاً ودقيقاً من جملة أو جملتين في حقل الوصف التعريفي للصفحة.',
    step1TechEn:
      'Add `<meta name="description" content="...">` uniquely describing the page content (~70–155 characters).',
    step1TechAr: 'أضف `<meta name="description" content="...">` يصف الصفحة بدقة (~70–155 حرفاً).',
    verifyEn: 'Verify the meta description appears once in rendered HTML and re-scan.',
    verifyAr: 'تأكد من ظهور وسم الوصف مرة واحدة في HTML ثم أعد الفحص.',
    refLabel: 'Google Snippets & Meta Descriptions',
    refUrl: 'https://developers.google.com/search/docs/appearance/snippet',
    codeExamples: [
      {
        title: bi('Meta description tag example', 'مثال وسم الوصف التعريفي'),
        language: 'html',
        scopeDisclaimer: bi('Customize content text per page.', 'خصّص النص لكل صفحة.'),
        requiredEvidenceTag: 'html_meta_evidence',
        snippet:
          '<meta name="description" content="Concise summary of the page topic and offering." />',
      },
    ],
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-description-length',
    ruleIds: ['SEO_DESCRIPTION_LENGTH'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'The meta description is either too short to summarize the page or too long and likely to be truncated.',
    problemSimpleAr: 'الوصف التعريفي قصير جداً أو طويل بشكل يؤدي لاقتطاعه في نتائج البحث.',
    problemTechEn:
      'Observed `<meta name="description">` character length falls outside target snippet bounds.',
    problemTechAr: 'طول نص `<meta name="description">` خارج النطاق المثالي لعرض المقتطف.',
    impactSimpleEn: 'May reduce snippet clarity or lead search engines to rewrite the snippet.',
    impactSimpleAr: 'قد يقلل وضوح الوصف أو يدفع محرك البحث لاستبداله.',
    impactTechEn: 'Suboptimal SERP snippet completeness.',
    impactTechAr: 'اكتمال غير مثالي لمقتطف الصفحة في نتائج البحث.',
    confirmedCauseEn: 'Extracted meta description length fell below/above threshold.',
    confirmedCauseAr: 'تجاوز طول الوصف المستخرج الحد الأقصى أو قل عن الحد الأدنى.',
    locationEn: 'Document <head> -> <meta name="description">.',
    locationAr: 'داخل <head> -> <meta name="description">.',
    step1SimpleEn:
      'Rewrite the description into a natural 110–155 character summary covering key value cleanly.',
    step1SimpleAr: 'أعد صياغة الوصف ضمن 110–155 حرفاً تقريباً بأسلوب طبيعي ومباشر.',
    step1TechEn: 'Adjust `<meta name="description">` copy into recommended ~70–155 char range.',
    step1TechAr: 'اضبط طول `<meta name="description">` ضمن ~70–155 حرفاً.',
    verifyEn: 'Re-check page source length and re-run scan.',
    verifyAr: 'تحقق من طول الوصف المحدث ثم أعد الفحص.',
    refLabel: 'Google Meta Description Guidance',
    refUrl: 'https://developers.google.com/search/docs/appearance/snippet',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-h1-missing',
    ruleIds: ['SEO_H1_MISSING'],
    category: 'content-structure',
    problemSimpleEn: 'The page has no primary <h1> heading.',
    problemSimpleAr: 'تفتقد الصفحة إلى عنوان رئيسي أول <h1>.',
    problemTechEn: 'Document body contains zero `<h1>` elements.',
    problemTechAr: 'جسم المستند لا يحتوي على أي عنصر `<h1>`.',
    impactSimpleEn:
      'Visitors, screen readers, and search engines miss a clear main topic heading at the top of content.',
    impactSimpleAr:
      'يفتقد الزوار وقارئات الشاشة ومحركات البحث عنواناً رئيسياً واضحاً لموضوع الصفحة.',
    impactTechEn: 'Weakens semantic outline hierarchy and accessibility landmark navigation.',
    impactTechAr: 'يضعف البنية الدلالية للصفحة والتنقل عبر العناوين في التقنيات المساعدة.',
    confirmedCauseEn: 'HTML parser found zero <h1> tags on the page.',
    confirmedCauseAr: 'لم يعثر محلل HTML على أي وسم <h1> في الصفحة.',
    possibleCauseEn:
      'Main headline may be styled with `<h2>`, `<p>`, or `<div>` instead of semantic `<h1>`.',
    possibleCauseAr: 'قد يكون العنوان الرئيسي مصمماً بـ `<h2>` أو `<div>` بدلاً من `<h1>`.',
    locationEn: 'Main visible headline container of the page body.',
    locationAr: 'منطقة العنوان الرئيسي في محتوى الصفحة.',
    step1SimpleEn: 'Change the main page headline element to a single semantic <h1> tag.',
    step1SimpleAr: 'اجعل العنوان الرئيسي الوحيد للصفحة داخل وسم <h1> الدلالي.',
    step1TechEn:
      'Wrap the primary page title inside one `<h1>` element and avoid replacing it solely with styled `<div>`/`<span>`.',
    step1TechAr: 'ضع عنوان الصفحة الأساسي داخل عنصر `<h1>` واحد.',
    verifyEn: 'Inspect DOM headings order and re-run scan.',
    verifyAr: 'تحقق من وجود <h1> واحد في الصفحة ثم أعد الفحص.',
    refLabel: 'MDN Heading Elements',
    refUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements',
    platformGuidance: [
      {
        platform: 'elementor',
        requiredEvidenceNote: bi(
          'Shown only because Elementor was detected in scan evidence.',
          'يظهر فقط لأن Elementor مكتشف في أدلة الفحص.',
        ),
        summary: dual(
          'In Elementor Heading widget settings, set HTML Tag to H1 for the primary page title.',
          'في إعدادات ويدجت العنوان (Heading) في Elementor، اختر HTML Tag = H1 للعنوان الرئيسي.',
          'Edit the hero Heading widget -> Content -> HTML Tag -> select `H1`.',
          'عدّل مكون Heading الرئيسي واختر `H1` من قائمة HTML Tag.',
        ),
        steps: [
          bi(
            'Ensure only the hero/page title uses H1, while secondary titles use H2/H3.',
            'احرص على أن يكون H1 للعنوان الرئيسي فقط وبقية العناوين H2 أو H3.',
          ),
        ],
      },
    ],
  }),
  simpleSeoEntry({
    id: 'rec-seo-h1-multiple',
    ruleIds: ['SEO_H1_MULTIPLE'],
    category: 'content-structure',
    causeConfidence: 'mixed',
    problemSimpleEn: 'Multiple <h1> headings exist on the same page.',
    problemSimpleAr: 'يوجد أكثر من عنوان رئيسي <h1> في الصفحة نفسها.',
    problemTechEn: 'Document body contains more than one `<h1>` element.',
    problemTechAr: 'يحتوي جسم الصفحة على أكثر من عنصر `<h1>`.',
    impactSimpleEn:
      'Multiple top-level headings dilute semantic hierarchy and confuse outline navigation.',
    impactSimpleAr: 'تعدد وسوم H1 يربك التسلسل المنطقي للعناوين وقارئات الشاشة.',
    impactTechEn:
      'Fragments document outline clarity for assistive technology and automated content extractors.',
    impactTechAr: 'يشتت التسلسل الدلالي للمستند للتقنيات المساعدة ومحركات الفهرسة.',
    confirmedCauseEn: 'Multiple `<h1>` elements were found in parsed page DOM.',
    confirmedCauseAr: 'رُصد أكثر من عنصر `<h1>` في DOM الصفحة.',
    possibleCauseEn:
      'Header logo, mobile duplicate menu, or multiple sections may each wrap text in `<h1>`.',
    possibleCauseAr: 'قد يستخدم الشعار أو نسخة الهاتف أو عدة أقسام وسم <h1> بالتكرار.',
    locationEn: 'Headings inside header/logo and content sections of the affected page.',
    locationAr: 'العناوين في الترويسة أو أقسام الصفحة المتأثرة.',
    step1SimpleEn:
      'Keep one <h1> for the primary page headline and downgrade other large titles (e.g. logo or section headings) to <h2> or <span> with CSS styling.',
    step1SimpleAr: 'أبقِ على <h1> واحد للعنوان الرئيسي وحوّل البقية إلى <h2> أو نص منسق بـ CSS.',
    step1TechEn:
      'Retain one `<h1>` for the main page heading and convert secondary blocks to `<h2>`–`<h6>` or non-heading markup.',
    step1TechAr:
      'أبقِ عنصر `<h1>` واحداً فقط للعنوان الأساسي وحوّل العناوين الأخرى إلى `<h2>`–`<h6>`.',
    verifyEn: 'Verify `document.querySelectorAll("h1").length === 1` and re-scan.',
    verifyAr: 'تأكد من بقاء عنصر h1 واحد فقط في الصفحة ثم أعد الفحص.',
    refLabel: 'MDN Heading Usage',
    refUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements',
  }),
  simpleSeoEntry({
    id: 'rec-seo-heading-hierarchy-gap',
    ruleIds: ['SEO_HEADING_HIERARCHY_GAP'],
    category: 'content-structure',
    problemSimpleEn:
      'Heading levels skip sequentially (for example jumping from <h1> directly to <h4>).',
    problemSimpleAr: 'يوجد تخطٍ في تسلسل مستويات العناوين (مثل الانتقال من h1 إلى h4 مباشرة).',
    problemTechEn: 'Sequential DOM heading outline skips one or more heading levels.',
    problemTechAr: 'تسلسل مستويات `<h1>`–`<h6>` يتخطى مستوى وسيطاً واحداً أو أكثر.',
    impactSimpleEn: 'Screen-reader users navigating by heading levels experience confusing jumps.',
    impactSimpleAr: 'يعاني مستخدمو قارئات الشاشة من صعوبة فهم بنية الأقسام عند قفز المستويات.',
    impactTechEn: 'Breaks logical section nesting semantics (WCAG / HTML outline clarity).',
    impactTechAr: 'يُضعف البنية الهرمية المنطقية لأقسام المستند.',
    confirmedCauseEn: 'Heading extraction detected a skipped level transition (e.g., H1 -> H3).',
    confirmedCauseAr: 'اكتشف فحص العناوين انتقالاً متخطياً بين مستويات العناوين.',
    possibleCauseEn: 'Headings are often chosen for visual font size instead of hierarchy.',
    possibleCauseAr:
      'غالباً ما يتم اختيار رقم العنوان بناءً على حجم الخط بدلاً من الترتيب الدلالي.',
    locationEn: 'Heading elements inside the page body.',
    locationAr: 'عناصر العناوين في محتوى الصفحة.',
    step1SimpleEn:
      'Order headings sequentially (H1 -> H2 -> H3) and use CSS classes for visual font size.',
    step1SimpleAr: 'رتّب العناوين بالتسلسل المنطقي واستخدم CSS للتحكم بحجم الخط.',
    step1TechEn:
      'Fix skipped heading tags to preserve sequential hierarchy without breaking visual typography classes.',
    step1TechAr: 'صحّح أرقام وسوم العناوين لتسير بالتسلسل مع ضبط الشكل عبر CSS.',
    verifyEn: 'Check heading outline order in DevTools or accessibility tree and re-scan.',
    verifyAr: 'راجع شجرة العناوين وتأكد من التسلسل المتدرج ثم أعد الفحص.',
    refLabel: 'W3C WAI Headings Structure',
    refUrl: 'https://www.w3.org/WAI/tutorials/page-structure/headings/',
  }),
  simpleSeoEntry({
    id: 'rec-seo-img-alt-missing',
    ruleIds: ['SEO_IMG_ALT_MISSING'],
    problemSimpleEn: 'One or more images are missing an alt attribute.',
    problemSimpleAr: 'تفتقد صورة أو أكثر سمة النص البديل alt.',
    problemTechEn: 'Parsed `<img>` elements omit the `alt` attribute.',
    problemTechAr: 'تفتقد عناصر `<img>` المرصودة سمة `alt`.',
    impactSimpleEn:
      'Screen readers cannot describe informative images, and image search indexing loses context.',
    impactSimpleAr: 'لا تستطيع قارئات الشاشة وصف الصورة وتضعف دلالتها في محركات البحث.',
    impactTechEn: 'Impacts both WCAG non-text content accessibility and image SEO signals.',
    impactTechAr: 'يؤثر في إمكانية الوصول للصور وفي فهمها لمحركات البحث.',
    confirmedCauseEn: 'Static HTML audit found `<img>` tags without an `alt` attribute.',
    confirmedCauseAr: 'رصد الفحص وسوم `<img>` بدون سمة `alt`.',
    locationEn: 'Affected `<img>` elements on the reported page URL.',
    locationAr: 'عناصر `<img>` المتأثرة في الصفحة المحددة.',
    step1SimpleEn:
      'Add concise descriptive alt text for meaningful images, or `alt=""` for purely decorative images.',
    step1SimpleAr: 'أضف نصاً بديلاً وصفياً للصور المعلوماتية، أو `alt=""` للصور الزخرفية فقط.',
    step1TechEn:
      'Ensure every `<img>` includes meaningful `alt="..."` or explicit empty `alt=""` when decorative.',
    step1TechAr: 'تأكد من وجود `alt="..."` وصفي أو `alt=""` للصور الزخرفية في كل وسم صورة.',
    verifyEn: 'Confirm `img:not([alt])` returns zero matches and re-scan.',
    verifyAr: 'تحقق من خلو الصفحة من صور بدون `alt` ثم أعد الفحص.',
    refLabel: 'W3C Alt Text Decision Tree',
    refUrl: 'https://www.w3.org/WAI/tutorials/images/decision-tree/',
  }),
  simpleSeoEntry({
    id: 'rec-seo-lang-missing',
    ruleIds: ['SEO_LANG_MISSING'],
    problemSimpleEn: 'The <html> tag does not declare a page language (lang attribute).',
    problemSimpleAr: 'لا يعلن وسم <html> لغة الصفحة عبر سمة lang.',
    problemTechEn:
      'Root `<html>` element omits a valid `lang` attribute (e.g. `lang="en"` or `lang="ar"`).',
    problemTechAr: 'عنصر الجذر `<html>` يفتقد سمة `lang` صالحة.',
    impactSimpleEn:
      'Screen readers may pronounce text with the wrong language voice, and translation/localization tools lose clarity.',
    impactSimpleAr: 'قد تستخدم قارئات الشاشة نطقاً بلغة خاطئة وتضعف دقة التعرف على لغة الصفحة.',
    impactTechEn: 'Violates WCAG 3.1.1 Language of Page and weakens international SEO clarity.',
    impactTechAr: 'يخالف معيار WCAG 3.1.1 ويُضعف تحديد اللغة لمحركات البحث.',
    confirmedCauseEn: 'Root `<html>` element had no non-empty `lang` attribute.',
    confirmedCauseAr: 'كان وسم `<html>` خالياً من سمة `lang`.',
    locationEn: 'Root `<html>` element at top of HTML document.',
    locationAr: 'وسم `<html>` في أعلى مستند HTML.',
    step1SimpleEn:
      'Set the primary language attribute on the <html> element (e.g., lang="ar" or lang="en").',
    step1SimpleAr: 'حدّد سمة اللغة الأساسية في وسم <html> (مثل lang="ar" أو lang="en").',
    step1TechEn:
      'Add a valid BCP 47 language code to `<html lang="...">` matching the document language.',
    step1TechAr: 'أضف رمز لغة BCP 47 صالحاً إلى `<html lang="...">`.',
    verifyEn: 'Inspect root `<html>` tag in page source and re-scan.',
    verifyAr: 'تأكد من وجود سمة `lang` في وسم `<html>` ثم أعد الفحص.',
    refLabel: 'MDN HTML lang attribute',
    refUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang',
  }),
  simpleSeoEntry({
    id: 'rec-seo-opengraph-incomplete',
    ruleIds: ['SEO_OPENGRAPH_INCOMPLETE'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'Required Open Graph social-sharing meta tags (og:title, og:description, og:image, or og:url) are incomplete.',
    problemSimpleAr: 'وسوم المشاركة الاجتماعية Open Graph غير مكتملة.',
    problemTechEn:
      'Document `<head>` misses one or more standard Open Graph properties (`og:title`, `og:type`, `og:image`, `og:url`, `og:description`).',
    problemTechAr:
      'يفتقد `<head>` بعض خصائص Open Graph القياسية مثل `og:title` أو `og:image` أو `og:url`.',
    impactSimpleEn:
      'Links shared on social apps/messengers may appear without preview images or proper titles.',
    impactSimpleAr: 'عند مشاركة الرابط في وسائل التواصل قد يظهر بدون صورة أو بعنوان ناقص.',
    impactTechEn: 'Incomplete social card metadata reduces preview fidelity across link unfurlers.',
    impactTechAr: 'تقل جودة بطاقات المعاينة عند مشاركة الروابط في التطبيقات والمنصات.',
    confirmedCauseEn: 'HTML inspection found missing Open Graph meta property tags.',
    confirmedCauseAr: 'كشف الفحص غياب أحد وسوم Open Graph الأساسية.',
    locationEn: 'Document `<head>` Open Graph meta tags.',
    locationAr: 'وسوم Open Graph داخل `<head>`.',
    step1SimpleEn:
      'Populate og:title, og:description, og:type, og:url, and an absolute HTTPS og:image URL.',
    step1SimpleAr:
      'أكمل وسوم og:title وog:description وog:url مع رابط صورة og:image كامل عبر HTTPS.',
    step1TechEn:
      'Emit complete `<meta property="og:*">` tags with an accessible absolute HTTPS `og:image`.',
    step1TechAr:
      'أضف جميع وسوم `<meta property="og:*">` المطلوبة مع رابط `og:image` مطلق عبر HTTPS.',
    verifyEn: 'Inspect `<head>` OG tags and validate link preview, then re-scan.',
    verifyAr: 'راجع وسوم Open Graph في `<head>` ثم أعد الفحص.',
    refLabel: 'Open Graph Protocol',
    refUrl: 'https://ogp.me/',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-twitter-card-missing',
    ruleIds: ['SEO_TWITTER_CARD_MISSING'],
    causeConfidence: 'mixed',
    problemSimpleEn: 'Twitter/X Card meta tags (twitter:card) are missing.',
    problemSimpleAr: 'وسوم بطاقات Twitter/X (`twitter:card`) غير موجودة.',
    problemTechEn: 'Document `<head>` omits `<meta name="twitter:card">`.',
    problemTechAr: 'يفتقد `<head>` وسم `<meta name="twitter:card">`.',
    impactSimpleEn: 'Shared links on X/Twitter may not render large image summary cards.',
    impactSimpleAr: 'قد تظهر الروابط المشاركة على X بدون بطاقة معاينة غنية.',
    impactTechEn: 'Reduces rich card fallback determinism on X/Twitter parsers.',
    impactTechAr: 'يقلل تحكمك بشكل البطاقة عند المشاركة على X/Twitter.',
    confirmedCauseEn: 'No `twitter:card` meta tag was found in document `<head>`.',
    confirmedCauseAr: 'لم يُعثر على وسم `twitter:card` في `<head>`.',
    locationEn: 'Document `<head>` meta tags.',
    locationAr: 'وسوم meta داخل `<head>`.',
    step1SimpleEn:
      'Add `<meta name="twitter:card" content="summary_large_image">` alongside Open Graph metadata.',
    step1SimpleAr:
      'أضف وسم `<meta name="twitter:card" content="summary_large_image">` مع وسوم Open Graph.',
    step1TechEn:
      'Declare `twitter:card` (plus title/description/image or valid Open Graph fallbacks) in `<head>`.',
    step1TechAr: 'أضف `twitter:card` في `<head>` متكاملة مع Open Graph.',
    verifyEn: 'Confirm `meta[name="twitter:card"]` exists in rendered `<head>` and re-scan.',
    verifyAr: 'تأكد من وجود وسم `twitter:card` في `<head>` ثم أعد الفحص.',
    refLabel: 'X Developer Cards Markup',
    refUrl: 'https://developer.x.com/en/docs/twitter-for-websites/cards/overview/abouts-cards',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-viewport-missing',
    ruleIds: ['SEO_VIEWPORT_MISSING'],
    problemSimpleEn: 'The HTML <meta name="viewport"> tag is missing or invalid.',
    problemSimpleAr: 'وسم العرض المتجاوب `<meta name="viewport">` مفقود أو غير صالح.',
    problemTechEn:
      'Document `<head>` lacks `<meta name="viewport" content="width=device-width, initial-scale=1">`.',
    problemTechAr: 'يفتقد `<head>` وسم `<meta name="viewport">` بالضبط المتجاوب.',
    impactSimpleEn:
      'Mobile browsers render the page zoomed-out as a tiny desktop layout, hurting readability and mobile UX.',
    impactSimpleAr: 'تعرض هواتف الزوار الصفحة مصغرة كشاشة سطح مكتب، ما يضر القراءة وتجربة الجوال.',
    impactTechEn:
      'Prevents responsive CSS media queries from adapting cleanly on mobile viewports and affects mobile friendliness.',
    impactTechAr: 'يمنع عمل استعلامات CSS المتجاوبة بالعرض الفعلي للجهاز.',
    confirmedCauseEn: 'Static HTML head inspection found no valid viewport meta declaration.',
    confirmedCauseAr: 'لم يجد فحص `<head>` تعريف viewport متجاوباً صالحاً.',
    locationEn: 'Document `<head>`.',
    locationAr: 'داخل `<head>`.',
    step1SimpleEn:
      'Add `<meta name="viewport" content="width=device-width, initial-scale=1">` inside `<head>` without disabling zoom.',
    step1SimpleAr:
      'أضف `<meta name="viewport" content="width=device-width, initial-scale=1">` داخل `<head>` بدون منع التكبير.',
    step1TechEn:
      'Insert standard responsive viewport meta without `user-scalable=no` or restrictive `maximum-scale=1`.',
    step1TechAr: 'أضف وسم viewport القياسي مع تجنب تعطيل التكبير (`user-scalable=no`).',
    verifyEn: 'Check mobile emulation width and `<head>` viewport tag, then re-scan.',
    verifyAr: 'اختبر الصفحة على شاشة جوال وتأكد من وجود الوسم ثم أعد الفحص.',
    refLabel: 'MDN Viewport Meta Tag',
    refUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag',
    codeExamples: [
      {
        title: bi('Standard responsive viewport tag', 'وسم Viewport القياسي'),
        language: 'html',
        scopeDisclaimer: bi(
          'Avoid user-scalable=no for accessibility compliance.',
          'تجنب user-scalable=no للحفاظ على إمكانية الوصول.',
        ),
        requiredEvidenceTag: 'html_meta_evidence',
        snippet: '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      },
    ],
  }),
  simpleSeoEntry({
    id: 'rec-seo-broken-internal-link',
    ruleIds: ['SEO_BROKEN_INTERNAL_LINK'],
    problemSimpleEn:
      'An internal link points to a page on the site that returned a broken error response (e.g. 404).',
    problemSimpleAr: 'يوجد رابط داخلي يشير إلى صفحة تعيد خطأ (مثل 404 غير موجود).',
    problemTechEn: 'Crawled internal anchor `href` resolved to an HTTP 4xx/5xx error destination.',
    problemTechAr: 'رابط داخلي في الصفحة يؤدي إلى استجابة خطأ 4xx/5xx.',
    impactSimpleEn: 'Visitors hit dead-end error pages and search crawlers waste crawl budget.',
    impactSimpleAr: 'يصل الزوار إلى صفحات خطأ وتُهدر ميزانية الزحف في محركات البحث.',
    impactTechEn: 'Interrupts internal link equity flow and degrades user navigation reliability.',
    impactTechAr: 'يقطع تدفق الروابط الداخلية ويُضعف موثوقية التنقل.',
    confirmedCauseEn:
      'Cross-page link audit recorded an internal link target failing with an error status.',
    confirmedCauseAr: 'سجّل تدقيق الروابط الداخلية هدفاً يعيد حالة خطأ.',
    locationEn: 'Anchor link(s) on the source page pointing to the broken target URL.',
    locationAr: 'الروابط الداخلية في الصفحة المصدرية التي تشير إلى الوجهة المعطلة.',
    step1SimpleEn:
      'Update the link to the correct live URL, remove obsolete links, or set up a permanent 301 redirect if the URL moved.',
    step1SimpleAr:
      'صحّح الرابط إلى الوجهة السليمة، أو احذفه، أو أنشئ تحويل 301 دائم إذا نُقلت الصفحة.',
    step1TechEn:
      'Fix the source `href` directly to the canonical 200 URL (preferred) or configure a 301 redirect if the old slug remains linked externally.',
    step1TechAr: 'عدّل `href` المصدري مباشرة للرابط الصحيح (200) أو أضف تحويل 301 عند الحاجة.',
    verifyEn: 'Visit the source page, click the fixed link to confirm HTTP 200, and re-scan.',
    verifyAr: 'اختبر الرابط من الصفحة المصدرية وتأكد من رجوع HTTP 200 ثم أعد الفحص.',
    refLabel: 'Google HTTP Status Codes & Links',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors',
  }),

  // --- Canonicals (7) ---
  simpleSeoEntry({
    id: 'rec-seo-canonical-missing',
    ruleIds: ['SEO_CANONICAL_MISSING'],
    causeConfidence: 'mixed',
    problemSimpleEn: 'The page lacks a rel="canonical" link tag.',
    problemSimpleAr: 'تفتقد الصفحة وسم `rel="canonical"`.',
    problemTechEn:
      'Neither `<link rel="canonical">` in HTML `<head>` nor a canonical `Link` HTTP header was found.',
    problemTechAr: 'لم يُعثر على `<link rel="canonical">` في `<head>` ولا في ترويسة `Link` HTTP.',
    impactSimpleEn:
      'Query parameters or URL variations may cause search engines to treat identical content as duplicates.',
    impactSimpleAr: 'قد تعتبر محركات البحث تباينات الرابط (مثل المعاملات) صفحات مكررة.',
    impactTechEn: 'Reduces explicit canonical URL consolidation signals.',
    impactTechAr: 'يقلل وضوح تحديد النسخة المعتمدة للمحتوى أمام محركات البحث.',
    confirmedCauseEn: 'Canonical extractor found no canonical declaration on an indexable page.',
    confirmedCauseAr: 'لم يعثر الفحص على إعلان canonical في صفحة قابلة للفهرسة.',
    locationEn: 'Document `<head>` -> `<link rel="canonical" href="...">`.',
    locationAr: 'داخل `<head>` -> `<link rel="canonical">`.',
    step1SimpleEn:
      'Add a self-referencing canonical URL (or point to the preferred URL if duplicate).',
    step1SimpleAr: 'أضف رابطاً أساسياً (canonical) يشير إلى الرابط المعتمد للصفحة.',
    step1TechEn:
      'Emit a single absolute HTTPS `<link rel="canonical" href="...">` matching the preferred indexable URL.',
    step1TechAr: 'أضف `<link rel="canonical">` واحداً برابط مطلق عبر HTTPS يشير للعنوان المعتمد.',
    verifyEn: 'Inspect `<head>` for a single canonical URL and re-scan.',
    verifyAr: 'تحقق من وجود وسم canonical واحد صحيح ثم أعد الفحص.',
    refLabel: 'Google Canonical Consolidation',
    refUrl:
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-canonical-invalid',
    ruleIds: ['SEO_CANONICAL_INVALID'],
    problemSimpleEn:
      'The rel="canonical" tag is invalid (malformed, empty, multiple conflicting canonicals, or non-absolute URL).',
    problemSimpleAr: 'وسم `rel="canonical"` غير صالح (فارغ أو مشوه أو متعدد أو نسبي).',
    problemTechEn:
      'Observed canonical tag failed URL validation or appeared multiple times with conflicting values.',
    problemTechAr: 'فشل وسم canonical في التحقق من صحة الرابط أو ظهر بتعريفات متعددة متضاربة.',
    impactSimpleEn: 'Search engines will ignore invalid or conflicting canonical hints.',
    impactSimpleAr: 'تتجاهل محركات البحث تلميحات canonical الخاطئة أو المتعارضة.',
    impactTechEn: 'Invalidates canonicalization signals and risks duplicate-URL indexing.',
    impactTechAr: 'يبطل إشارة التوحيد القياسي للروابط.',
    confirmedCauseEn:
      'Canonical validator detected malformed syntax, missing href, or multiple declarations.',
    confirmedCauseAr: 'اكتشف مدقق الروابط الأساسية صياغة غير صالحة أو تعدد وسوم canonical.',
    locationEn: 'Document `<head>` `<link rel="canonical">` tags.',
    locationAr: 'وسوم `<link rel="canonical">` في `<head>`.',
    step1SimpleEn: 'Ensure there is only one valid, absolute HTTPS canonical link in `<head>`.',
    step1SimpleAr: 'احرص على وجود وسم canonical واحد فقط بصيغة رابط كامل ومطلق عبر HTTPS.',
    step1TechEn:
      'Remove duplicate canonical emitters (e.g. overlapping theme + plugin outputs) and supply one absolute URI.',
    step1TechAr: 'أزل أي تعدد بين القالب والإضافات وأبقِ وسم canonical واحداً برابط مطلق.',
    verifyEn:
      'Confirm `document.querySelectorAll("link[rel=canonical]").length === 1` with valid URL and re-scan.',
    verifyAr: 'تأكد من وجود وسم canonical واحد صالح ثم أعد الفحص.',
    refLabel: 'Google Canonical Rules',
    refUrl:
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
  simpleSeoEntry({
    id: 'rec-seo-canonical-mismatch',
    ruleIds: ['SEO_CANONICAL_MISMATCH'],
    causeConfidence: 'mixed',
    problemSimpleEn: 'The canonical tag points to a different URL than the page itself.',
    problemSimpleAr: 'يشير وسم canonical إلى رابط مختلف عن رابط الصفحة الحالية.',
    problemTechEn: 'Observed `rel="canonical"` target differs from the normalized current URL.',
    problemTechAr: 'هدف `rel="canonical"` يختلف عن الرابط الحالي للصفحة.',
    impactSimpleEn:
      'If unintended, search engines may exclude this page from search results in favor of the target URL.',
    impactSimpleAr:
      'إذا لم يكن ذلك مقصوداً، قد تستبعد محركات البحث هذه الصفحة من الفهرسة لصالح الرابط الآخر.',
    impactTechEn:
      'Signals search engines to consolidate indexing signals onto the specified canonical URL instead of this URL.',
    impactTechAr:
      'يوجه محركات البحث لنقل إشارات الفهرسة إلى الرابط المشار إليه بدلاً من الصفحة الحالية.',
    confirmedCauseEn: 'Canonical href differed from the crawled page URL.',
    confirmedCauseAr: 'اختلف رابط canonical عن رابط الصفحة المفحوصة.',
    possibleCauseEn:
      'Intentional when consolidating parameter/print/variant pages, or accidental due to wrong template settings.',
    possibleCauseAr: 'قد يكون مقصوداً لتوحيد صفحات المعاملات، أو خطأً في إعداد القالب.',
    locationEn: 'Document `<head>` `<link rel="canonical">`.',
    locationAr: 'وسم `<link rel="canonical">` داخل `<head>`.',
    step1SimpleEn:
      'Verify whether this page is supposed to be indexed on its own; if yes, change canonical to point to itself.',
    step1SimpleAr:
      'تأكد إن كان يُفترض فهرسة هذه الصفحة مستقلة؛ وإن كان كذلك فاجعل canonical يشير إليها نفسها.',
    step1TechEn:
      'Audit intentional consolidation vs misconfiguration; update to self-referencing canonical for standalone indexable pages.',
    step1TechAr: 'تحقق هل التوجيه مقصود أم خطأ، واجعله ذاتياً للصفحات المستقلة.',
    verifyEn: 'Verify canonical matches intended URL and re-scan.',
    verifyAr: 'تأكد من مطابقة canonical للرابط المقصود ثم أعد الفحص.',
    refLabel: 'Google Consolidate Duplicate URLs',
    refUrl:
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  }),
  simpleSeoEntry({
    id: 'rec-seo-canonical-out-of-scope',
    ruleIds: ['SEO_CANONICAL_OUT_OF_SCOPE'],
    causeConfidence: 'mixed',
    problemSimpleEn: 'The canonical tag points outside the audited domain or scan scope.',
    problemSimpleAr: 'يشير وسم canonical إلى نطاق خارجي خارج حدود الموقع المفحوص.',
    problemTechEn: 'Observed `rel="canonical"` target host falls outside the target origin scope.',
    problemTechAr: 'الهدف المشار إليه في `rel="canonical"` يقع خارج النطاق المستهدف.',
    impactSimpleEn:
      'Cross-domain canonicals tell search engines to index the external site instead of your page.',
    impactSimpleAr: 'يشير إلى محركات البحث بفهرسة النطاق الخارجي بدلاً من صفحتك.',
    impactTechEn:
      'Unless intentional syndication, cross-origin canonical tags forfeit local page indexing.',
    impactTechAr: 'ما لم يكن إعادة نشر مقصوداً، يفقد الصفحة فهرستها المحلية لصالح النطاق الآخر.',
    confirmedCauseEn: 'Canonical URL resolved to a host outside scope.',
    confirmedCauseAr: 'أشار رابط canonical إلى مضيف خارج النطاق المفحوص.',
    possibleCauseEn:
      'Commonly happens after staging-to-production migrations leaving old staging domain in canonicals.',
    possibleCauseAr: 'يحدث كثيراً بعد نقل الموقع من بيئة تجريبية دون تحديث النطاق في الإعدادات.',
    locationEn: '`<link rel="canonical">` on the affected page.',
    locationAr: '`<link rel="canonical">` في الصفحة المتأثرة.',
    step1SimpleEn:
      'Confirm no staging/development domain leaked into production canonical URLs, and update to your live domain.',
    step1SimpleAr: 'تأكد من عدم تسرب رابط بيئة تجريبية وصحّح الرابط إلى النطاق الفعلي للموقع.',
    step1TechEn:
      'Check WordPress `home`/`siteurl` or SEO base URL settings to eliminate stale staging or foreign hosts.',
    step1TechAr:
      'راجع إعدادات النطاق الأساسي في الموقع أو ووردبريس لإزالة أي نطاق تجريبي أو خارجي.',
    verifyEn: 'Confirm canonical points to your production domain and re-scan.',
    verifyAr: 'تحقق من إشارة canonical إلى النطاق الصحيح ثم أعد الفحص.',
    refLabel: 'Cross-domain Canonical Best Practices',
    refUrl:
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  }),
  simpleSeoEntry({
    id: 'rec-seo-canonical-chain',
    ruleIds: ['SEO_CANONICAL_CHAIN'],
    problemSimpleEn: 'Canonical tags form a multi-hop chain (Page A -> Page B -> Page C).',
    problemSimpleAr: 'وسوم canonical تشكّل سلسلة متتابعة (أ -> ب -> ج).',
    problemTechEn:
      'Page canonical target points to another page whose own canonical points onward.',
    problemTechAr: 'هدف canonical يشير إلى صفحة أخرى لديها canonical مختلف نحو وجهة ثالثة.',
    impactSimpleEn:
      'Search crawlers may stop following chained hints or choose the wrong canonical URL.',
    impactSimpleAr: 'قد تتجاهل محركات البحث السلسلة أو تختار رابطاً غير مقصود.',
    impactTechEn: 'Dilutes canonical signal strength across extra crawl hops.',
    impactTechAr: 'يُضعف دقة إشارة التوحيد القياسي عبر قفزات متعددة.',
    confirmedCauseEn: 'Cross-page canonical graph detected length >= 2 chain.',
    confirmedCauseAr: 'اكتشف رسم العلاقات سلسلة canonical متعددة الخطوات.',
    locationEn: 'Canonical tags across the chained source/intermediate URLs.',
    locationAr: 'وسوم canonical في الصفحات المشاركة في السلسلة.',
    step1SimpleEn:
      'Point all canonical tags directly to the final primary URL (with a self-referencing canonical on the final URL).',
    step1SimpleAr: 'وجّه كل وسوم canonical مباشرة نحو الرابط النهائي المعتمد.',
    step1TechEn:
      'Flatten canonical references so Page A points directly to final canonical Page C.',
    step1TechAr: 'اجعل كل صفحة تشير مباشرة إلى الرابط النهائي دون وسطاء.',
    verifyEn:
      'Confirm single-hop self-referencing or direct canonical targets across pages and re-scan.',
    verifyAr: 'تأكد من عدم وجود سلاسل canonical متداخلة ثم أعد الفحص.',
    refLabel: 'Google Canonical Consolidation',
    refUrl:
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  }),
  simpleSeoEntry({
    id: 'rec-seo-canonical-loop',
    ruleIds: ['SEO_CANONICAL_LOOP'],
    problemSimpleEn: 'Canonical tags point to each other in a cycle (Page A <-> Page B).',
    problemSimpleAr: 'توجد حلقة مفرغة بين وسوم canonical (صفحة أ <-> صفحة ب).',
    problemTechEn: 'Cross-page canonical graph detected a cyclic canonical reference loop.',
    problemTechAr: 'رُصدت حلقة دائرية مغلقة في مراجع canonical بين الصفحات.',
    impactSimpleEn:
      'Conflicting circular signals leave search engines guessing which page to index.',
    impactSimpleAr: 'التعارض الدائري يربك محركات البحث بشأن النسخة المعتمدة.',
    impactTechEn: 'Ambiguous indexing consolidation signal.',
    impactTechAr: 'إشارة متضاربة تفقد الثقة في التوجيه القياسي.',
    confirmedCauseEn: 'Canonical graph traversal hit a cycle between two or more URLs.',
    confirmedCauseAr: 'رصد الفحص دورة مغلقة عند تتبع روابط canonical.',
    locationEn: '`<link rel="canonical">` tags on the URLs in the loop.',
    locationAr: 'وسوم `<link rel="canonical">` في الصفحات المكونة للحلقة.',
    step1SimpleEn:
      'Choose one authoritative URL as self-canonical and point duplicates strictly to it.',
    step1SimpleAr: 'اختر رابطاً واحداً أصلياً يشير لنفسه ووجّه البقية إليه فقط.',
    step1TechEn:
      'Break the cycle by making one canonical winner self-referencing and aligning all alternates directly to it.',
    step1TechAr: 'اكسر الحلقة بجعل الرابط الأساسي يشير إلى نفسه وتوجيه النسخ الأخرى إليه مباشرة.',
    verifyEn: 'Verify non-cyclic canonical targets across affected URLs and re-scan.',
    verifyAr: 'تحقق من كسر الحلقة وتوحيد الاتجاه ثم أعد الفحص.',
    refLabel: 'Google Canonical Signals',
    refUrl:
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  }),
  simpleSeoEntry({
    id: 'rec-seo-canonical-target-broken',
    ruleIds: ['SEO_CANONICAL_TARGET_BROKEN'],
    problemSimpleEn:
      'The page canonical tag points to a URL that returns an error (4xx/5xx) or redirects unexpectedly.',
    problemSimpleAr: 'يشير وسم canonical إلى رابط معطل يعيد خطأ (4xx/5xx) أو تحويلاً غير صالح.',
    problemTechEn:
      'Observed `rel="canonical"` destination returned an error status or failed resolution.',
    problemTechAr: 'وجهة وسم `rel="canonical"` أرجعت حالة خطأ أو فشلت في التحميل.',
    impactSimpleEn:
      'Search engines disregard canonicals pointing to error pages and may drop the page or choose inconsistently.',
    impactSimpleAr: 'تتجاهل محركات البحث الإشارة لصفحة خطأ وقد تتأثر فهرسة الصفحة الأصلية.',
    impactTechEn: 'Broken canonical targets undermine duplicate consolidation and index stability.',
    impactTechAr: 'الروابط الأساسية المعطلة تفقد فاعلية توحيد الفهرسة.',
    confirmedCauseEn: 'Crawled status of the canonical target URL returned non-200 error state.',
    confirmedCauseAr: 'أرجع فحص وجهة الرابط الأساسي حالة خطأ غير سليمة.',
    locationEn: '`<link rel="canonical">` on source URL + destination target URL.',
    locationAr: 'وسم `<link rel="canonical">` والرابط الهدف.',
    step1SimpleEn: 'Update the canonical href to a working HTTP 200 destination URL.',
    step1SimpleAr: 'حدّث رابط canonical ليشير إلى صفحة صالحة تعمل برمز HTTP 200.',
    step1TechEn: 'Replace the broken canonical href with a reachable 200 OK canonical URL.',
    step1TechAr: 'استبدل رابط canonical المعطل برابط سليم يعيد 200 OK.',
    verifyEn: 'Verify the canonical URL loads HTTP 200 and re-scan.',
    verifyAr: 'تحقق من عمل الوجهة برمز 200 ثم أعد الفحص.',
    refLabel: 'Google Canonical Requirements',
    refUrl:
      'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  }),

  // --- Redirects (8) ---
  simpleSeoEntry({
    id: 'rec-seo-redirect-loop',
    ruleIds: ['SEO_REDIRECT_LOOP'],
    category: 'technical-seo',
    problemSimpleEn: 'A URL triggers an infinite redirect loop that never reaches a final page.',
    problemSimpleAr: 'يوجد مسار يسبب حلقة إعادة توجيه لا نهائية تمنع فتح الصفحة.',
    problemTechEn: 'HTTP redirect tracer detected a repeated URL cycle preventing resolution.',
    problemTechAr: 'اكتشف متتبع التحويلات دورة متكررة تمنع الوصول إلى صفحة نهائية.',
    impactSimpleEn: 'Visitors and crawlers cannot load the page at all ("Too many redirects").',
    impactSimpleAr: 'يتعذر على الزوار ومحركات البحث فتح الصفحة نهائياً.',
    impactTechEn: 'Causes complete availability failure and indexing loss on affected URLs.',
    impactTechAr: 'يسبب توقفاً كاملاً للوصول وفقدان الفهرسة.',
    confirmedCauseEn: 'Redirect chain revisited an earlier URL inside the same hop sequence.',
    confirmedCauseAr: 'عاد مسار التحويل إلى رابط سبقت زيارته في السلسلة نفسها.',
    possibleCauseEn:
      'Conflicting HTTPS/trailing-slash/www rewrite rules between CDN/proxy and origin server or plugins.',
    possibleCauseAr:
      'تعارض قواعد HTTPS أو الشرطة المائلة أو www بين البروكسي والخادم الأصلي أو الإضافات.',
    locationEn: 'Redirect rules in web server, CDN page rules, or CMS URL redirection settings.',
    locationAr: 'قواعد إعادة التوجيه في الخادم أو طبقة CDN أو إعدادات الموقع.',
    step1SimpleEn:
      'Inspect redirect rules for both URLs in the loop and remove conflicting redirects (especially HTTP<->HTTPS or trailing-slash clashes).',
    step1SimpleAr: 'راجع قواعد التحويل للروابط المتداخلة وأزل التعارض بين الخادم والـ CDN.',
    step1TechEn:
      'Trace HTTP `Location` headers hop-by-hop and resolve conflicting proxy/origin rewrite conditions.',
    step1TechAr: 'تتبع ترويسات `Location` خطوة بخطوة وأصلح قواعد إعادة الكتابة المتعارضة.',
    verifyEn: 'Confirm URL resolves cleanly with 0–1 redirects to HTTP 200 and re-scan.',
    verifyAr: 'تأكد من فتح الرابط مباشرة برمز 200 بدون تكرار تحويلات ثم أعد الفحص.',
    refLabel: 'MDN Redirections in HTTP',
    refUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections',
  }),
  simpleSeoEntry({
    id: 'rec-seo-redirect-chain',
    ruleIds: ['SEO_REDIRECT_CHAIN', 'SEO_REDIRECT_EXCESSIVE_HOPS'],
    problemSimpleEn:
      'URL redirects pass through multiple hops instead of jumping straight to the final destination.',
    problemSimpleAr:
      'يمر إعادة التوجيه بعدة قفزات متتالية بدلاً من الانتقال مباشرة إلى الرابط النهائي.',
    problemTechEn:
      'HTTP redirect chain required multiple intermediate 3xx hops before reaching destination status.',
    problemTechAr: 'تطلب مسار التحويل قفزات 3xx متعددة قبل الوصول إلى الوجهة النهائية.',
    impactSimpleEn:
      'Adds extra network round-trips that slow loading and waste search crawl budget.',
    impactSimpleAr: 'يضيف زمن انتظار إضافي للشبكة ويبطئ التحميل ويهدر ميزانية الزحف.',
    impactTechEn: 'Increases TTFB latency and risks crawler hop truncation on long chains.',
    impactTechAr: 'يزيد زمن الاستجابة الأولية ويُضعف كفاءة الزحف.',
    confirmedCauseEn: 'Redirect follower recorded 2+ sequential 3xx responses.',
    confirmedCauseAr: 'سجّل متتبع التحويلات استجابتين أو أكثر من فئة 3xx بالتتابع.',
    possibleCauseEn:
      'Stacked rules (HTTP->HTTPS + non-www->www + slug rename) fired one after another.',
    possibleCauseAr: 'تراكم قواعد متتابعة مثل تحويل البروتوكول ثم النطاق ثم المسار.',
    locationEn: 'Source URL and intermediate redirect rules on server/CDN.',
    locationAr: 'الرابط المصدري وقواعد التحويل الوسيطة في الخادم أو الـ CDN.',
    step1SimpleEn: 'Point the original URL directly (single hop) to the final canonical URL.',
    step1SimpleAr: 'اجعل الرابط الأول يحوّل مباشرة بخطوة واحدة إلى الرابط النهائي المعتمد.',
    step1TechEn:
      'Collapse multi-hop 3xx rules into a single direct 301 redirect to the canonical final URL.',
    step1TechAr: 'ادمج قواعد 3xx المتعددة في تحويل 301 مباشر واحد إلى الوجهة النهائية.',
    verifyEn: 'Verify at most 1 hop to HTTP 200 and re-scan.',
    verifyAr: 'تحقق من الوصول للرابط النهائي في خطوة واحدة كحد أقصى ثم أعد الفحص.',
    refLabel: 'Google Redirects & Search',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
  }),
  simpleSeoEntry({
    id: 'rec-seo-redirect-broken-destination',
    ruleIds: ['SEO_REDIRECT_BROKEN_DESTINATION'],
    problemSimpleEn:
      'A redirect sends visitors to a broken final destination URL (4xx or 5xx error).',
    problemSimpleAr: 'يوجه التحويل الزوار إلى صفحة نهائية معطلة تعيد خطأ (4xx أو 5xx).',
    problemTechEn: 'Final hop in an observed 3xx chain resolved to an HTTP error response.',
    problemTechAr: 'انتهى مسار التحويل برمز خطأ HTTP 4xx أو 5xx.',
    impactSimpleEn: 'Both old links and visitors following the redirect land on an error page.',
    impactSimpleAr: 'ينتهي المستخدمون ومحركات البحث في صفحة خطأ رغم وجود تحويل.',
    impactTechEn: 'Breaks user journeys and wastes link equity.',
    impactTechAr: 'يعطل تجربة الزائر ويهدر قوة الروابط المحولة.',
    confirmedCauseEn: 'Final target URL after redirects returned 4xx/5xx.',
    confirmedCauseAr: 'أعادت الوجهة النهائية للتحويل رمز خطأ 4xx/5xx.',
    locationEn: 'Redirect rule target configuration for the source URL.',
    locationAr: 'إعداد وجهة قاعدة التحويل للرابط المصدري.',
    step1SimpleEn: 'Update the redirect target to a valid live HTTP 200 URL.',
    step1SimpleAr: 'عدّل وجهة التحويل لتشير إلى صفحة حية تعمل برمز 200.',
    step1TechEn: 'Point the 301/302 Location target to a healthy 200 OK replacement page.',
    step1TechAr: 'حدّث هدف `Location` في التحويل إلى مسار سليم يعيد 200 OK.',
    verifyEn: 'Confirm redirect ends at HTTP 200 and re-scan.',
    verifyAr: 'تأكد من انتهاء التحويل برمز 200 ثم أعد الفحص.',
    refLabel: 'MDN Redirections',
    refUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections',
  }),
  simpleSeoEntry({
    id: 'rec-seo-redirect-http-to-https',
    ruleIds: ['SEO_REDIRECT_HTTP_TO_HTTPS'],
    problemSimpleEn:
      'Plain HTTP requests do not cleanly redirect to HTTPS (or redirect across mismatched paths).',
    problemSimpleAr: 'طلبات HTTP غير المشفرة لا تحوّل بشكل نظيف إلى HTTPS.',
    problemTechEn: 'Audited HTTP variant failed direct canonical 301 upgrade to HTTPS.',
    problemTechAr: 'نسخة HTTP لم تحوّل بشكل مباشر 301 إلى HTTPS المطابق.',
    impactSimpleEn:
      'Visitors typing the domain manually may connect unencrypted or split HTTP/HTTPS SEO signals.',
    impactSimpleAr: 'قد يتصفح المستخدمون نسخة غير مشفرة أو تتشتت إشارات الأرشفة بين HTTP وHTTPS.',
    impactTechEn: 'Leaves plaintext entrypoints exposed before TLS enforcement.',
    impactTechAr: 'يترك نقاط دخول غير مشفرة قبل التوجيه لـ HTTPS.',
    confirmedCauseEn:
      'HTTP probe did not cleanly redirect directly to the HTTPS canonical equivalent.',
    confirmedCauseAr: 'لم يعِد فحص HTTP تحويلاً مباشراً إلى النسخة الآمنة HTTPS.',
    locationEn: 'Server/CDN HTTP (port 80) virtual host or edge "Always Use HTTPS" rule.',
    locationAr: 'إعدادات HTTP (المنفذ 80) في الخادم أو خيار Always Use HTTPS في الـ CDN.',
    step1SimpleEn:
      'Enable an immediate 301 redirect from HTTP to HTTPS preserving path and query parameters.',
    step1SimpleAr: 'فعّل تحويلاً دائماً 301 من HTTP إلى HTTPS مع الحفاظ على المسار.',
    step1TechEn:
      'Configure a permanent 301 HTTP->HTTPS redirect to the exact canonical host and path.',
    step1TechAr: 'اضبط تحويل 301 دائم من HTTP إلى HTTPS لنفس النطاق والمسار المعتمد.',
    verifyEn: 'Verify `http://...` immediately 301-redirects to `https://...` and re-scan.',
    verifyAr: 'تحقق من التحويل الفوري 301 من http إلى https ثم أعد الفحص.',
    refLabel: 'web.dev Redirect HTTP to HTTPS',
    refUrl: 'https://web.dev/articles/why-https-matters',
  }),
  simpleSeoEntry({
    id: 'rec-seo-redirect-internal-link-to-redirect',
    ruleIds: ['SEO_REDIRECT_INTERNAL_LINK_TO_REDIRECT'],
    problemSimpleEn:
      'Internal links point to old/redirecting URLs instead of directly linking to the final page.',
    problemSimpleAr:
      'تحتوي الصفحة على روابط داخلية تشير إلى مسارات محوَّلة بدلاً من الرابط النهائي مباشرة.',
    problemTechEn:
      'Internal `<a href>` link points to a URL returning HTTP 3xx rather than the final 200 canonical URL.',
    problemTechAr: 'رابط `<a href>` داخلي يشير إلى عنوان يعيد 3xx بدلاً من الوجهة النهائية 200.',
    impactSimpleEn: 'Every click adds an unnecessary redirect delay for users and crawlers.',
    impactSimpleAr: 'يضيف كل نقر انتظاراً إضافياً غير ضروري للزائر والزاحف.',
    impactTechEn: 'Unnecessary round-trip latency during internal navigation.',
    impactTechAr: 'زمن تحميل إضافي دون داعٍ أثناء التنقل الداخلي.',
    confirmedCauseEn: 'Crawl graph observed internal link destination returning 3xx redirect.',
    confirmedCauseAr: 'رصد الزحف استجابة 3xx عند تتبع رابط داخلي.',
    locationEn: 'Menu, footer, or content anchor tags on affected source page(s).',
    locationAr: 'الروابط داخل القوائم أو التذييل أو المحتوى في الصفحات المصدرية.',
    step1SimpleEn: 'Update internal links to point directly to the final destination URL.',
    step1SimpleAr: 'حدّث الروابط الداخلية لتشير مباشرة إلى الرابط النهائي السليم.',
    step1TechEn: 'Replace redirecting internal `href` values with the final canonical 200 URL.',
    step1TechAr: 'استبدل روابط `href` الداخلية بالرابط النهائي المباشر الذي يعيد 200.',
    verifyEn: 'Confirm clicked internal links return HTTP 200 directly and re-scan.',
    verifyAr: 'تأكد من استجابة الروابط الداخلية مباشرة برمز 200 ثم أعد الفحص.',
    refLabel: 'Google Site Structure & Links',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
  }),
  simpleSeoEntry({
    id: 'rec-seo-redirect-temporary-for-permanent',
    ruleIds: ['SEO_REDIRECT_TEMPORARY_FOR_PERMANENT'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'A redirect uses temporary status (302/307) where a permanent 301/308 redirect may be intended.',
    problemSimpleAr:
      'يستخدم التحويل رمزاً مؤقتاً (302/307) في موضع قد يتطلب تحويلاً دائماً (301/308).',
    problemTechEn:
      'Observed permanent-looking canonical or HTTPS/domain redirect returned HTTP 302/307 instead of 301/308.',
    problemTechAr: 'أعاد التحويل رمزاً مؤقتاً 302 أو 307 في مسار يبدو هيكلياً أو دائماً.',
    impactSimpleEn:
      'Search engines keep the old URL indexed longer because temporary status signals the move is short-term.',
    impactSimpleAr: 'قد تبقي محركات البحث الرابط القديم مفهرساً لاعتباره انتقالاً مؤقتاً.',
    impactTechEn: 'Delays canonical consolidation if move is permanent.',
    impactTechAr: 'يؤخر نقل الإشارات والترتيب إلى الوجهة الجديدة إن كان الانتقال دائماً.',
    confirmedCauseEn: 'Redirect returned 302/307 on structural/permanent route transition.',
    confirmedCauseAr: 'أعاد التحويل رمز 302 أو 307 في مسار هيكلي.',
    possibleCauseEn:
      'Intentional only for temporary maintenance, A/B tests, or geo/device routing.',
    possibleCauseAr: 'يكون مقصوداً فقط للصيانة المؤقتة أو اختبارات العرض أو التوجيه الجغرافي.',
    locationEn: 'Redirect rule configuration on server/CDN/CMS.',
    locationAr: 'إعدادات قاعدة التحويل على الخادم أو الـ CDN أو النظام.',
    step1SimpleEn:
      'If the URL move is permanent, change the redirect code to 301 (or 308); otherwise keep 302/307 if truly temporary.',
    step1SimpleAr:
      'إذا كان النقل دائماً فحوّله إلى 301 (أو 308)، وأبقه مؤقتاً فقط إذا كان لغرض مؤقت فعلاً.',
    step1TechEn:
      'Confirm intent: switch permanent URL/protocol/host migrations to 301/308; leave 302/307 for genuinely transient routes.',
    step1TechAr: 'حوّل عمليات النقل الدائمة إلى 301/308، واحتفظ بـ 302/307 للحالات المؤقتة فقط.',
    verifyEn: 'Confirm HTTP status code matches intent and re-scan.',
    verifyAr: 'تأكد من تطابق رمز التحويل مع الغرض المقصود ثم أعد الفحص.',
    refLabel: 'Google 301 vs 302 Redirects',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
  }),
  simpleSeoEntry({
    id: 'rec-seo-redirect-trailing-slash',
    ruleIds: ['SEO_REDIRECT_TRAILING_SLASH'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'Trailing-slash vs non-trailing-slash URLs behave inconsistently or trigger avoidable redirects.',
    problemSimpleAr:
      'يوجد عدم اتساق أو تحويلات غير ضرورية بسبب وجود الشرطة المائلة `/` في نهاية الرابط أو غيابها.',
    problemTechEn:
      'Trailing-slash normalization mismatch detected between linked/probed URL variants.',
    problemTechAr: 'تباين في توحيد الشرطة المائلة `/` بين صيغ الرابط المفحوصة.',
    impactSimpleEn: 'Inconsistent URLs can create duplicate cache entries or extra redirect hops.',
    impactSimpleAr: 'يسبب تكراراً في التخزين المؤقت أو قفزات إعادة توجيه إضافية.',
    impactTechEn: 'Minor crawl efficiency and canonical consistency degradation.',
    impactTechAr: 'يقلل كفاءة الزحف واتساق الروابط الأساسية.',
    confirmedCauseEn:
      'Probing trailing-slash variant triggered extra redirect or divergent handling.',
    confirmedCauseAr: 'تسبب اختبار صيغة الشرطة المائلة في تحويل أو استجابة غير موحدة.',
    locationEn: 'CMS permalink style, internal links, sitemap URLs, and server rewrite rules.',
    locationAr: 'إعدادات الروابط الدائمة والروابط الداخلية وخريطة الموقع وقواعد الخادم.',
    step1SimpleEn:
      'Pick one convention (either with trailing `/` or without) consistently across links, canonicals, sitemaps, and redirects.',
    step1SimpleAr:
      'اختر أسلوباً واحداً (بشرطة مائلة `/` أو بدونها) ووحّده في الروابط وcanonical وsitemap.',
    step1TechEn:
      'Align internal anchors, `rel="canonical"`, `sitemap.xml`, and rewrite rules on one trailing-slash standard.',
    step1TechAr:
      'وحّد جميع الروابط الداخلية ووسوم canonical وخريطة الموقع على أسلوب واحد للشرطة المائلة.',
    verifyEn: 'Verify consistent resolution without redirect chains and re-scan.',
    verifyAr: 'تأكد من اتساق الروابط دون قفزات إضافية ثم أعد الفحص.',
    refLabel: 'Google URL Structure',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/url-structure',
  }),

  // --- Robots (7) ---
  simpleSeoEntry({
    id: 'rec-seo-robots-missing',
    ruleIds: ['SEO_ROBOTS_MISSING'],
    causeConfidence: 'mixed',
    problemSimpleEn: 'No accessible `/robots.txt` file was found at the site root.',
    problemSimpleAr: 'ملف `/robots.txt` غير موجود أو لا يعيد استجابة صالحة في جذر الموقع.',
    problemTechEn: 'GET `/robots.txt` did not return HTTP 200 plain-text crawler directives.',
    problemTechAr: 'طلب `/robots.txt` لم يرجع ملف توجيهات نصياً صالحاً برمز 200.',
    impactSimpleEn:
      'Search crawlers lose explicit sitemap discovery and crawl boundary instructions.',
    impactSimpleAr: 'تفقد محركات البحث توجيهات المسارات المستثناة وموقع خريطة الموقع sitemap.',
    impactTechEn: 'Missing standard `/robots.txt` reduces crawl control clarity.',
    impactTechAr: 'غياب `/robots.txt` يقلل وضوح التحكم في مسارات الزحف.',
    confirmedCauseEn: 'Origin returned non-200 status (e.g. 404) for `/robots.txt`.',
    confirmedCauseAr: 'أرجع الخادم حالة خطأ عند طلب `/robots.txt`.',
    locationEn: 'Root URL `/robots.txt`.',
    locationAr: 'المسار الجذري `/robots.txt`.',
    step1SimpleEn:
      'Publish a valid `/robots.txt` file permitting public pages and pointing to your XML sitemap.',
    step1SimpleAr: 'أنشئ ملف `/robots.txt` صالحاً يسمح بزحف الصفحات العامة ويشير إلى رابط Sitemap.',
    step1TechEn:
      'Serve valid UTF-8 `text/plain` `/robots.txt` with explicit `User-agent: *` and `Sitemap:` directives.',
    step1TechAr: 'وفّر `/robots.txt` بصيغة `text/plain` يتضمن قواعد `User-agent: *` و`Sitemap:`.',
    verifyEn: 'Open `/robots.txt` in browser for HTTP 200 text content and re-scan.',
    verifyAr: 'افتح `/robots.txt` وتأكد من ظهوره بنص سليم برمز 200 ثم أعد الفحص.',
    refLabel: 'Google Create robots.txt',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt',
    codeExamples: [
      {
        title: bi('Minimal WordPress/web robots.txt example', 'مثال مبسط لملف robots.txt'),
        language: 'robots',
        scopeDisclaimer: bi(
          'Reference example only; review restricted paths before publishing.',
          'مثال مرجعي فقط؛ راجع المسارات المطلوب استثناؤها قبل النشر.',
        ),
        requiredEvidenceTag: 'robots_txt',
        snippet: 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml',
      },
    ],
  }),
  simpleSeoEntry({
    id: 'rec-seo-robots-disallow-all',
    ruleIds: ['SEO_ROBOTS_DISALLOW_ALL'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      '`/robots.txt` contains `Disallow: /`, blocking search engines from crawling the entire site.',
    problemSimpleAr:
      'يحتوي ملف `/robots.txt` على `Disallow: /`، مما يمنع محركات البحث من زحف الموقع بالكامل.',
    problemTechEn: 'Parsed `/robots.txt` includes root `Disallow: /` rule for `User-agent: *`.',
    problemTechAr: 'يفرض ملف `/robots.txt` قاعدة `Disallow: /` على جميع الزواحف.',
    impactSimpleEn: 'Search engines may stop indexing or drop site pages from search results.',
    impactSimpleAr: 'قد تتوقف محركات البحث عن فهرسة الموقع وتختفي صفحاتك من النتائج.',
    impactTechEn:
      'Critical organic visibility risk if left active on a public production site (normal only on private/staging sites).',
    impactTechAr: 'خطر حرج على الظهور في البحث إذا كان هذا موقعاً إنتاجياً عاماً.',
    confirmedCauseEn: 'Observed `/robots.txt` includes `Disallow: /` under `User-agent: *`.',
    confirmedCauseAr: 'رُصدت تعليمة `Disallow: /` في `/robots.txt`.',
    possibleCauseEn:
      'Commonly left behind after staging launch or WordPress "Discourage search engines from indexing this site" setting.',
    possibleCauseAr:
      'غالباً ما يُترك بالخطأ بعد إطلاق الموقع أو تفعيل خيار منع الفهرسة في ووردبريس.',
    locationEn: '`/robots.txt` (and WordPress Settings -> Reading if WordPress is detected).',
    locationAr: 'ملف `/robots.txt` (وإعدادات القراءة في ووردبريس إذا كان مفعلاً).',
    step1SimpleEn:
      'If this is a live public website, remove `Disallow: /` immediately and allow crawling.',
    step1SimpleAr: 'إذا كان هذا موقعاً عاماً حياً، أزل `Disallow: /` فوراً واسمح بالزحف.',
    step1TechEn:
      'Replace `Disallow: /` with targeted non-public disallows (e.g. admin endpoints) unless this is an intentionally private staging environment.',
    step1TechAr: 'أزل المنع الشامل واقتصر في Disallow على المسارات الإدارية الخاصة فقط.',
    verifyEn: 'Fetch `/robots.txt` to confirm `Disallow: /` is removed and re-scan.',
    verifyAr: 'تحقق من خلو `/robots.txt` من `Disallow: /` ثم أعد الفحص.',
    refLabel: 'Google robots.txt Spec',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
    platformGuidance: [
      {
        platform: 'wordpress',
        requiredEvidenceNote: bi(
          'Shown only because WordPress was detected in scan evidence.',
          'يظهر فقط لأن ووردبريس مكتشف في أدلة الفحص.',
        ),
        summary: dual(
          'In WordPress Dashboard, uncheck "Discourage search engines from indexing this site" under Settings -> Reading.',
          'في لوحة تحكم ووردبريس، أزل علامة الصح عن خيار "منع محركات البحث من أرشفة هذا الموقع" من الإعدادات -> قراءة.',
          'Check `blog_public` option (WP Admin -> Settings -> Reading -> Search engine visibility) and verify static `robots.txt` override.',
          'تحقق من خيار الرؤية لمحركات البحث في Settings -> Reading وكذلك من أي ملف robots.txt ثابت.',
        ),
        steps: [
          bi(
            'Open WP Admin -> Settings -> Reading and ensure Search Engine Visibility is unchecked on production.',
            'افتح الإعدادات -> قراءة في ووردبريس وتأكد من إلغاء تحديد خيار منع محركات البحث.',
          ),
        ],
      },
    ],
  }),
  simpleSeoEntry({
    id: 'rec-seo-robots-important-page-blocked',
    ruleIds: ['SEO_ROBOTS_IMPORTANT_PAGE_BLOCKED'],
    problemSimpleEn: '`/robots.txt` rules block crawling of important public or linked pages.',
    problemSimpleAr: 'تمنع قواعد `/robots.txt` زحف صفحات عامة أو مهمة.',
    problemTechEn:
      'Crawled or linked public URL path matches an active `Disallow` rule in `/robots.txt`.',
    problemTechAr: 'مسار صفحة عامة يطابق قاعدة حظر `Disallow` في `/robots.txt`.',
    impactSimpleEn:
      'Search engines cannot crawl blocked URLs and may fail to update content/snippets.',
    impactSimpleAr: 'لن تتمكن محركات البحث من قراءة المحتوى وتحديث نتائج الصفحة المحجوبة.',
    impactTechEn: 'Blocks crawler access to target content or essential CSS/JS assets.',
    impactTechAr: 'يحجب وصول زواحف البحث إلى صفحات أو موارد ضرورية.',
    confirmedCauseEn: 'URL path matched an explicit `Disallow` directive in `/robots.txt`.',
    confirmedCauseAr: 'طابق مسار الصفحة قاعدة `Disallow` صريحة في `/robots.txt`.',
    locationEn: '`/robots.txt` Disallow patterns.',
    locationAr: 'قواعد Disallow داخل `/robots.txt`.',
    step1SimpleEn:
      'Review whether the blocked path should be public; if yes, narrow or remove the blocking `Disallow` rule (or add a specific `Allow`).',
    step1SimpleAr:
      'راجع القاعدة الحاجبة في `/robots.txt` وأزل المنع أو خصص استثناء `Allow` للمسار العام.',
    step1TechEn:
      'Refine `/robots.txt` `Disallow` prefixes so public pages and required CSS/JS assets remain crawlable.',
    step1TechAr: 'ضبط أنماط `Disallow` في `/robots.txt` حتى لا تحجب الصفحات العامة أو أصول العرض.',
    verifyEn: 'Test target path against `/robots.txt` rules and re-scan.',
    verifyAr: 'اختبر المسار مع قواعد `/robots.txt` بعد التحديث ثم أعد الفحص.',
    refLabel: 'Google robots.txt Matching',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt',
  }),
  simpleSeoEntry({
    id: 'rec-seo-robots-conflicting-rules',
    ruleIds: ['SEO_ROBOTS_CONFLICTING_RULES'],
    problemSimpleEn:
      '`/robots.txt` contains contradictory Allow and Disallow rules for the same path.',
    problemSimpleAr: 'يحتوي ملف `/robots.txt` على قواعد Allow وDisallow متضاربة للمسار نفسه.',
    problemTechEn:
      'Parser detected overlapping conflicting Allow/Disallow directives of ambiguous specificity.',
    problemTechAr: 'اكتشف المحلل قواعد Allow وDisallow متداخلة ومتعارضة في `/robots.txt`.',
    impactSimpleEn: 'Different search bots may interpret conflicting directives unpredictably.',
    impactSimpleAr: 'قد تفسر زواحف البحث المختلفة القواعد المتضاربة بطرق غير متوقعة.',
    impactTechEn: 'Reduces deterministic crawler compliance across bot implementations.',
    impactTechAr: 'يُضعف اتساق التزام محركات البحث بالقواعد.',
    confirmedCauseEn: 'Overlapping Allow and Disallow entries observed in `/robots.txt`.',
    confirmedCauseAr: 'رُصدت قواعد Allow وDisallow متعارضة في `/robots.txt`.',
    locationEn: '`/robots.txt`.',
    locationAr: 'ملف `/robots.txt`.',
    step1SimpleEn:
      'Clean up duplicate or contradictory lines in `/robots.txt` so each rule clearly states intent.',
    step1SimpleAr: 'نظّف القواعد المتكررة والمتعارضة في `/robots.txt` لتكون واضحة وحاسمة.',
    step1TechEn:
      'Consolidate overlapping `Allow`/`Disallow` prefixes within each `User-agent` block.',
    step1TechAr: 'وحّد قواعد `Allow`/`Disallow` المتداخلة داخل كل قسم `User-agent`.',
    verifyEn: 'Validate cleaned `/robots.txt` syntax and re-scan.',
    verifyAr: 'راجع صياغة `/robots.txt` النظيفة ثم أعد الفحص.',
    refLabel: 'Robots Exclusion Standard (RFC 9309)',
    refUrl: 'https://www.rfc-editor.org/rfc/rfc9309',
  }),
  simpleSeoEntry({
    id: 'rec-seo-robots-malformed-syntax',
    ruleIds: ['SEO_ROBOTS_MALFORMED_SYNTAX'],
    problemSimpleEn: '`/robots.txt` contains syntax errors or invalid directive lines.',
    problemSimpleAr: 'يحتوي ملف `/robots.txt` على أخطاء صياغية أو أسطر غير صالحة.',
    problemTechEn:
      'Robots parser found invalid/unrecognized directive lines, missing `User-agent:` header, or HTML error content returned as `robots.txt`.',
    problemTechAr:
      'رصد المحلل أسطراً غير مفهومة أو نقص `User-agent:` أو إرجاع صفحة HTML بدلاً من نص robots.',
    impactSimpleEn: 'Crawlers may ignore the broken directives completely.',
    impactSimpleAr: 'قد تتجاهل محركات البحث قواعد الملف المعطوبة بالكامل.',
    impactTechEn: 'Causes unpredictable directive parsing across search engines.',
    impactTechAr: 'يسبب فشلاً في قراءة توجيهات الزحف.',
    confirmedCauseEn: 'Robots syntax parser flagged malformed directive lines.',
    confirmedCauseAr: 'أبلغ مدقق صياغة robots عن أسطر غير صالحة.',
    locationEn: '`/robots.txt` file content.',
    locationAr: 'محتوى ملف `/robots.txt`.',
    step1SimpleEn:
      'Fix invalid lines, ensure every group starts with `User-agent:`, and remove any non-directive HTML/comments errors.',
    step1SimpleAr:
      'صحّح الأسطر الخاطئة وتأكد من بدء كل مجموعة بـ `User-agent:` وبقاء الملف نصياً صرفاً.',
    step1TechEn:
      'Ensure valid `Key: value` syntax per RFC 9309 (`User-agent`, `Allow`, `Disallow`, `Sitemap`).',
    step1TechAr: 'التزم بصيغة RFC 9309 الصحيحة (`User-agent`, `Allow`, `Disallow`, `Sitemap`).',
    verifyEn: 'Inspect raw `/robots.txt` response text and re-scan.',
    verifyAr: 'افحص النص الخام لـ `/robots.txt` ثم أعد الفحص.',
    refLabel: 'RFC 9309 Robots Standard',
    refUrl: 'https://www.rfc-editor.org/rfc/rfc9309',
  }),
  simpleSeoEntry({
    id: 'rec-seo-robots-high-crawl-delay',
    ruleIds: ['SEO_ROBOTS_HIGH_CRAWL_DELAY'],
    causeConfidence: 'mixed',
    problemSimpleEn: '`/robots.txt` specifies a high `Crawl-delay` value that slows crawling.',
    problemSimpleAr: 'يحدد ملف `/robots.txt` قيمة مرتفعة لـ `Crawl-delay` تبطئ الزحف.',
    problemTechEn: 'Observed `Crawl-delay` directive exceeds recommended rate threshold.',
    problemTechAr: 'قيمة `Crawl-delay` المرصودة مرتفعة وتؤخر وتيرة زحف الصفحات.',
    impactSimpleEn: 'Large sites may take far longer for crawlers to refresh.',
    impactSimpleAr: 'تستغرق محركات البحث وقتاً أطول لاكتشاف وتحديث صفحات الموقع.',
    impactTechEn:
      'Slows bot discovery cadence (note: Googlebot ignores Crawl-delay, whereas Bing/others honor it).',
    impactTechAr: 'يبطئ زحف محركات مثل Bing وغيرها (بينما يتجاهل Googlebot هذا التوجيه).',
    confirmedCauseEn: 'Parsed `Crawl-delay` exceeded scanner threshold.',
    confirmedCauseAr: 'تجاوزت قيمة `Crawl-delay` الحد الموصى به.',
    possibleCauseEn: 'May be intentional on rate-limited origin servers to curb bot load.',
    possibleCauseAr: 'قد يكون مضبوطاً عمداً لحماية خادم محدود الموارد من ضغط الزواحف.',
    locationEn: '`/robots.txt` `Crawl-delay` line.',
    locationAr: 'سطر `Crawl-delay` في `/robots.txt`.',
    step1SimpleEn:
      'Reduce or remove `Crawl-delay` if your hosting handles normal crawler traffic well.',
    step1SimpleAr: 'خفّض أو أزل قيمة `Crawl-delay` إذا كانت استضافتك تتحمل حركة الزحف بسهولة.',
    step1TechEn:
      'Lower `Crawl-delay` or manage crawler rates via server capacity / CDN rate limiting instead.',
    step1TechAr: 'خفّف القيمة أو استخدم تحسين الأداء والتخزين المؤقت بدلاً من تبطيء الزحف الشامل.',
    verifyEn: 'Confirm updated `/robots.txt` directive and re-scan.',
    verifyAr: 'تأكد من تحديث التوجيه في `/robots.txt` ثم أعد الفحص.',
    refLabel: 'Bing Crawl Delay & Control',
    refUrl: 'https://www.bing.com/webmasters/help/how-to-create-a-robots-txt-file-cb7c31ec',
  }),
  simpleSeoEntry({
    id: 'rec-seo-robots-noindex',
    ruleIds: ['SEO_ROBOTS_NOINDEX'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'The page instructs search engines NOT to index it (`noindex` meta tag or `X-Robots-Tag`).',
    problemSimpleAr: 'الصفحة تطلب من محركات البحث عدم فهرستها (`noindex`).',
    problemTechEn:
      'Observed `<meta name="robots" content="...noindex...">` or `X-Robots-Tag: noindex` HTTP header.',
    problemTechAr: 'رُصد وسم `noindex` في ترويسات HTTP أو في `<head>` للصفحة.',
    impactSimpleEn:
      'If unintended on a public landing/product/blog page, that page will NOT appear in search results.',
    impactSimpleAr: 'إذا كان غير مقصود لصفحة عامة أو منتج أو مقال، فلن تظهر في نتائج البحث.',
    impactTechEn:
      'Excludes the URL from search engine index (appropriate only for private/thank-you/cart/utility pages).',
    impactTechAr: 'يستبعد الصفحة من الفهرس (مناسب فقط لصفحات السلة أو الحساب أو الشكر الخاصة).',
    confirmedCauseEn: 'Response header or meta robots tag explicitly declared `noindex`.',
    confirmedCauseAr: 'أعلنت الصفحة صراحة عن `noindex` في meta أو ترويسة HTTP.',
    locationEn: 'Document `<head>` meta robots tag or HTTP `X-Robots-Tag` header.',
    locationAr: 'وسم meta robots في `<head>` أو ترويسة `X-Robots-Tag`.',
    step1SimpleEn:
      'Confirm whether this page should appear in Google; if yes, change `noindex` to `index`.',
    step1SimpleAr: 'تحقق هل يجب ظهور هذه الصفحة في البحث؛ إن كان نعم فغيّر `noindex` إلى `index`.',
    step1TechEn:
      'Review page/template indexation toggle in CMS/SEO settings or HTTP server headers.',
    step1TechAr: 'راجع إعداد فهرسة الصفحة في القالب أو إعدادات SEO أو ترويسات الخادم.',
    verifyEn: 'Inspect `<meta name="robots">` and `X-Robots-Tag` headers, then re-scan.',
    verifyAr: 'تأكد من عدم وجود `noindex` على الصفحات العامة ثم أعد الفحص.',
    refLabel: 'Google Block Search Indexing with noindex',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/block-indexing',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  // --- Structured Data / Schema.org JSON-LD (10) ---
  simpleSeoEntry({
    id: 'rec-seo-schema-syntax-error',
    ruleIds: ['SEO_SCHEMA_SYNTAX_ERROR'],
    problemSimpleEn: 'A JSON-LD structured data `<script>` block contains invalid JSON syntax.',
    problemSimpleAr: 'تحتوي كتلة البيانات المنظمة JSON-LD على خطأ نحوي في صيغة JSON.',
    problemTechEn: '`JSON.parse()` failed on an `<script type="application/ld+json">` block.',
    problemTechAr: 'فشل تحليل `JSON.parse()` لإحدى كتل `<script type="application/ld+json">`.',
    impactSimpleEn:
      'Search engines discard broken structured data and cannot generate rich snippets.',
    impactSimpleAr: 'ترفض محركات البحث قراءة البيانات المنظمة المعطوبة ولا تعرض نتائج غنية.',
    impactTechEn: 'Invalid JSON syntax voids the entire JSON-LD graph block.',
    impactTechAr: 'خطأ الصياغة يبطل كامل كتلة البيانات المنظمة في الصفحة.',
    confirmedCauseEn:
      'JSON-LD block failed strict JSON parsing (trailing commas, unescaped quotes, or truncated string).',
    confirmedCauseAr:
      'فشل تحليل JSON الصارم لكتلة JSON-LD (مثل فاصلة زائدة أو علامة اقتباس غير مهربة).',
    locationEn: '`<script type="application/ld+json">` block in the affected page HTML.',
    locationAr: 'وسم `<script type="application/ld+json">` في مصدر الصفحة.',
    step1SimpleEn:
      'Copy the JSON-LD block into a JSON validator, fix syntax mistakes (quotes/commas/brackets), and re-publish.',
    step1SimpleAr: 'صحّح خطأ الصياغة في JSON (الأقواس أو الفواصل أو علامات التنصيص) وأعد الحفظ.',
    step1TechEn:
      'Validate the emitted JSON-LD payload cleanly with `JSON.parse` (remove trailing commas/HTML fragments).',
    step1TechAr: 'تحقق من سلامة إخراج JSON عبر محلل قياسي وأزل الفواصل الزائدة أو الوسوم المتسربة.',
    verifyEn:
      'Verify zero JSON parse errors and validate with Schema.org/Rich Results checks, then re-scan.',
    verifyAr: 'تأكد من صحة صيغة JSON في الصفحة ثم أعد الفحص.',
    refLabel: 'Google Structured Data Intro',
    refUrl:
      'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
  }),
  simpleSeoEntry({
    id: 'rec-seo-schema-missing-context-or-type',
    ruleIds: ['SEO_SCHEMA_MISSING_CONTEXT', 'SEO_SCHEMA_MISSING_TYPE'],
    problemSimpleEn: 'A structured data JSON-LD block is missing `@context` or `@type`.',
    problemSimpleAr: 'تفتقد بيانات JSON-LD المنظمة إلى `@context` أو `@type`.',
    problemTechEn:
      'Parsed JSON-LD object omits `"@context": "https://schema.org"` and/or `"@type"`.',
    problemTechAr: 'كائن JSON-LD يفتقد خاصية `"@context"` أو `"@type"` الأساسية.',
    impactSimpleEn:
      'Search engines cannot identify which vocabulary or entity type the structured data represents.',
    impactSimpleAr: 'لا تستطيع محركات البحث فهم نوع الكيان أو المخطط الموصوف.',
    impactTechEn: 'Blocks schema entity classification and rich-result eligibility.',
    impactTechAr: 'يمنع تصنيف الكيان واستحقاق المقتطفات الغنية.',
    confirmedCauseEn: 'JSON-LD root or entity object lacked `@context` or `@type`.',
    confirmedCauseAr: 'افتقد كائن JSON-LD إلى `@context` أو `@type`.',
    locationEn: '`<script type="application/ld+json">` block.',
    locationAr: 'كتلة `<script type="application/ld+json">`.',
    step1SimpleEn:
      'Include `"@context": "https://schema.org"` at the root and a valid `"@type"` on every entity.',
    step1SimpleAr: 'أضف `"@context": "https://schema.org"` وحدد `"@type"` المناسب للكيان.',
    step1TechEn: 'Add `"@context": "https://schema.org"` and valid Schema.org `@type` strings.',
    step1TechAr: 'أضف `"@context": "https://schema.org"` مع قيمة `@type` صحيحة.',
    verifyEn: 'Inspect `<script type="application/ld+json">` output and re-scan.',
    verifyAr: 'افحص كتلة JSON-LD للتأكد من وجود الحقلين ثم أعد الفحص.',
    refLabel: 'Schema.org Getting Started',
    refUrl: 'https://schema.org/docs/gs.html',
    codeExamples: [
      {
        title: bi(
          'Minimal JSON-LD WebPage context/type example',
          'مثال مبسط لحقلي @context و @type',
        ),
        language: 'json',
        scopeDisclaimer: bi(
          'Adapt @type and fields to match visible content on the page.',
          'عدّل النوع والحقول لتطابق محتوى الصفحة الفعلي.',
        ),
        requiredEvidenceTag: 'schema_jsonld',
        snippet:
          '{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  "name": "Page Title"\n}',
      },
    ],
  }),
  simpleSeoEntry({
    id: 'rec-seo-schema-duplicate-id',
    ruleIds: ['SEO_SCHEMA_DUPLICATE_ID'],
    problemSimpleEn: 'Multiple JSON-LD nodes reuse the same `@id` identifier on one page.',
    problemSimpleAr: 'تتكرر قيمة `@id` نفسها بين أكثر من كيان في البيانات المنظمة للصفحة.',
    problemTechEn:
      'Duplicate `@id` values found across JSON-LD blocks/graph items on the same document.',
    problemTechAr: 'تضارب في معرفات `@id` المكررة داخل كتل JSON-LD.',
    impactSimpleEn: 'Conflicting or duplicate `@id` values can corrupt entity graph merging.',
    impactSimpleAr: 'تكرار المعرفات قد يخلط خصائص الكيانات عند قراءة الرسم الدلالي.',
    impactTechEn:
      'Ambiguous entity graph resolution when two generators emit overlapping schema blocks.',
    impactTechAr: 'يسبب تعارضاً في ربط الكيانات خصوصاً عند تداخل أكثر من إضافة SEO/Schema.',
    confirmedCauseEn: 'Structured data graph inspection found repeated `@id` URI.',
    confirmedCauseAr: 'اكتشف فحص البيانات المنظمة تكرار المعرف `@id`.',
    possibleCauseEn:
      'Often triggered when two plugins (or theme + SEO plugin) both output Organization/WebSite JSON-LD.',
    possibleCauseAr: 'يحدث غالباً عند إخراج بيانات Schema من القالب ومن إضافة SEO في الوقت نفسه.',
    locationEn: '`<script type="application/ld+json">` blocks in HTML source.',
    locationAr: 'وسوم `<script type="application/ld+json">` في الصفحة.',
    step1SimpleEn:
      'Ensure each distinct schema entity uses a unique `@id` (or disable duplicate schema output from overlapping plugins/theme).',
    step1SimpleAr:
      'امنح كل كيان معرفاً فريداً أو أوقف إخراج Schema المكرر من القالب/الإضافة المتداخلة.',
    step1TechEn:
      'Deduplicate schema emitters or assign distinct fragment `@id`s (e.g. `#organization`, `#webpage`).',
    step1TechAr: 'أزل التكرار بين مولدات Schema أو خصّص معرفاً فريداً لكل كيان.',
    verifyEn: 'Inspect `@id` uniqueness across all JSON-LD blocks and re-scan.',
    verifyAr: 'تأكد من فرادة قيم `@id` في الصفحة ثم أعد الفحص.',
    refLabel: 'JSON-LD Node Identifiers',
    refUrl: 'https://www.w3.org/TR/json-ld11/#node-identifiers',
  }),
  simpleSeoEntry({
    id: 'rec-seo-schema-required-properties',
    ruleIds: [
      'SEO_SCHEMA_REQUIRED_PROPERTY_MISSING',
      'SEO_SCHEMA_ARTICLE_MISSING_REQUIRED',
      'SEO_SCHEMA_PRODUCT_MISSING_REQUIRED',
      'SEO_SCHEMA_BREADCRUMB_INVALID',
      'SEO_SCHEMA_PROPERTY_VALUE_INVALID',
    ],
    problemSimpleEn:
      'Structured data markup is missing required fields or contains invalid property values.',
    problemSimpleAr: 'البيانات المنظمة (Schema) تفتقد حقولاً إلزامية أو تحتوي قيماً غير صالحة.',
    problemTechEn:
      'Schema validator flagged missing required properties (Article/Product/BreadcrumbList/general) or malformed property format.',
    problemTechAr: 'رصد مدقق Schema نقصاً في خصائص إلزامية أو قيماً مخالفة للتنسيق المتوقع.',
    impactSimpleEn:
      'Rich search appearances (ratings, prices, breadcrumbs, article metadata) will be disqualified until corrected.',
    impactSimpleAr: 'لن تتأهل الصفحة للمقتطفات الغنية في نتائج البحث حتى تكتمل الخصائص وتُصحَّح.',
    impactTechEn: 'Fails Google Rich Results required-field validation.',
    impactTechAr: 'يفشل في التحقق الإلزامي لميزات النتائج الغنية.',
    confirmedCauseEn:
      'Structured data validator recorded missing required key or invalid value format.',
    confirmedCauseAr: 'سجّل مدقق Schema غياب خاصية مطلوبة أو قيمة غير صالحة.',
    locationEn: 'Observed JSON-LD entity and property name reported in finding evidence.',
    locationAr: 'الكيان والخاصية المحددة في أدلة JSON-LD.',
    step1SimpleEn:
      'Populate the missing required property using accurate data that is also visibly displayed on the page.',
    step1SimpleAr: 'أكمل الحقل المطلوب بمعلومات دقيقة موجودة فعلياً ومرئية على الصفحة.',
    step1TechEn:
      'Fix the reported property in your JSON-LD output (Article headline/author/datePublished; Product name + offers/review/aggregateRating; BreadcrumbList `itemListElement` positions 1..N).',
    step1TechAr: 'أصلح الخصائص الإلزامية للكيان المعني مع مطابقة البيانات الظاهرة في الصفحة.',
    verifyEn: 'Re-check the updated JSON-LD payload cleanly passes schema rules and re-scan.',
    verifyAr: 'تحقق من اكتمال خصائص الكيان ثم أعد الفحص.',
    refLabel: 'Google Structured Data Gallery',
    refUrl: 'https://developers.google.com/search/docs/appearance/structured-data/search-gallery',
    platformGuidance: [
      {
        platform: 'woocommerce',
        requiredEvidenceNote: bi(
          'Shown only because WooCommerce was detected in scan evidence.',
          'يظهر فقط لأن WooCommerce مكتشف في أدلة الفحص.',
        ),
        summary: dual(
          'Ensure WooCommerce product price, currency, stock availability, or SKU fields are populated so Product schema is complete.',
          'تأكد من ملء السعر والعملة وحالة التوفر في منتجات WooCommerce لاكتمال Schema المنتج.',
          'Check WooCommerce `offers` structured data generation and avoid duplicate Product blocks emitted by both theme/WooCommerce and SEO plugins.',
          'راجع توليد خاصية `offers` للمنتجات وتجنب تكرار كتلة Product بين القالب وإضافة SEO.',
        ),
        steps: [
          bi(
            'Verify published products have regular price and stock status set.',
            'تأكد من ضبط السعر وحالة المخزون للمنتجات المنشورة.',
          ),
        ],
      },
    ],
  }),
  simpleSeoEntry({
    id: 'rec-seo-schema-recommended-property-missing',
    ruleIds: ['SEO_SCHEMA_RECOMMENDED_PROPERTY_MISSING'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'Structured data is valid overall but misses optional recommended properties that enhance richness.',
    problemSimpleAr: 'البيانات المنظمة سليمة أساساً لكنها تفتقد خصائص موصى بها إضافية.',
    problemTechEn:
      'Entity schema omits recommended non-mandatory fields (such as `image`, `publisher`, `logo`, `offers`, or `telephone`).',
    problemTechAr: 'تفتقد كتلة Schema بعض الخصائص التوصوية مثل `image` أو `publisher` أو `logo`.',
    impactSimpleEn:
      'Low risk: page remains eligible, though supplying accurate recommended fields improves result richness.',
    impactSimpleAr: 'تأثير محدود: إضافة الحقول التوصوية يحسن ثراء بطاقة العرض في البحث.',
    impactTechEn: 'Advisory schema completeness enhancement.',
    impactTechAr: 'تحسين اختياري لاكتمال البيانات الدلالية.',
    confirmedCauseEn: 'Optional recommended property absent from detected JSON-LD entity.',
    confirmedCauseAr: 'غياب خاصية توصوية من كيان JSON-LD المرصود.',
    locationEn: '`<script type="application/ld+json">` entity.',
    locationAr: 'كتلة `<script type="application/ld+json">`.',
    step1SimpleEn:
      'Add the suggested fields only when truthful and relevant to the visible content.',
    step1SimpleAr: 'أضف الحقول المقترحة فقط متى توفرت بياناتها الفعلية في الصفحة.',
    step1TechEn:
      'Populate recommended Schema.org fields from real page metadata without inventing values.',
    step1TechAr: 'أكمل الحقول التوصوية من بيانات حقيقية دون افتراض قيم وهمية.',
    verifyEn: 'Inspect updated JSON-LD fields and re-scan.',
    verifyAr: 'تحقق من الحقول المضافة ثم أعد الفحص.',
    refLabel: 'Schema.org Entity Schemas',
    refUrl: 'https://schema.org/docs/schemas.html',
  }),

  // --- Sitemap (9) ---
  simpleSeoEntry({
    id: 'rec-seo-sitemap-missing-or-unreachable',
    ruleIds: ['SEO_SITEMAP_MISSING', 'SEO_SITEMAP_UNREACHABLE', 'SEO_SITEMAP_HTTP_ERROR'],
    problemSimpleEn:
      'No valid XML sitemap was found or the declared sitemap URL returned a network/HTTP error.',
    problemSimpleAr: 'خريطة الموقع XML غير موجودة أو تعيد خطأ اتصال أو HTTP عند جلبها.',
    problemTechEn:
      'Sitemap discovery (`/sitemap.xml` / `/sitemap_index.xml` / robots `Sitemap:`) was missing, unreachable, or returned non-200 status.',
    problemTechAr: 'فشل الوصول إلى ملف Sitemap XML أو أرجع رمز خطأ HTTP.',
    impactSimpleEn:
      'Search crawlers lose a structured index of your canonical pages and update timestamps.',
    impactSimpleAr: 'تفقد محركات البحث قائمة منظمة بروابط موقعك وتواريخ تحديثها.',
    impactTechEn: 'Slows discovery of deep or newly published pages on medium/large sites.',
    impactTechAr: 'يبطئ اكتشاف الصفحات العميقة أو المنشورة حديثاً.',
    confirmedCauseEn: 'Sitemap fetch failed or returned HTTP >= 400 / missing.',
    confirmedCauseAr: 'فشل جلب خريطة الموقع أو أرجع رمز خطأ أو لم يُعثر عليها.',
    locationEn: '`/sitemap.xml` (or `Sitemap:` line inside `/robots.txt`).',
    locationAr: 'مسار `/sitemap.xml` أو رابط `Sitemap:` في `/robots.txt`.',
    step1SimpleEn:
      'Ensure your XML sitemap is generated cleanly and returns HTTP 200, then reference its full URL in `/robots.txt`.',
    step1SimpleAr: 'وفّر خريطة موقع XML تعمل برمز 200 وأدرج رابطها في ملف `/robots.txt`.',
    step1TechEn:
      'Verify `/sitemap.xml` or `/wp-sitemap.xml` returns 200 `application/xml` without rewrite or cache errors.',
    step1TechAr:
      'تأكد من استجابة خريطة الموقع برمز 200 بنوع XML وتوافق الرابط المذكور في `/robots.txt`.',
    verifyEn: 'Open sitemap URL directly to confirm HTTP 200 XML output and re-scan.',
    verifyAr: 'افتح رابط Sitemap وتأكد من عرضه بصيغة XML صالحة وبرمز 200 ثم أعد الفحص.',
    refLabel: 'Google Build and Submit a Sitemap',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
    platformGuidance: [
      {
        platform: 'wordpress',
        requiredEvidenceNote: bi(
          'Shown only because WordPress was detected in scan evidence.',
          'يظهر فقط لأن ووردبريس مكتشف في أدلة الفحص.',
        ),
        summary: dual(
          'WordPress provides `/wp-sitemap.xml` by default (or via an SEO plugin); check Permalinks/rewrite rules if sitemaps return 404.',
          'يوفر ووردبريس `/wp-sitemap.xml` افتراضياً؛ أعد حفظ الروابط الدائمة أو راجع إعدادات الإضافة إذا أعادت 404.',
          'Verify WordPress core `/wp-sitemap.xml` or active SEO plugin sitemap endpoint and flush permalinks in staging if needed.',
          'تحقق من `/wp-sitemap.xml` أو نقطة Sitemap لإضافة السيو وتحديث الروابط الدائمة.',
        ),
        steps: [
          bi(
            'Test `/wp-sitemap.xml` and `/sitemap_index.xml` and ensure `/robots.txt` references the working one.',
            'اختبر `/wp-sitemap.xml` وتأكد من إشارة `/robots.txt` للرابط الصحيح.',
          ),
        ],
      },
    ],
  }),
  simpleSeoEntry({
    id: 'rec-seo-sitemap-malformed',
    ruleIds: ['SEO_SITEMAP_MALFORMED'],
    problemSimpleEn: 'The XML sitemap is malformed and could not be parsed cleanly.',
    problemSimpleAr: 'بنية ملف خريطة الموقع XML غير صالحة أو تحتوي أخطاء في الصياغة.',
    problemTechEn: 'XML parser failed or reported invalid `<urlset>` / `<sitemapindex>` structure.',
    problemTechAr: 'فشل محلل XML في قراءة بنية `<urlset>` أو `<sitemapindex>`.',
    impactSimpleEn: 'Search crawlers reject malformed sitemaps and miss listed URLs.',
    impactSimpleAr: 'ترفض محركات البحث قراءة خريطة الموقع المشوهة.',
    impactTechEn: 'Invalid XML prevents automated sitemap ingestion.',
    impactTechAr: 'يمنع XML المعطوب استيراد الروابط آلياً.',
    confirmedCauseEn:
      'XML parser failed on sitemap body (often stray whitespace before `<?xml`, unescaped `&`, or HTML error page).',
    confirmedCauseAr:
      'فشل محلل XML (غالباً بسبب علامات `&` غير المهربة أو مسافة قبل الترويسة أو صفحة خطأ HTML).',
    locationEn: 'Declared XML sitemap URL.',
    locationAr: 'رابط ملف Sitemap XML المعلن.',
    step1SimpleEn:
      'Open the sitemap raw source to inspect the exact XML error (unescaped `&`, whitespace before `<?xml`, or PHP warning text).',
    step1SimpleAr:
      'افحص المصدر الخام لملف XML لإصلاح الخطأ (مثل محارف غير مهربة أو نص زائد قبل الترويسة).',
    step1TechEn:
      'Fix invalid XML entities, leading whitespace before `<?xml version="1.0"?>`, or theme/plugin output pollution.',
    step1TechAr: 'أصلح أي مخرجات زائدة قبل وسم `<?xml` أو محارف خاصة غير مهربة.',
    verifyEn: 'Validate sitemap raw XML in browser/parser without errors and re-scan.',
    verifyAr: 'تأكد من قراءة ملف XML بسلام بدون أي أخطاء ثم أعد الفحص.',
    refLabel: 'Sitemaps XML Protocol',
    refUrl: 'https://www.sitemaps.org/protocol.html',
  }),
  simpleSeoEntry({
    id: 'rec-seo-sitemap-entries-quality',
    ruleIds: [
      'SEO_SITEMAP_CROSS_ORIGIN_URL',
      'SEO_SITEMAP_DUPLICATE_URL',
      'SEO_SITEMAP_INVALID_DATE',
    ],
    problemSimpleEn:
      'The XML sitemap lists invalid entries (duplicate URLs, external/cross-origin URLs, or invalid `<lastmod>` dates).',
    problemSimpleAr:
      'تحتوي خريطة الموقع على إدخالات غير سليمة (روابط مكررة أو نطاقات خارجية أو تواريخ `<lastmod>` خاطئة).',
    problemTechEn:
      'Sitemap entry validation detected duplicate `<loc>` URLs, out-of-origin `<loc>` hosts, or non-W3C Datetime `<lastmod>` strings.',
    problemTechAr:
      'رصد المدقق تكرار روابط `<loc>` أو وجود روابط لنطاق آخر أو تنسيق تاريخ `<lastmod>` غير قياسي.',
    impactSimpleEn:
      'Reduces crawler trust in sitemap quality and wastes processing on invalid entries.',
    impactSimpleAr: 'يُضعف دقة قراءة الخريطة ويزيد معالجة الإدخالات المرفوضة.',
    impactTechEn: 'Violates sitemaps.org host-scope and ISO-8601 date rules.',
    impactTechAr: 'يخالف قيود بروتوكول sitemaps.org للصلاحية والتنسيق.',
    confirmedCauseEn:
      'Sitemap parser observed invalid `<loc>` host, duplicated `<loc>`, or malformed `<lastmod>`.',
    confirmedCauseAr: 'وجد المحلل قيماً مكررة أو خارج النطاق أو تاريخاً بصيغة غير صالحة.',
    locationEn: 'Affected `<url>` blocks inside the XML sitemap.',
    locationAr: 'عناصر `<url>` داخل ملف Sitemap XML.',
    step1SimpleEn:
      'Deduplicate listed URLs, keep only canonical same-origin URLs, and format `<lastmod>` in ISO 8601 (e.g. `2026-01-15` or full UTC timestamp).',
    step1SimpleAr:
      'احذف التكرارات وأبقِ فقط روابط النطاق نفسه المعتمدة واضبط تاريخ `<lastmod>` بصيغة ISO 8601.',
    step1TechEn:
      'Emit unique canonical same-origin `<loc>` URIs and W3C Datetime `<lastmod>` timestamps.',
    step1TechAr: 'اجعل كل `<loc>` فريداً وضمن نفس النطاق، واستخدم تنسيق ISO 8601 لـ `<lastmod>`.',
    verifyEn: 'Inspect XML entries for uniqueness, host match, and valid dates, then re-scan.',
    verifyAr: 'تحقق من نظافة روابط وتواريخ XML ثم أعد الفحص.',
    refLabel: 'Sitemaps.org XML Schema',
    refUrl: 'https://www.sitemaps.org/protocol.html#xmlTagDefinitions',
  }),
  simpleSeoEntry({
    id: 'rec-seo-sitemap-coverage-drift',
    ruleIds: ['SEO_SITEMAP_PAGE_NOT_IN_SITEMAP', 'SEO_SITEMAP_URL_NOT_CRAWLED'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'There is a mismatch between pages discovered by crawling and URLs listed in the XML sitemap.',
    problemSimpleAr:
      'يوجد تباين بين الصفحات المكتشفة أثناء الزحف والروابط المسجلة في خريطة الموقع Sitemap.',
    problemTechEn:
      'Either a crawled indexable 200 page is omitted from the sitemap, or a URL listed in the sitemap was unreachable/unvisited during bounded crawl.',
    problemTechAr:
      'إما وجود صفحة عامة مفحوصة غير مدرجة في Sitemap أو رابط داخل Sitemap لم يُزحف أو يعاني من خطأ.',
    impactSimpleEn:
      'Orphaned sitemap URLs or omitted live pages can delay indexing of real content.',
    impactSimpleAr: 'الصفحات الغائبة عن الخريطة أو غير القابلة للزحف قد تتأخر أرشفتها.',
    impactTechEn:
      'Notice: if a scan hit a page-count cap, URLs beyond the cap may appear uncrawled even when valid.',
    impactTechAr:
      'ملاحظة: إذا بلغ الفحص الحد الأقصى لعدد الصفحات فقد تكون الروابط صالحة لكنها خارج سقف الزحف.',
    confirmedCauseEn:
      'Cross-reference between crawl graph and parsed `<loc>` set detected asymmetry.',
    confirmedCauseAr: 'أظهرت المقارنة بين نتائج الزحف وقائمة `<loc>` عدم تطابق جزئي.',
    possibleCauseEn:
      'Max-pages crawl budget limit in scan config, intentionally unlinked landing pages, or stale entries in sitemap.',
    possibleCauseAr:
      'قد يعود ذلك لسقف عدد صفحات الفحص أو صفحات مقصود استثناؤها أو روابط قديمة في Sitemap.',
    locationEn: 'URL list reported in evidence alongside your XML sitemap generator.',
    locationAr: 'قائمة الروابط في الأدلة مع إعدادات مولد Sitemap.',
    step1SimpleEn:
      'Include important public indexable pages in the sitemap, and remove obsolete/non-200 URLs from the sitemap.',
    step1SimpleAr: 'أدرج الصفحات العامة المهمة في Sitemap واحذف الروابط القديمة أو غير الصالحة.',
    step1TechEn:
      'Exclude noindex/redirect/error URLs from sitemap generation and ensure canonical live pages are included.',
    step1TechAr:
      'استبعد الروابط المعطوبة وnoindex من Sitemap وتأكد من إدراج الصفحات الحية المعتمدة.',
    verifyEn: 'Compare updated sitemap `<loc>` URLs against live 200 pages and re-scan.',
    verifyAr: 'قارن روابط Sitemap المحدثة بالصفحات الحية ثم أعد الفحص.',
    refLabel: 'Google Sitemaps Best Practices',
    refUrl: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
  }),

  // --- Hreflang & Multilingual SEO ---
  simpleSeoEntry({
    id: 'rec-seo-hreflang-invalid-tag',
    ruleIds: ['SEO_HREFLANG_INVALID_TAG'],
    problemSimpleEn:
      'A link rel="alternate" hreflang tag contains an invalid or non-standard language code.',
    problemSimpleAr:
      'يحتوي وسم hreflang التابع للغات المتعددة على رمز لغة غير قياسي أو غير صالح وفق معيار BCP 47.',
    problemTechEn:
      'The hreflang attribute value fails BCP 47 syntax or semantic validation (e.g. using underscores instead of hyphens like en_US).',
    problemTechAr:
      'قيمة السمة hreflang تخالف معيار BCP 47 (مثل استخدام الشرطة السفلية en_US بدلاً من en-US).',
    impactSimpleEn:
      'Search engines will ignore the language alternate annotation, preventing correct localized version serving.',
    impactSimpleAr:
      'تتجاهل محركات البحث إعلان اللغة المعطوب ولا تُظهر النسخة المناسبة للغة المستخدم أو منطقته الجغرافية.',
    impactTechEn:
      'Search engines fail to index the internationalized alternate relationship and do not swap URLs in localized SERPs.',
    impactTechAr:
      'تفشل محركات البحث في ربط النسخ الدولية ولا تستبدل الروابط تلقائياً في نتائج البحث الإقليمية.',
    confirmedCauseEn:
      'HTML parser extracted an hreflang attribute that failed BCP 47 language/region format validation.',
    confirmedCauseAr: 'أظهر استخراج HTML وسم hreflang لا يطابق معيار BCP 47 المعتمد دولياً.',
    locationEn: '<head> -> <link rel="alternate" hreflang="..." href="...">.',
    locationAr: 'داخل <head> -> وسم <link rel="alternate" hreflang="..." href="...">.',
    step1SimpleEn:
      'Replace underscores with hyphens (e.g. change en_US to en-US) and use valid ISO 639-1 language codes.',
    step1SimpleAr:
      'استبدل الشرطة السفلية بشرطة عادية (مثل تحويل en_US إلى en-US) واستخدم رموز ISO 639-1 الصحيحة.',
    step1TechEn:
      'Declare valid BCP 47 tags: language (ISO 639-1), optional script (ISO 15924), and optional region (ISO 3166-1 alpha-2 or UN M.49).',
    step1TechAr:
      'استخدم وسوم BCP 47 القياسية: رمز اللغة ثم الخط ثم رمز الدولة أو المنطقة بدون شرطات سفلية.',
    verifyEn:
      'Inspect the rendered <head> markup and verify that hreflang attributes conform to BCP 47.',
    verifyAr: 'افحص ترويسة الصفحة وتأكد من مطابقة قيم hreflang لصيغة BCP 47 ثم أعد الفحص.',
    refLabel: 'Google Localized Versions Guidelines',
    refUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  simpleSeoEntry({
    id: 'rec-seo-hreflang-missing-reciprocal',
    ruleIds: ['SEO_HREFLANG_MISSING_RECIPROCAL'],
    problemSimpleEn:
      'An alternate language page does not link back to this page with a reciprocal hreflang annotation.',
    problemSimpleAr:
      'الصفحة البديلة في لغة أخرى لا تحتوي على رابط تبادلي عكسي يشير إلى هذه الصفحة.',
    problemTechEn:
      'Page A declares Page B as an hreflang alternate, but crawled Page B lacks a return hreflang link pointing to Page A.',
    problemTechAr:
      'الصفحة الأولى تعلن الصفحة الثانية كبديل لغوي، لكن الصفحة الثانية لا تعلن الأولى كبديل عكسي.',
    impactSimpleEn:
      'Google and other search engines strictly ignore hreflang annotations that lack reciprocal confirmations.',
    impactSimpleAr:
      'تتجاهل محركات البحث إعلانات hreflang تماماً إذا لم تكن متبادلة ومؤكدة من الطرفين لمنع التزوير.',
    impactTechEn:
      'Asymmetric hreflang relationships are discarded by search engine indexing pipelines to prevent arbitrary cross-domain claiming.',
    impactTechAr:
      'يتم إلغاء تأثير الوسوم أحادية الاتجاه لمنع ادعاء التبعية اللغوية بين صفحات غير متوافقة.',
    confirmedCauseEn:
      'Cross-page audit crawled the alternate target and confirmed the absence of a return hreflang link.',
    confirmedCauseAr: 'فحص الربط بين الصفحات أكد غياب الرابط العكسي في الصفحة البديلة.',
    locationEn: 'Target alternate page <head> section.',
    locationAr: 'ترويسة الصفحة البديلة في الموقع.',
    step1SimpleEn:
      'Add a reciprocal <link rel="alternate" hreflang="..." href="..."> on the target page pointing back to the source page.',
    step1SimpleAr:
      'أضف وسم <link rel="alternate" hreflang="..." href="..."> في الصفحة البديلة ليشير إلى الصفحة الحالية.',
    step1TechEn:
      'Ensure every page in the language cluster shares an identical set of bidirectional hreflang links.',
    step1TechAr:
      'تأكد من أن جميع الصفحات في المجموعة اللغوية تشترك في نفس قائمة وسوم hreflang التبادلية.',
    verifyEn:
      'Re-crawl both pages and confirm that reciprocal links are present in both directions.',
    verifyAr: 'أعد فحص الصفحتين وتأكد من ظهور الرابط التبادلي في الاتجاهين.',
    refLabel: 'Google Bidirectional Hreflang Requirements',
    refUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  simpleSeoEntry({
    id: 'rec-seo-hreflang-conflicting-urls',
    ruleIds: ['SEO_HREFLANG_CONFLICTING_URLS', 'SEO_HREFLANG_DUPLICATE_DECLARATION'],
    problemSimpleEn:
      'Multiple or conflicting destination URLs are declared for the same language code on this page.',
    problemSimpleAr: 'تم إعلان روابط متعددة أو متضاربة لنفس رمز اللغة في الصفحة الواحدة.',
    problemTechEn:
      'The page specifies two or more <link rel="alternate"> tags with identical normalized hreflang values.',
    problemTechAr:
      'تحتوي الصفحة على وسمين أو أكثر من وسوم hreflang بنفس رمز اللغة ولكن بوجهات متضاربة.',
    impactSimpleEn:
      'Search engines cannot determine which URL to display to users for that language, risking indexing failure.',
    impactSimpleAr: 'تعجز محركات البحث عن تحديد الرابط الصحيح لعرضه للزوار في تلك اللغة.',
    impactTechEn:
      'Ambiguous language-to-URL mappings cause search engines to ignore conflicting alternate declarations.',
    impactTechAr: 'التضارب في تعيين اللغات يؤدي إلى تجاهل محركات البحث للوسوم المتعارضة.',
    confirmedCauseEn:
      'HTML parser detected duplicate or conflicting hreflang attributes on the same page.',
    confirmedCauseAr: 'اكتشف فاحص HTML تكراراً أو تعارضاً في وسوم hreflang على نفس الصفحة.',
    locationEn: '<head> -> multiple <link rel="alternate" hreflang="..."> tags.',
    locationAr: 'ترويسة <head> -> وسوم hreflang مكررة أو متعارضة.',
    step1SimpleEn: 'Ensure each language code corresponds to exactly one unique URL.',
    step1SimpleAr: 'تأكد من تعيين رابط واحد فريد لكل رمز لغة في الصفحة.',
    step1TechEn:
      'De-duplicate the hreflang link elements so that each language-region pair maps to a single canonical URL.',
    step1TechAr: 'احذف التكرارات واجعل كل لغة تشير إلى رابط معتمد واحد فقط.',
    verifyEn: 'Check page head to ensure unique language-to-URL mapping and re-scan.',
    verifyAr: 'تحقق من فرادة روابط اللغات في الصفحة ثم أعد الفحص.',
    refLabel: 'Google Localized Versions Guidelines',
    refUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  simpleSeoEntry({
    id: 'rec-seo-hreflang-x-default-invalid',
    ruleIds: ['SEO_HREFLANG_X_DEFAULT_INVALID'],
    problemSimpleEn:
      'The x-default hreflang tag specifies an empty, invalid, or unresolvable destination URL.',
    problemSimpleAr: 'وسم x-default الاحتياطي للغات يشير إلى رابط فارغ أو معطوب أو غير صالح.',
    problemTechEn:
      'A <link rel="alternate" hreflang="x-default"> was detected without a valid absolute or resolvable href attribute.',
    problemTechAr:
      'تم العثور على وسم x-default برابط href فارغ أو غير قابل للتحليل كعنوان URL صحيح.',
    impactSimpleEn:
      'Users without a matching language setting cannot be routed to the appropriate global fallback page.',
    impactSimpleAr:
      'لن يتمكن الزوار الذين لا تتطابق لغاتهم مع اللغات المتاحة من التوجيه للصفحة الافتراضية المناسبة.',
    impactTechEn:
      'Default international fallback routing signal is rendered invalid in search engine indexes.',
    impactTechAr: 'يتعطل مؤشر التوجيه الاحتياطي الافتراضي في فهارس محركات البحث.',
    confirmedCauseEn:
      'HTML parser identified an x-default annotation with an invalid or empty href attribute.',
    confirmedCauseAr: 'رصد الفاحص وسم x-default بقيمة href غير صالحة.',
    locationEn: '<head> -> <link rel="alternate" hreflang="x-default" href="...">.',
    locationAr: 'داخل <head> -> وسم x-default.',
    step1SimpleEn: 'Provide a complete, valid absolute URL for the x-default alternate version.',
    step1SimpleAr: 'أدخل رابطاً كاملاً وصحيحاً ومباشراً لنسخة x-default الافتراضية.',
    step1TechEn:
      'Set the href attribute to the international selector page or default English/global homepage.',
    step1TechAr: 'اضبط قيمة href لتشير إلى صفحة اختيار الدولة/اللغة أو الصفحة الافتراضية العامة.',
    verifyEn: 'Inspect the x-default link element and re-scan.',
    verifyAr: 'تأكد من صحة رابط x-default ثم أعد الفحص.',
    refLabel: 'Google x-default Hreflang Annotation',
    refUrl:
      'https://developers.google.com/search/docs/specialty/international/localized-versions#xdefault',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  simpleSeoEntry({
    id: 'rec-seo-hreflang-missing-self-reference',
    ruleIds: ['SEO_HREFLANG_MISSING_SELF_REFERENCE'],
    problemSimpleEn:
      'The page defines hreflang tags for other versions but omits a self-referencing hreflang tag.',
    problemSimpleAr:
      'تحدد الصفحة وسوم hreflang للغات الأخرى ولكنها تغفل الإشارة لنفسها بوسم لغة ذاتي.',
    problemTechEn:
      'Google guidelines recommend that a multilingual cluster includes a self-referencing hreflang link for the current page.',
    problemTechAr:
      'توصي إرشادات Google بأن تتضمن كل صفحة في المجموعة اللغوية وسم hreflang يشير إلى رابطها الذاتي.',
    impactSimpleEn:
      'Search engines may have difficulty establishing full reciprocal cluster confirmation.',
    impactSimpleAr: 'قد تواجه محركات البحث صعوبة في التأكيد الكامل على شمولية المجموعة اللغوية.',
    impactTechEn:
      'Omitting self-reference reduces explicit cluster integrity confirmation signals.',
    impactTechAr: 'إغفال الرابط الذاتي يقلل من اكتمال إشارات سلامة المجموعة اللغوية.',
    confirmedCauseEn:
      'HTML parser found external alternate hreflang tags but no tag pointing back to the page itself.',
    confirmedCauseAr: 'وجد الفحص وسوماً بديلة للغات أخرى مع غياب وسم يشير لرابط الصفحة الحالي.',
    locationEn:
      '<head> -> missing self-referencing <link rel="alternate" hreflang="..." href="...">.',
    locationAr: 'ترويسة الصفحة الحالية.',
    step1SimpleEn:
      'Add a self-referencing <link rel="alternate" hreflang="[current-lang]" href="[current-url]">.',
    step1SimpleAr: 'أضف وسماً يشير لنفس الصفحة باللغة الحالية ورابطها المعتمد.',
    step1TechEn: 'Include the current page canonical URL in its own hreflang cluster declarations.',
    step1TechAr: 'أدرج الرابط المعتمد للصفحة الحالية ضمن قائمة وسوم hreflang في الترويسة.',
    verifyEn: 'Confirm presence of self-referencing hreflang link and re-scan.',
    verifyAr: 'تأكد من وجود الرابط الذاتي ثم أعد الفحص.',
    refLabel: 'Google Localized Versions Guidelines',
    refUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  simpleSeoEntry({
    id: 'rec-seo-hreflang-inconsistent-language',
    ruleIds: ['SEO_HREFLANG_INCONSISTENT_LANGUAGE'],
    problemSimpleEn:
      'Reciprocal hreflang links between pages declare conflicting or inconsistent language codes.',
    problemSimpleAr: 'الروابط التبادلية بين الصفحات تعلن رموز لغات متعارضة أو غير متسقة.',
    problemTechEn:
      'Page A points to Page B as language X, but Page B points back to Page A using a conflicting language Y.',
    problemTechAr:
      'الصفحة الأولى تشير للثانية بلغة معينة، بينما تشير الثانية للأولى برمز لغة مختلف ومتعارض.',
    impactSimpleEn: 'Search engines will discard conflicting annotations due to language mismatch.',
    impactSimpleAr:
      'تتجاهل محركات البحث الإعلانات المتعارضة بسبب عدم اتساق تعيين اللغات بين الصفحتين.',
    impactTechEn:
      'Mismatched reciprocal language declarations invalidate the localized cluster relationship.',
    impactTechAr: 'عدم تطابق الرموز التبادلية يبطل موثوقية الرابط اللغوي في محركات البحث.',
    confirmedCauseEn:
      'Cross-page analyzer verified reciprocal links but identified conflicting language tags.',
    confirmedCauseAr: 'وجد الفاحص رابطاً عكسياً لكنه يعلن لغة مختلفة وغير متسقة مع الصفحة الأصلية.',
    locationEn: 'Both pages in the reciprocal language pair.',
    locationAr: 'الصفحتان المتبادلتان في المجموعة اللغوية.',
    step1SimpleEn:
      'Harmonize the language tags so that both pages agree on which URL represents which language.',
    step1SimpleAr: 'وحّد رموز اللغات بحيث تتفق الصفحتان على رمز اللغة المخصص لكل رابط بدقة.',
    step1TechEn:
      'Align the hreflang attributes across both pages so that reciprocal references use matching BCP 47 codes.',
    step1TechAr: 'وفق بين وسوم hreflang في الصفحتين لتطابق رموز BCP 47 التبادلية بدقة.',
    verifyEn: 'Re-crawl both pages and verify consistent language mappings.',
    verifyAr: 'أعد فحص الصفحتين وتأكد من اتساق وسوم اللغات.',
    refLabel: 'Google Localized Versions Guidelines',
    refUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  simpleSeoEntry({
    id: 'rec-seo-hreflang-target-broken',
    ruleIds: ['SEO_HREFLANG_TARGET_BROKEN'],
    problemSimpleEn:
      'An alternate hreflang link points to a destination page that returned an HTTP error or failed to load.',
    problemSimpleAr: 'يشير رابط hreflang البديل إلى صفحة تعيد خطأ HTTP أو تعذر تحميلها.',
    problemTechEn:
      'The hreflang destination URL returned HTTP 4xx/5xx or suffered a network fetch failure.',
    problemTechAr: 'وجهة الرابط البديل في hreflang تعيد استجابة خطأ 4xx/5xx أو فشل نقل شبكي.',
    impactSimpleEn:
      'Visitors clicking language switchers hit error pages and search engines cannot index the translation.',
    impactSimpleAr:
      'يصل الزوار إلى صفحات خطأ عند تغيير اللغة وتفشل محركات البحث في أرشفة النسخة المترجمة.',
    impactTechEn:
      'Broken alternate targets waste crawl resources and invalidate internationalization signals.',
    impactTechAr: 'الروابط البديلة المعطلة تهدر موارد الزحف وتبطل إشارات الترجمة المعتمدة.',
    confirmedCauseEn:
      'Crawl graph recorded a 4xx/5xx HTTP response or fetch error on an hreflang destination.',
    confirmedCauseAr: 'سجّل الزحف استجابة خطأ 4xx أو 5xx أو تعطل اتصال على وجهة hreflang.',
    locationEn: '<head> -> <link rel="alternate" hreflang="..." href="..."> destination.',
    locationAr: 'الرابط المحدد في وسم hreflang.',
    step1SimpleEn:
      'Update the link to point to a live 200 OK URL or remove outdated alternate references.',
    step1SimpleAr: 'حدّث الرابط ليشير لصفحة سليمة تعيد HTTP 200 أو احذف الرابط المعطل.',
    step1TechEn:
      'Ensure every declared hreflang target is a published, indexable, HTTP 200 response.',
    step1TechAr: 'تأكد من أن كل صفحة بديلة منشورة ومتاحة وتعيد استجابة 200 OK.',
    verifyEn: 'Visit the destination URL to confirm HTTP 200 and re-scan.',
    verifyAr: 'تحقق من عمل الصفحة البديلة ورجوع استجابة 200 ثم أعد الفحص.',
    refLabel: 'Google Localized Versions Guidelines',
    refUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),

  simpleSeoEntry({
    id: 'rec-seo-hreflang-target-uncrawled-or-external',
    ruleIds: ['SEO_HREFLANG_EXTERNAL_TARGET', 'SEO_HREFLANG_UNCRAWLED_TARGET'],
    causeConfidence: 'mixed',
    problemSimpleEn:
      'An alternate hreflang destination could not be reciprocally verified because it is external or was not visited within scan limits.',
    problemSimpleAr:
      'تعذر التحقق من الرابط العكسي لصفحة hreflang بديلة لأنها على نطاق خارجي أو لم يُزحف إليها ضمن سقف الفحص.',
    problemTechEn:
      'The destination URL is either outside the crawl scope (different domain/origin) or was not reached within the configured page/depth budget. Note: This is an audit observation and does NOT mean the target is broken.',
    problemTechAr:
      'الرابط إما خارج نطاق الفحص (نطاق خارجي) أو لم تصله أداة الزحف لبلوغ سقف الصفحات. ملاحظة: هذا تنبيه استكشافي ولا يعني أن الرابط معطل.',
    impactSimpleEn:
      'Reciprocal verification cannot be confirmed automatically without expanding crawl parameters.',
    impactSimpleAr:
      'لا يمكن تأكيد وجود الرابط التبادلي آلياً دون توسيع حدود الفحص أو فحص النطاق الخارجي.',
    impactTechEn:
      'Audit confidence for cross-page reciprocal confirmation is marked potential rather than confirmed.',
    impactTechAr: 'يتم تصنيف حالة التحقق التبادلي كحالة محتملة للاسترشاد دون تسجيل خطأ مؤكد.',
    confirmedCauseEn:
      'Cross-page analyzer verified target URL is out-of-scope or unvisited in the current crawl session.',
    confirmedCauseAr: 'أكد فحص الروابط أن الوجهة تقع خارج نطاق الزحف الحالي أو تجاوزت سقف الصفحات.',
    locationEn: '<head> -> <link rel="alternate" hreflang="..." href="..."> destination URL.',
    locationAr: 'رابط الوجهة في وسم hreflang.',
    step1SimpleEn:
      'If the target is external, verify manually that it links back with a reciprocal hreflang tag.',
    step1SimpleAr:
      'إذا كانت الوجهة خارجية، تأكد يدوياً من وجود رابط عكسي في تلك الصفحة يشير إلى موقعك.',
    step1TechEn:
      'For internal targets unvisited due to limits, increase maxPages/maxDepth in scan configuration to verify reciprocity.',
    step1TechAr: 'للصفحات الداخلية غير المفحوصة، ارفع سقف عدد الصفحات والعمق في إعدادات الفحص.',
    verifyEn: 'Check external page markup directly or expand scan scope and re-run.',
    verifyAr: 'افحص الصفحة الخارجية مباشرة أو وسّع نطاق الفحص ثم أعد التشغيل.',
    refLabel: 'Google Cross-Domain Hreflang',
    refUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
    platformGuidance: [WP_SEO_PLUGIN_NOTE],
  }),
];
