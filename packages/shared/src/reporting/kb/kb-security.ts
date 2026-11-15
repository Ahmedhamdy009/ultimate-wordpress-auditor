import { bi, dual, step, type RecommendationEntry } from './types.js';

const SEC_PASSIVE_LIMITATION = bi(
  'Assessed from observed HTTP response headers and TLS/cookie metadata only; this passive check does not replace an interactive penetration test or inspect backend origin rules.',
  'تم التقييم من ترويسات استجابة HTTP وبيانات TLS وملفات تعريف الارتباط المرصودة فقط؛ ولا يغني هذا الفحص السلبي عن اختبار الاختراق اليدوي أو فحص إعدادات الخادم الداخلية.',
);

function hstsSteps(
  directiveHint: string,
  directiveAr: string,
): RecommendationEntry['remediationSteps'] {
  return [
    step(
      1,
      'Confirm that your entire site and subdomains already work cleanly over HTTPS with valid TLS certificates before tightening HSTS.',
      'تأكد أولاً من عمل الموقع بالكامل والنطاقات الفرعية عبر HTTPS بشهادة صالحة قبل تشديد HSTS.',
      `Inspect the current Strict-Transport-Security response header on HTTPS endpoints and prepare the updated directive (${directiveHint}).`,
      `افحص ترويسة Strict-Transport-Security الحالية على نقاط نهاية HTTPS وأعدّ الصيغة المحدثة (${directiveAr}).`,
    ),
    step(
      2,
      'Update the header at your web server, reverse proxy, or CDN layer (only where header control is configured in your environment) and test in a staging environment.',
      'حدّث الترويسة في خادم الويب أو البروكسي العكسي أو طبقة الـ CDN المتاحة لديك، واختبرها أولاً في بيئة تجريبية.',
      'Apply the updated Strict-Transport-Security header on the origin or edge layer handling TLS termination, avoiding duplicate conflicting header definitions.',
      'طبّق ترويسة Strict-Transport-Security المحدثة على الخادم الأصلي أو طبقة الحافة المسؤولة عن إنهاء TLS مع تجنب تكرار الترويسات المتعارضة.',
    ),
  ];
}

function hstsVerification(): RecommendationEntry['verificationSteps'] {
  return [
    step(
      1,
      'Reload a page over HTTPS in browser DevTools and verify the Strict-Transport-Security header is present once with the intended settings, then run a fresh scan.',
      'أعد تحميل الصفحة عبر HTTPS في أدوات مطور المتصفح وتأكد من ظهور ترويسة Strict-Transport-Security مرة واحدة بالإعدادات الصحيحة، ثم أعد الفحص.',
      'Run a HEAD/GET request against the HTTPS target URL and verify exactly one valid Strict-Transport-Security header matching policy thresholds, then re-scan.',
      'نفّذ طلب HTTPS وتحقق من وجود ترويسة Strict-Transport-Security واحدة صالحة مطابقة للسياسة المطلوبة، ثم أعد تشغيل الفحص.',
    ),
  ];
}

export const SECURITY_KB_ENTRIES: readonly RecommendationEntry[] = [
  // --- Cookies (4) ---
  {
    recommendationId: 'rec-sec-cookie-insecure',
    ruleIds: ['SEC_COOKIE_INSECURE'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'woocommerce'],
    causeConfidence: 'confirmed',
    ...{
      problem: dual(
        'A cookie was set without the Secure attribute on an audited response.',
        'تم ضبط ملف تعريف ارتباط (Cookie) بدون سمة Secure في استجابة الموقع.',
        'Observed Set-Cookie header omits the Secure attribute, permitting browsers to transmit the cookie over unencrypted HTTP requests.',
        'ترويسة Set-Cookie المرصودة تفتقد سمة Secure، ما يسمح للمتصفح بإرسال ملف الارتباط عبر طلبات HTTP غير المشفرة.',
      ),
      impact: dual(
        'Sensitive session or preference cookies could be exposed if any request occurs over unencrypted HTTP.',
        'قد تتعرض ملفات الارتباط أو الجلسات للاعتراض إذا حدث أي طلب عبر اتصال HTTP غير مشفر.',
        'Increases exposure to network interception or downgrade paths where plain HTTP requests carry active cookie values.',
        'يزيد خطر اعتراض الشبكة أو استغلال طلبات HTTP غير المشفرة لنقل قيم ملفات الارتباط.',
      ),
      confirmedCauseTemplates: [
        bi(
          'Observed Set-Cookie header in the HTTP response omitted the Secure flag (values redacted for safety).',
          'أظهرت ترويسة Set-Cookie في الاستجابة غياب علم Secure (تم حجب القيم للحفاظ على الأمان).',
        ),
      ],
      possibleCauseTemplates: [
        bi(
          'Application code, a session handler, or a third-party plugin may be issuing cookies using non-HTTPS defaults.',
          'قد يصدر كود التطبيق أو معالج الجلسات أو إحدى الإضافات ملف الارتباط بإعدادات افتراضية غير مقيدة بـ HTTPS.',
        ),
      ],
      locationGuidance: dual(
        'Check the HTTP response Set-Cookie headers for the reported URL.',
        'راجع ترويسات Set-Cookie في استجابة HTTP للرابط المذكور.',
        'Inspect the named cookie in the Set-Cookie response header returned by the affected endpoint.',
        'افحص ملف الارتباط المسمى في ترويسة Set-Cookie ضمن استجابة نقطة النهاية المتأثرة.',
      ),
      remediationSteps: [
        step(
          1,
          'Ensure the site serves traffic exclusively over HTTPS before adding the Secure flag.',
          'تأكد من عمل الموقع بالكامل عبر HTTPS قبل تفعيل سمة Secure.',
          'Confirm full HTTPS enforcement across the domain and locate the code or server rule setting the observed cookie.',
          'تأكد من فرض HTTPS على كامل النطاق وحدد الجزء المسؤول في الخادم أو التطبيق عن إنشاء ملف الارتباط.',
        ),
        step(
          2,
          'Update the cookie definition to include the Secure attribute and re-test login/cart flows on staging.',
          'أضف سمة Secure إلى إعداد ملف الارتباط وأعد اختبار الجلسات في بيئة تجريبية.',
          'Add `; Secure` to the Set-Cookie response configuration (for example in PHP session settings, application middleware, or reverse proxy cookie flags).',
          'أضف `; Secure` إلى إعدادات إنشاء Set-Cookie في التطبيق أو جلسات PHP أو إعدادات البروكسي.',
        ),
      ],
      platformGuidance: [
        {
          platform: 'wordpress',
          requiredEvidenceNote: bi(
            'Shown only because WordPress was detected in scan evidence.',
            'يظهر فقط لأن ووردبريس مكتشف في الأدلة.',
          ),
          summary: dual(
            'Verify WordPress Site Address (HTTPS) settings and check whether a plugin is setting custom cookies without is_ssl().',
            'تحقق من إعدادات عنوان الموقع عبر HTTPS في ووردبريس وافحص الإضافات التي تنشئ Cookies مخصصة.',
            'Confirm FORCE_SSL_ADMIN / HTTPS siteurl and audit plugins calling setcookie() without secure=true or is_ssl().',
            'تحقق من تفعيل HTTPS في siteurl وFORCE_SSL_ADMIN وفحص أي إضافة تستدعي setcookie بدون التحقق من TLS.',
          ),
          steps: [
            bi(
              'Check Settings -> General -> WordPress Address & Site Address use https://.',
              'تأكد من استخدام https:// في الإعدادات العامة لعنوان ووردبريس والموقع.',
            ),
            bi(
              'Review custom plugins or theme hooks issuing non-core cookies.',
              'راجع أي إضافات أو قوالب تنشئ ملفات ارتباط إضافية.',
            ),
          ],
        },
        {
          platform: 'woocommerce',
          requiredEvidenceNote: bi(
            'Shown only because WooCommerce was detected in scan evidence.',
            'يظهر فقط لأن WooCommerce مكتشف في الأدلة.',
          ),
          summary: dual(
            'Ensure WooCommerce cart/session cookies are issued over HTTPS only.',
            'تأكد من إصدار ملفات ارتباط سلة وجلسة WooCommerce عبر HTTPS فقط.',
            'Verify SSL termination headers (X-Forwarded-Proto) reach PHP so WooCommerce marks session cookies Secure.',
            'تحقق من تمرير ترويسة X-Forwarded-Proto لـ PHP ليصدر WooCommerce ملفات الارتباط بسمة Secure.',
          ),
          steps: [
            bi(
              'Test checkout and cart updates over HTTPS after updating cookie flags.',
              'اختبر السلة والدفع عبر HTTPS بعد تحديث سمات الكوكيز.',
            ),
          ],
        },
      ],
      codeExamples: [
        {
          title: bi(
            'Cookie attribute example (HTTP Set-Cookie reference)',
            'مثال مرجعي لسمة Secure في ترويسة Set-Cookie',
          ),
          language: 'http',
          scopeDisclaimer: bi(
            'Reference pattern only; adjust cookie name and flags to your application requirements.',
            'نمط مرجعي فقط؛ عدّل الاسم والسمات حسب حاجة تطبيقك.',
          ),
          requiredEvidenceTag: 'cookie_header',
          snippet: 'Set-Cookie: session_id=<redacted>; Path=/; Secure; HttpOnly; SameSite=Lax',
        },
      ],
      verificationSteps: [
        step(
          1,
          'Open browser DevTools -> Network / Application -> Cookies and verify the Secure column is checked, then re-scan.',
          'افتح أدوات المطور ثم Application -> Cookies وتأكد من تفعيل Secure ثم أعد الفحص.',
          'Inspect Set-Cookie in curl/DevTools on an HTTPS response to confirm the Secure directive appears for every instance of the cookie.',
          'افحص ترويسة Set-Cookie في الاستجابة عبر HTTPS للتأكد من وجود السمة، ثم أعد الفحص.',
        ),
      ],
      limitations: [SEC_PASSIVE_LIMITATION],
      references: [
        {
          label: 'MDN Set-Cookie',
          url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie',
        },
      ],
    },
  },
  {
    recommendationId: 'rec-sec-cookie-no-httponly',
    ruleIds: ['SEC_COOKIE_NO_HTTPONLY'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress'],
    causeConfidence: 'mixed',
    problem: dual(
      'A cookie was observed without the HttpOnly flag.',
      'تم رصد ملف تعريف ارتباط بدون سمة HttpOnly.',
      'Observed Set-Cookie lacks HttpOnly, making its value readable by client-side JavaScript via document.cookie.',
      'ترويسة Set-Cookie تفتقد سمة HttpOnly، ما يجعل القيمة قابلة للقراءة عبر JavaScript من خلال document.cookie.',
    ),
    impact: dual(
      'If this cookie holds a session or auth identifier and an XSS flaw exists, scripts could read it.',
      'إذا كان ملف الارتباط يحمل معرف جلسة ووجدت ثغرة XSS فقد تتمكن السكربتات من قراءته.',
      'Increases post-XSS token exposure when session or state cookies lack HttpOnly protection.',
      'يزيد إمكانية قراءة الكوكي عبر السكربتات في حال وجود ثغرة XSS، ما لم يكن مصمماً للقراءة في المتصفح عمداً.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed Set-Cookie header does not include the HttpOnly attribute.',
        'ترويسة Set-Cookie المرصودة لا تحتوي على سمة HttpOnly.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'If the cookie is intentionally used by frontend JavaScript (such as a UI preference or CSRF double-submit token), omitting HttpOnly may be deliberate.',
        'إذا كان ملف الارتباط مخصصاً لقراءة JavaScript في الواجهة (مثل تفضيلات العرض أو رمز حماية)، فقد يكون غياب HttpOnly مقصوداً.',
      ),
    ],
    locationGuidance: dual(
      'Review the named cookie in the HTTP response headers.',
      'راجع ملف الارتباط المذكور في ترويسات استجابة HTTP.',
      'Inspect the named Set-Cookie entry for the reported URL and determine whether client-side JS requires read access.',
      'افحص عنصر Set-Cookie المسمى وتحقق مما إذا كان يحتاج فعلاً للقراءة من JavaScript.',
    ),
    remediationSteps: [
      step(
        1,
        'Confirm whether the cookie is a session/auth token or a harmless client-side UI preference.',
        'حدد أولاً هل ملف الارتباط خاص بالجلسة أم مجرد تفضيل واجهة تقرؤه الواجهة الأمامية.',
        'Audit code references to the cookie name across frontend scripts to verify HttpOnly compatibility.',
        'راجع جميع مواضع استخدام الكوكي في كود الواجهة الأمامية للتأكد من عدم تعطل وظائف المتصفح عند إضافة HttpOnly.',
      ),
      step(
        2,
        'For session or sensitive cookies, enable HttpOnly on the server or plugin configuration.',
        'بالنسبة لملفات الجلسات أو التوثيق، فعّل خيار HttpOnly من إعدادات الخادم أو التطبيق.',
        'Append `; HttpOnly` to server-managed cookies and deploy to staging for verification.',
        'أضف `; HttpOnly` لإعدادات إصدار الكوكي على الخادم واختبرها في بيئة تجريبية.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify HttpOnly appears in DevTools Application -> Cookies for session cookies and re-run the scan.',
        'تحقق من ظهور علامة HttpOnly في أدوات المطور ثم أعد الفحص.',
        'Confirm `; HttpOnly` in Set-Cookie response headers for all session cookies and re-scan.',
        'تأكد من وجود `; HttpOnly` في ترويسة Set-Cookie وأعد تشغيل الفحص.',
      ),
    ],
    limitations: [
      bi(
        'Automated header inspection cannot distinguish intentional non-sensitive JS-readable cookies from session tokens.',
        'الفحص التلقائي للترويسات لا يميز وحده بين ملفات التفضيل غير الحساسة وملفات الجلسات المصممَة للخادم فقط.',
      ),
      SEC_PASSIVE_LIMITATION,
    ],
    references: [
      { label: 'OWASP HttpOnly Cookie', url: 'https://owasp.org/www-community/HttpOnly' },
    ],
  },
  {
    recommendationId: 'rec-sec-cookie-samesite-missing',
    ruleIds: ['SEC_COOKIE_SAMESITE_MISSING'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress'],
    causeConfidence: 'confirmed',
    problem: dual(
      'A cookie was set without an explicit SameSite policy.',
      'تم تعيين ملف تعريف ارتباط بدون تحديد سياسة SameSite صريحة.',
      'Observed Set-Cookie header omits the SameSite attribute (Lax, Strict, or None; Secure).',
      'ترويسة Set-Cookie تفتقد سمة SameSite الصريحة (Lax أو Strict أو None; Secure).',
    ),
    impact: dual(
      'Without explicit SameSite rules, cross-site request behavior varies by browser defaults and can weaken CSRF protection.',
      'غياب SameSite يجعل سلوك الإرسال عبر المواقع معتمداً على المتصفح وقد يضعف الحماية من هجمات CSRF.',
      'Relying on implicit browser defaults reduces predictability for cross-site request forgery mitigation.',
      'الاعتماد على الإعداد الافتراضي للمتصفح يقلل وضوح سياسة الحماية ضد طلبات CSRF عبر المواقع.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed Set-Cookie response header lacks a SameSite directive.',
        'ترويسة Set-Cookie المرصودة تفتقد تعليمة SameSite.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Legacy PHP/framework session configuration or older plugins may omit SameSite.',
        'إعدادات جلسات قديمة في PHP أو إضافات غير محدثة قد تهمل SameSite.',
      ),
    ],
    locationGuidance: dual(
      'Inspect Set-Cookie headers on the affected endpoint.',
      'افحص ترويسات Set-Cookie في نقطة النهاية المتأثرة.',
      'Check the specific cookie entry reported in the Set-Cookie response header.',
      'راجع ملف الارتباط المحدد في ترويسة Set-Cookie ضمن الاستجابة.',
    ),
    remediationSteps: [
      step(
        1,
        'Choose SameSite=Lax for most navigation cookies or SameSite=Strict for sensitive admin/session cookies.',
        'اختر SameSite=Lax لمعظم الكوكيز أو SameSite=Strict للجلسات الإدارية الحساسة.',
        'Configure `SameSite=Lax` (or `Strict` when third-party redirects do not depend on the cookie) at the issuing layer.',
        'اضبط `SameSite=Lax` (أو `Strict` عند عدم الحاجة لإعادة التوجيه الخارجي) في الطبقة المصدرة للكوكي.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm the SameSite value is shown in DevTools Cookies and re-run the scan.',
        'تأكد من ظهور قيمة SameSite في أدوات المطور ثم أعد الفحص.',
        'Inspect Set-Cookie response headers to verify SameSite=Lax or Strict (or None; Secure where required).',
        'افحص ترويسة Set-Cookie للتأكد من وجود SameSite بالقيمة المناسبة ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN SameSite Cookies',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitelax',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-cookie-samesite-none-insecure',
    ruleIds: ['SEC_COOKIE_SAMESITE_NONE_INSECURE'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress'],
    causeConfidence: 'confirmed',
    problem: dual(
      'A cookie specifies SameSite=None without the mandatory Secure flag.',
      'ملف تعريف ارتباط يستخدم SameSite=None بدون سمة Secure الإلزامية.',
      'Set-Cookie declares `SameSite=None` without `; Secure`, causing modern browsers to reject or ignore the cookie.',
      'ترويسة Set-Cookie تحدد `SameSite=None` بدون `; Secure`، مما يدفع المتصفحات الحديثة إلى رفض الكوكي.',
    ),
    impact: dual(
      'Modern browsers block insecure SameSite=None cookies, which can break logins, embeds, or checkout flows.',
      'المتصفحات الحديثة ترفض هذه الكوكيز، ما قد يعطل تسجيل الدخول أو المكونات المضمنة أو الدفع.',
      'Cross-context cookies without Secure are dropped by Chromium/Firefox/Safari engines.',
      'تُرفض ملفات الارتباط التي تستخدم SameSite=None دون Secure في محركات المتصفحات الحديثة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed Set-Cookie header contains SameSite=None while Secure is absent.',
        'ترويسة Set-Cookie تحتوي على SameSite=None مع غياب Secure.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'TLS may terminate before the application server without forwarding HTTPS awareness.',
        'قد يُنهى TLS قبل خادم التطبيق دون إعلامه بأن الطلب تم عبر HTTPS.',
      ),
    ],
    locationGuidance: dual(
      'Inspect the named Set-Cookie header on the affected URL.',
      'راجع ترويسة Set-Cookie المسماة في الرابط المتأثر.',
      'Locate the code or proxy directive emitting SameSite=None for the reported cookie.',
      'حدد الكود أو قاعدة البروكسي التي تصدر SameSite=None لهذا الكوكي.',
    ),
    remediationSteps: [
      step(
        1,
        'Add the Secure attribute whenever SameSite=None is used, or switch to SameSite=Lax if cross-site access is unnecessary.',
        'أضف سمة Secure دائماً مع SameSite=None، أو استخدم SameSite=Lax إذا لم يكن الإرسال عبر المواقع مطلوباً.',
        'Ensure `SameSite=None; Secure` on HTTPS endpoints or replace with `SameSite=Lax; Secure` for same-site workflows.',
        'اضبط `SameSite=None; Secure` عبر HTTPS أو استبدله بـ `SameSite=Lax; Secure` عند عدم الحاجة للعمل عبر المواقع.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Check DevTools Network console for cookie rejection warnings and confirm both SameSite and Secure flags, then re-scan.',
        'تأكد في أدوات المطور من اختفاء تحذيرات رفض الكوكيز ووجود كل من SameSite وSecure ثم أعد الفحص.',
        'Confirm zero browser Set-Cookie warnings and verify `; SameSite=None; Secure` over HTTPS.',
        'تأكد من خلو المتصفح من تحذيرات الكوكيز ووجود `; SameSite=None; Secure` ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'web.dev SameSite Updates',
        url: 'https://web.dev/articles/samesite-cookies-explained',
      },
    ],
  },

  // --- CSP Headers (4) ---
  {
    recommendationId: 'rec-sec-header-csp-missing',
    ruleIds: ['SEC_HEADER_CSP_MISSING'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'elementor', 'cdn_cache', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'No Content-Security-Policy (CSP) header was found on the audited response.',
      'لم يتم العثور على ترويسة Content-Security-Policy (CSP) في استجابة الصفحة.',
      'The HTTP response omits Content-Security-Policy, leaving the browser without script, style, or frame origin restrictions.',
      'تفتقد استجابة HTTP ترويسة Content-Security-Policy، مما يترك المتصفح دون قيود على مصادر السكربتات والأنماط والإطارات.',
    ),
    impact: dual(
      'Defense-in-depth against injected scripts (XSS) and unauthorized embeds is reduced.',
      'تنخفض طبقة الحماية الوقائية ضد حقن السكربتات (XSS) والتضمين غير المصرح به.',
      'Without a restrictive CSP, browsers execute any inline or external script injected into the DOM.',
      'بدون CSP تقييدية، سينفذ المتصفح أي سكربت محقون داخل DOM دون قيود مصدرية.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed HTTP response headers did not contain Content-Security-Policy.',
        'ترويسات استجابة HTTP المرصودة لا تحتوي على Content-Security-Policy.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'CSP may not be configured at the origin server, CDN edge rules, or WordPress security configuration yet.',
        'قد لا تكون سياسة CSP مفعّلة بعد على الخادم أو طبقة الـ CDN أو إعدادات الموقع.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers for the target URL.',
      'ترويسات استجابة HTTP للرابط المفحوص.',
      'Inspect response headers for the document URL at your origin web server or edge/CDN configuration.',
      'افحص ترويسات استجابة المستند في خادم الويب الأصلي أو طبقة الحافة/CDN.',
    ),
    remediationSteps: [
      step(
        1,
        'Inventory every external script, font, image, API, and iframe source your site legitimately uses.',
        'احصر جميع مصادر السكربتات والخطوط والصور والإطارات التي يستخدمها موقعك فعلياً.',
        'Start by deploying a Content-Security-Policy-Report-Only header to observe blocked assets without breaking live rendering.',
        'ابدأ بنشر الترويسة بوضع Report-Only لمراقبة الموارد التي قد تتعطل دون كسر الواجهة المباشرة.',
      ),
      step(
        2,
        'Once clean in Report-Only mode, enforce the Content-Security-Policy header without weakening script-src.',
        'بعد التأكد من عدم تعطل الوظائف في وضع المراقبة، فعّل ترويسة Content-Security-Policy الإلزامية.',
        'Promote the verified policy to Content-Security-Policy and test interactive pages (forms, menus, editors) in staging.',
        'اعتمد السياسة المختبرة في Content-Security-Policy واختبر الصفحات التفاعلية في بيئة تجريبية.',
      ),
    ],
    platformGuidance: [
      {
        platform: 'elementor',
        requiredEvidenceNote: bi(
          'Shown only because Elementor was detected in page evidence.',
          'يظهر فقط لأن Elementor مكتشف في أدلة الصفحة.',
        ),
        summary: dual(
          'Elementor pages often rely on inline styles or dynamic widget scripts; test CSP in Report-Only mode before enforcing.',
          'صفحات Elementor قد تعتمد على أنماط مضمنة وسكربتات مكونات؛ اختبر CSP في وضع Report-Only قبل فرضها.',
          'Audit Elementor frontend assets, Google Fonts (if enabled), and inline style usage so strict CSP does not break page layouts.',
          'راجع أصول Elementor والخطوط والأنماط المضمنة عند إعداد CSP حتى لا يتأثر تنسيق الصفحات.',
        ),
        steps: [
          bi(
            'Test templates containing sliders, popups, or forms under Report-Only first.',
            'اختبر القوالب والنوافذ المنبثقة والنماذج تحت وضع Report-Only أولاً.',
          ),
        ],
      },
    ],
    codeExamples: [
      {
        title: bi(
          'Starter Content-Security-Policy-Report-Only header example',
          'مثال أولي لترويسة CSP في وضع المراقبة',
        ),
        language: 'http',
        scopeDisclaimer: bi(
          'Starter baseline only — adjust directives for your actual verified asset domains.',
          'نقطة بداية فقط — عدّل التوجيهات وفق النطاقات الموثوقة في موقعك.',
        ),
        requiredEvidenceTag: 'http_header_evidence',
        snippet:
          "Content-Security-Policy-Report-Only: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      },
    ],
    verificationSteps: [
      step(
        1,
        'Verify the enforced Content-Security-Policy header appears in DevTools Network without breaking console errors, then re-scan.',
        'تأكد من ظهور ترويسة Content-Security-Policy في أدوات المطور بدون أخطاء في Console ثم أعد الفحص.',
        'Confirm zero CSP violation errors across critical routes and verify header enforcement in HTTP responses.',
        'تأكد من خلو المسارات الأساسية من مخالفات CSP ومن فرض الترويسة في الاستجابة، ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN Content-Security-Policy',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-csp-report-only',
    ruleIds: ['SEC_HEADER_CSP_REPORT_ONLY'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'CSP is currently configured in Report-Only monitoring mode rather than enforcing protection.',
      'سياسة CSP تعمل حالياً بوضع المراقبة (Report-Only) فقط ولا تمنع التنفيذ.',
      'Response sends Content-Security-Policy-Report-Only without an active enforcing Content-Security-Policy header.',
      'الاستجابة ترسل Content-Security-Policy-Report-Only دون ترويسة Content-Security-Policy مفعّلة للمنع.',
    ),
    impact: dual(
      'Violations are logged only; unauthorized scripts or embeds are not blocked by the browser.',
      'تُسجّل المخالفات فقط بينما لا يمنع المتصفح تحميل أو تنفيذ السكربتات غير المصرح بها.',
      'Provides telemetry without runtime browser blocking protection.',
      'يوفر مراقبة فقط بدون حظر فعلي للمصادر غير المصرح بها داخل المتصفح.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed Content-Security-Policy-Report-Only header without a companion enforcing Content-Security-Policy.',
        'تم رصد Content-Security-Policy-Report-Only دون ترويسة فرض موازية.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'The site may intentionally be in a rollout or policy-tuning stage.',
        'قد يكون الموقع عمداً في مرحلة اختبار وضبط السياسة قبل التفعيل.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers of the target page.',
      'ترويسات استجابة HTTP للصفحة المستهدفة.',
      'Check wherever Content-Security-Policy-Report-Only is emitted in your response pipeline.',
      'افحص المكان الذي يصدر Content-Security-Policy-Report-Only في سلسلة الاستجابة.',
    ),
    remediationSteps: [
      step(
        1,
        'Review any browser console or CSP violation reports collected while in Report-Only mode.',
        'راجع تقارير وأخطاء CSP المسجلة في المتصفح أثناء فترة المراقبة.',
        'Verify no legitimate scripts, styles, frames, or endpoints trigger violations under the draft policy.',
        'تحقق من عدم تأثر أي سكربتات أو أنماط أو إطارات شرعية بالسياسة المسودة.',
      ),
      step(
        2,
        'Switch the header name from Content-Security-Policy-Report-Only to Content-Security-Policy.',
        'حوّل اسم الترويسة من Content-Security-Policy-Report-Only إلى Content-Security-Policy.',
        'Deploy the validated policy as an enforcing Content-Security-Policy header.',
        'انشر السياسة المعتمدة تحت اسم Content-Security-Policy المفروضة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm Content-Security-Policy is present in response headers and interactive flows work cleanly, then re-scan.',
        'تأكد من وجود Content-Security-Policy في ترويسات الاستجابة وسلامة التفاعل، ثم أعد الفحص.',
        'Verify enforcing CSP header in Network inspection and re-run audit.',
        'تحقق من تفعيل الترويسة الملزمة في فحص الشبكة ثم أعد تشغيل الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN CSP Report-Only',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-csp-unsafe-eval',
    ruleIds: ['SEC_HEADER_CSP_UNSAFE_EVAL'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'mixed',
    problem: dual(
      'The CSP policy allows unsafe-eval, weakening protection against dynamic code execution.',
      'تسمح سياسة CSP بخيار unsafe-eval، مما يضعف الحماية ضد تنفيذ الكود الديناميكي.',
      "Content-Security-Policy includes `'unsafe-eval'` in script directives, allowing eval(), new Function(), and string-based timers.",
      "سياسة Content-Security-Policy تتضمن `'unsafe-eval'`، ما يسمح بتنفيذ نصوص كسكربتات مثل eval().",
    ),
    impact: dual(
      'If script data becomes user-controllable, browsers will allow dynamic string evaluation.',
      'إذا تسربت بيانات قابلة للتحكم داخل سكربت، سيسمح المتصفح بتقييمها وتنفيذها ديناميكياً.',
      'Broadens script execution surface and reduces CSP effectiveness against DOM-based XSS payloads.',
      'يوسّع سطح تنفيذ السكربتات ويقلص فاعلية CSP ضد هجمات DOM XSS.',
    ),
    confirmedCauseTemplates: [
      bi(
        "Observed Content-Security-Policy header explicitly contains 'unsafe-eval'.",
        "تحتوي ترويسة Content-Security-Policy المرصودة صراحة على 'unsafe-eval'.",
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'A legacy frontend library, template compiler, or page builder preview script might rely on eval().',
        'قد تعتمد مكتبة واجهة قديمة أو محرر قوالب على eval() أثناء التشغيل.',
      ),
    ],
    locationGuidance: dual(
      'Content-Security-Policy response header.',
      'ترويسة Content-Security-Policy في الاستجابة.',
      'Inspect script-src / default-src directives inside the observed Content-Security-Policy header.',
      'افحص توجيهي script-src وdefault-src داخل ترويسة Content-Security-Policy.',
    ),
    remediationSteps: [
      step(
        1,
        'Search frontend scripts for eval or dynamic string code execution in a staging environment.',
        'تحقق في بيئة تجريبية مما إذا كان الموقع يحتاج eval فعلاً أم أضيف احتياطياً.',
        "Test removing `'unsafe-eval'` using Content-Security-Policy-Report-Only and inspect any resulting violation telemetry.",
        "جرّب إزالة `'unsafe-eval'` في وضع Report-Only وراقب تقارير المخالفات لتحديد السكربت المعتمد عليه.",
      ),
      step(
        2,
        'Replace dynamic code evaluation with precompiled bundles or safe JSON parsing, then remove unsafe-eval.',
        'استبدل أي تقييم نصي للكود بحزم مترجمة مسبقاً أو JSON.parse ثم احذف unsafe-eval.',
        "Eliminate eval()-dependent code paths and remove `'unsafe-eval'` from the enforced CSP header.",
        "أزل المسارات المعتمدة على eval() ثم احذف `'unsafe-eval'` من الترويسة الملزمة.",
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify the CSP header no longer contains unsafe-eval and all pages render without CSP console errors.',
        'تحقق من إزالة unsafe-eval من الترويسة وعمل الصفحات بدون أخطاء في Console.',
        'Confirm zero runtime CSP violations and re-run scan.',
        'تأكد من عدم ظهور مخالفات CSP وأعد تشغيل الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN script-src CSP',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/script-src',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-csp-unsafe-inline',
    ruleIds: ['SEC_HEADER_CSP_UNSAFE_INLINE'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'elementor'],
    causeConfidence: 'mixed',
    problem: dual(
      'The CSP policy permits unsafe-inline execution for scripts or styles.',
      'تسمح سياسة CSP بخيار unsafe-inline للسكربتات أو الأنماط.',
      "Observed Content-Security-Policy uses `'unsafe-inline'` (most critically in script-src/default-src), allowing inline script or attribute execution.",
      "سياسة Content-Security-Policy تستخدم `'unsafe-inline'`، ما يسمح بتنفيذ السكربتات أو الأنماط المضمنة مباشرة في HTML.",
    ),
    impact: dual(
      'When enabled for scripts, inline XSS protections of CSP are largely bypassed.',
      'عند تفعيله للسكربتات، تفقد سياسة CSP جزءاً كبيراً من حمايتها ضد حقن XSS المضمن.',
      'Inline `<script>` blocks and event handlers (`onload`, `onclick`) remain executable when script-src allows unsafe-inline.',
      'تظل كتل `<script>` ومعالجات الأحداث المضمنة قابلة للتنفيذ عندما يسمح script-src بـ unsafe-inline.',
    ),
    confirmedCauseTemplates: [
      bi(
        "Observed Content-Security-Policy header includes 'unsafe-inline'.",
        "تتضمن ترويسة Content-Security-Policy المرصودة قيمة 'unsafe-inline'.",
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'CMS themes, inline analytics snippets, or page builder inline blocks often motivate broad unsafe-inline allowances.',
        'غالباً ما يدفع وجود سكربتات مضمنة في القالب أو أدوات القياس لاستخدام unsafe-inline.',
      ),
    ],
    locationGuidance: dual(
      'Content-Security-Policy response header.',
      'ترويسة Content-Security-Policy في الاستجابة.',
      'Inspect script-src, style-src, and default-src in the returned CSP header.',
      'افحص توجيهات script-src وstyle-src وdefault-src في ترويسة CSP.',
    ),
    remediationSteps: [
      step(
        1,
        'Move inline scripts into external files or authorize specific blocks using cryptographic nonces or SHA hashes.',
        'انقل السكربتات المضمنة إلى ملفات خارجية أو استخدم nonces أو بصمات SHA بدلاً من unsafe-inline.',
        'Replace inline script allowances with per-response CSP nonces or static hashes (prioritizing script-src before style-src).',
        'استبدل السماح المضمن للسكربتات بـ CSP nonces أو بصمات SHA مع إعطاء الأولوية لـ script-src.',
      ),
      step(
        2,
        'Verify with Report-Only first so WordPress themes/plugins or dynamic widgets are not broken.',
        'اختبر التغيير بوضع Report-Only أولاً لتجنب تعطيل قوالب أو إضافات الموقع.',
        'Validate page functionality under Report-Only, then remove unsafe-inline from script directives.',
        'تحقق من عمل الواجهة في Report-Only ثم احذف unsafe-inline من توجيه السكربتات.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm script-src enforces nonces/hashes without unsafe-inline and re-run audit.',
        'تأكد من إزالة unsafe-inline من script-src وعمل الموقع دون أخطاء، ثم أعد الفحص.',
        'Inspect CSP header and browser Console across primary pages, then re-scan.',
        'افحص ترويسة CSP ووحدة التحكم عبر الصفحات الرئيسية ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [{ label: 'web.dev Strict CSP', url: 'https://web.dev/articles/strict-csp' }],
  },

  // --- HSTS Family (7) ---
  {
    recommendationId: 'rec-sec-header-hsts-missing',
    ruleIds: ['SEC_HEADER_HSTS_MISSING'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'cdn_cache', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Strict-Transport-Security (HSTS) header is missing from HTTPS responses.',
      'ترويسة Strict-Transport-Security (HSTS) مفقودة من استجابات HTTPS.',
      'Observed HTTPS response did not send Strict-Transport-Security to instruct browsers to enforce HTTPS automatically.',
      'لم ترسل استجابة HTTPS ترويسة Strict-Transport-Security لإلزام المتصفح بالاتصال الآمن تلقائياً.',
    ),
    impact: dual(
      'First-visit or HTTP links can initially connect over unencrypted HTTP before a redirect occurs.',
      'الزيارة الأولى أو الروابط القديمة قد تبدأ عبر HTTP غير مشفر قبل إعادة التوجيه.',
      'Browsers lack cached HSTS enforcement against protocol downgrade attempts.',
      'لا يملك المتصفح سياسة HSTS مخزنة للحماية من محاولات خفض الاتصال إلى HTTP.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Strict-Transport-Security header was absent on observed HTTPS response.',
        'كانت ترويسة Strict-Transport-Security غائبة في استجابة HTTPS المرصودة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'HSTS may not yet be enabled at the web server, load balancer, or CDN.',
        'قد لا تكون ميزة HSTS مفعّلة بعد على الخادم أو موزع الأحمال أو الـ CDN.',
      ),
    ],
    locationGuidance: dual(
      'HTTPS response headers of the audited origin.',
      'ترويسات استجابة HTTPS للموقع المفحوص.',
      'Configure Strict-Transport-Security on HTTPS responses only (browsers ignore HSTS over plain HTTP).',
      'أضف ترويسة Strict-Transport-Security على استجابات HTTPS فقط (المتصفحات تتجاهلها على HTTP).',
    ),
    remediationSteps: hstsSteps(
      'max-age=31536000; includeSubDomains',
      'max-age=31536000; includeSubDomains',
    ),
    codeExamples: [
      {
        title: bi('HSTS response header example', 'مثال ترويسة HSTS'),
        language: 'http',
        scopeDisclaimer: bi(
          'Only enable includeSubDomains after verifying all subdomains support HTTPS.',
          'فعّل includeSubDomains فقط بعد التأكد من عمل جميع النطاقات الفرعية عبر HTTPS.',
        ),
        requiredEvidenceTag: 'http_header_evidence',
        snippet: 'Strict-Transport-Security: max-age=31536000; includeSubDomains',
      },
    ],
    verificationSteps: hstsVerification(),
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN Strict-Transport-Security',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-hsts-malformed',
    ruleIds: ['SEC_HEADER_HSTS_MALFORMED'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The Strict-Transport-Security header syntax is malformed and may be ignored by browsers.',
      'صياغة ترويسة Strict-Transport-Security غير صالحة وقد يتجاهلها المتصفح.',
      'Observed Strict-Transport-Security header failed syntax validation (missing/invalid max-age or invalid directive formatting).',
      'فشلت ترويسة Strict-Transport-Security المرصودة في التحقق الصياغي (مثل نقص أو خطأ قيمة max-age).',
    ),
    impact: dual(
      'Malformed HSTS headers do not enforce HTTPS protection.',
      'الترويسة ذات الصياغة الخاطئة لا توفر أي حماية فعلية لإلزام HTTPS.',
      'Browsers discard malformed Strict-Transport-Security headers completely.',
      'تهمل المتصفحات ترويسة HSTS ذات الصياغة الخاطئة بالكامل.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed Strict-Transport-Security header contained invalid syntax or an unparseable max-age value.',
        'احتوت ترويسة Strict-Transport-Security على صياغة خاطئة أو قيمة max-age غير صالحة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Two layers (such as origin server + CDN) may emit conflicting or concatenated values.',
        'قد تصدر طبقتان (مثل الخادم وCDN) قيماً متداخلة أو غير متوافقة.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers for Strict-Transport-Security.',
      'ترويسة Strict-Transport-Security في استجابة HTTP.',
      'Inspect raw Strict-Transport-Security value on HTTPS responses for syntax errors or duplicate commas/headers.',
      'افحص القيمة الخام لترويسة Strict-Transport-Security بحثاً عن أخطاء الصياغة أو التكرار.',
    ),
    remediationSteps: hstsSteps('max-age=<integer>=31536000', 'max-age=31536000 بعدد صحيح صالح'),
    verificationSteps: hstsVerification(),
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [{ label: 'RFC 6797 HSTS', url: 'https://datatracker.ietf.org/doc/html/rfc6797' }],
  },
  {
    recommendationId: 'rec-sec-header-hsts-weak',
    ruleIds: ['SEC_HEADER_HSTS_WEAK'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The HSTS max-age duration is too short for strong long-term HTTPS enforcement.',
      'مدة max-age في ترويسة HSTS قصيرة ولا توفر إلزاماً طويل الأمد.',
      'Observed Strict-Transport-Security max-age is below recommended 1-year minimum (31536000 seconds).',
      'قيمة max-age المرصودة أقل من الحد الموصى به وهو عام واحد (31536000 ثانية).',
    ),
    impact: dual(
      'Browsers expire HSTS enforcement quickly for returning visitors.',
      'تنتهي صلاحية إلزام HTTPS في المتصفح بسرعة بالنسبة للزوار العائدين.',
      'Short max-age leaves larger windows between visits where HSTS pinning has expired.',
      'تترك المدة القصيرة فجوات أطول بين الزيارات تنتهي خلالها حماية HSTS.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed HSTS max-age was lower than 31536000 seconds.',
        'قيمة max-age المرصودة كانت أقل من 31536000 ثانية.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'A cautious rollout setting with a short test TTL may still be active.',
        'قد يكون إعداد الاختبار المبدئي بمدة قصيرة ما زال نشطاً.',
      ),
    ],
    locationGuidance: dual(
      'Strict-Transport-Security header configuration.',
      'إعداد ترويسة Strict-Transport-Security.',
      'Inspect max-age parameter in the HTTPS Strict-Transport-Security response header.',
      'افحص معامل max-age في ترويسة Strict-Transport-Security.',
    ),
    remediationSteps: hstsSteps('max-age=31536000', 'max-age=31536000'),
    verificationSteps: hstsVerification(),
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN Strict-Transport-Security',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-hsts-no-subdomains',
    ruleIds: ['SEC_HEADER_HSTS_NO_SUBDOMAINS'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers', 'cdn_cache'],
    causeConfidence: 'mixed',
    problem: dual(
      'The HSTS header does not include includeSubDomains.',
      'لا تتضمن ترويسة HSTS خيار includeSubDomains.',
      'Strict-Transport-Security omits `includeSubDomains`, leaving subdomains uncovered by the parent HSTS policy.',
      'تفتقد ترويسة Strict-Transport-Security إلى `includeSubDomains`، ما يترك النطاقات الفرعية خارج الإلزام.',
    ),
    impact: dual(
      'Requests to subdomains (and cookie transfers across subdomains) may not inherit HTTPS pinning.',
      'الطلبات إلى النطاقات الفرعية قد لا ترث سياسة فرض HTTPS تلقائياً.',
      'Subdomains remain vulnerable to HTTP downgrade if they omit independent HSTS headers.',
      'تظل النطاقات الفرعية عرضة للاتصال غير المشفر ما لم تفرض HSTS بشكل مستقل.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed Strict-Transport-Security header omitted includeSubDomains.',
        'ترويسة Strict-Transport-Security المرصودة لم تتضمن includeSubDomains.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'One or more subdomains (e.g. legacy portals or staging hosts) might intentionally not yet support HTTPS.',
        'قد يكون هناك نطاق فرعي قديم لا يدعم HTTPS بعد بشكل مقصود.',
      ),
    ],
    locationGuidance: dual(
      'Strict-Transport-Security response header.',
      'ترويسة Strict-Transport-Security في الاستجابة.',
      'Inspect Strict-Transport-Security directives on the primary HTTPS host.',
      'افحص توجيهات Strict-Transport-Security على النطاق الرئيسي.',
    ),
    remediationSteps: hstsSteps(
      'add ; includeSubDomains only after verifying all subdomains use HTTPS',
      'أضف ; includeSubDomains بعد التحقق من دعم HTTPS في كل النطاقات الفرعية',
    ),
    verificationSteps: hstsVerification(),
    limitations: [
      bi(
        'Only verify/add includeSubDomains if every subdomain is HTTPS-ready; otherwise subdomains could become unreachable.',
        'أضف includeSubDomains فقط إذا كانت كل النطاقات الفرعية تدعم HTTPS، وإلا قد يتعذر الوصول إليها.',
      ),
      SEC_PASSIVE_LIMITATION,
    ],
    references: [{ label: 'HSTS Preload Criteria', url: 'https://hstspreload.org/' }],
  },
  {
    recommendationId: 'rec-sec-header-hsts-preload-not-declared',
    ruleIds: ['SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers'],
    causeConfidence: 'mixed',
    problem: dual(
      'HSTS header meets duration and subdomain rules but does not declare the preload directive.',
      'تستوفي ترويسة HSTS المدة والنطاقات الفرعية لكنها لا تعلن تعليمة preload.',
      'Strict-Transport-Security sets max-age>=31536000 and includeSubDomains but omits the `preload` token.',
      'ترويسة Strict-Transport-Security تستوفي المدة وincludeSubDomains لكنها تفتقد تعليمة `preload`.',
    ),
    impact: dual(
      'Informational opportunity: without preload submission, a browser first-ever visit relies on redirect or prior HSTS cache.',
      'فرصة تحسين معلوماتية: بدون التحميل المسبق قد تعتمد الزيارة الأولى تماماً على إعادة التوجيه.',
      'Preload is optional and irreversible once submitted lightly; only enable when committed to permanent HTTPS across the entire domain tree.',
      'خيار preload اختياري ويصعب التراجع عنه بعد الإدراج؛ فعّله فقط عند الالتزام الدائم بـ HTTPS لكامل النطاق.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Strict-Transport-Security satisfies base strength checks but omits preload.',
        'تستوفي الترويسة قوة HSTS الأساسية دون إعلان preload.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Site maintainers may intentionally avoid HSTS preload due to permanent domain-wide HTTPS requirements.',
        'قد يتجنب مالكو الموقع preload عمداً لتفادي تعذر التراجع عبر النطاقات الفرعية.',
      ),
    ],
    locationGuidance: dual(
      'Strict-Transport-Security response header.',
      'ترويسة Strict-Transport-Security في الاستجابة.',
      'Inspect HSTS header directives.',
      'افحص توجيهات ترويسة HSTS.',
    ),
    remediationSteps: [
      step(
        1,
        'Decide whether every domain and subdomain will permanently stay on HTTPS; if yes, add preload and review hstspreload.org criteria.',
        'حدد أولاً التزام كل النطاقات الفرعية بـ HTTPS بشكل دائم، ثم أضف preload إن كان مناسباً.',
        'Evaluate long-term subdomain HTTPS commitments before adding `; preload` and submitting to browser preload lists.',
        'قيّم الالتزام الدائم بـ HTTPS لكل النطاقات الفرعية قبل إضافة `; preload`.',
      ),
    ],
    verificationSteps: hstsVerification(),
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [{ label: 'HSTS Preload List', url: 'https://hstspreload.org/' }],
  },
  {
    recommendationId: 'rec-sec-header-hsts-preload-ineligible',
    ruleIds: ['SEC_HEADER_HSTS_PRELOAD_INELIGIBLE'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The preload flag is declared in HSTS, but prerequisites (minimum 1-year max-age and includeSubDomains) are not met.',
      'تم إعلان preload في ترويسة HSTS دون استيفاء الشروط المطلوبة (عام كامل وincludeSubDomains).',
      'Observed Strict-Transport-Security specifies `preload` without `max-age >= 31536000` and `includeSubDomains`.',
      'تتضمن ترويسة Strict-Transport-Security كلمة `preload` بدون `max-age >= 31536000` و`includeSubDomains`.',
    ),
    impact: dual(
      'Preload list submissions will be rejected until all eligibility requirements are satisfied.',
      'لن يُقبل الموقع في قوائم التحميل المسبق للمتصفحات حتى تستوفي الترويسة كامل الشروط.',
      'Invalid preload declarations fail automated hstspreload validation.',
      'تفشل الترويسة غير المستوفية للشروط في قبول التحميل المسبق بالمتصفحات.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed preload token paired with insufficient max-age or missing includeSubDomains.',
        'تم رصد preload مع مدة max-age غير كافية أو غياب includeSubDomains.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'A manual header edit included preload prematurely before extending max-age or subdomains.',
        'قد يكون تم إضافة preload يدوياً قبل رفع max-age أو تضمين النطاقات الفرعية.',
      ),
    ],
    locationGuidance: dual(
      'Strict-Transport-Security header.',
      'ترويسة Strict-Transport-Security.',
      'Inspect HSTS header parameters.',
      'افحص معاملات ترويسة HSTS.',
    ),
    remediationSteps: hstsSteps(
      'ensure max-age=31536000; includeSubDomains; preload or remove preload until ready',
      'اضبط max-age=31536000; includeSubDomains; preload أو أزل preload مؤقتاً',
    ),
    verificationSteps: hstsVerification(),
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [{ label: 'HSTS Preload Eligibility', url: 'https://hstspreload.org/' }],
  },
  {
    recommendationId: 'rec-sec-header-hsts-preload-eligible',
    ruleIds: ['SEC_HEADER_HSTS_PRELOAD_ELIGIBLE'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Informational check: your HSTS header meets syntax prerequisites for HSTS preload submission.',
      'ملاحظة معلوماتية: ترويسة HSTS تستوفي الشروط الشكلية للترشيح في قائمة التحميل المسبق.',
      'Strict-Transport-Security declares max-age>=31536000, includeSubDomains, and preload tokens.',
      'تتضمن ترويسة Strict-Transport-Security القيم المطلوبة شكلياً للتحميل المسبق.',
    ),
    impact: dual(
      'No security defect detected in this header; confirm submission status externally only if browser preloading is desired.',
      'لا يوجد خلل أمني هنا؛ هذه ملاحظة لتوضيح جاهزية الترويسة إذا رغبتم بالتقديم الرسمي.',
      'Informational signal noting header-level syntax eligibility; actual browser preload inclusion requires external submission and HTTP->HTTPS redirect compliance.',
      'إشارة معلوماتية فقط؛ الإدراج الفعلي يتطلب التقديم الخارجي والتحقق من إعادة التوجيه.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed HSTS header contains max-age>=31536000, includeSubDomains, and preload.',
        'تتضمن ترويسة HSTS المرصودة max-age كافية مع includeSubDomains وpreload.',
      ),
    ],
    possibleCauseTemplates: [],
    locationGuidance: dual(
      'HTTPS response headers.',
      'ترويسات استجابة HTTPS.',
      'Observed in HTTPS Strict-Transport-Security header.',
      'مرصود في ترويسة Strict-Transport-Security.',
    ),
    remediationSteps: [
      step(
        1,
        'No urgent fix required; optionally check your domain status on hstspreload.org if you intend to maintain permanent HTTPS.',
        'لا يلزم إصلاح عاجل؛ يمكنك اختيارياً التحقق من حالة الإدراج عبر hstspreload.org.',
        'No code change needed unless you do not intend permanent subdomain HTTPS coverage (in which case remove `preload`).',
        'لا حاجة لتعديل الكود إلا إذا لم تلتزم بدعم HTTPS لكل النطاقات الفرعية مستقبلاً.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm your intended policy remains consistent across apex and subdomains.',
        'تأكد من ثبات السياسة عبر النطاق الرئيسي والنطاقات الفرعية.',
        'Verify consistent HSTS headers across apex and HTTP-to-HTTPS redirects.',
        'تأكد من اتساق الترويسة عبر النطاق الرئيسي والتحويلات من HTTP إلى HTTPS.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [{ label: 'HSTS Preload Status', url: 'https://hstspreload.org/' }],
  },

  // --- Other Security Headers (5) ---
  {
    recommendationId: 'rec-sec-header-permissions-policy-missing',
    ruleIds: ['SEC_HEADER_PERMISSIONS_POLICY_MISSING'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'server_headers', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Permissions-Policy header is missing from responses.',
      'ترويسة Permissions-Policy غير موجودة في الاستجابات.',
      'HTTP response omits Permissions-Policy, leaving browser hardware/feature permissions (camera, microphone, geolocation) unrestricted at policy level.',
      'تفتقد الاستجابة ترويسة Permissions-Policy لتقييد صلاحيات المتصفح الحساسة مثل الكاميرا والميكروفون والموقع الجغرافي.',
    ),
    impact: dual(
      'Embedded third-party scripts or iframes are not explicitly restricted from requesting sensitive browser APIs.',
      'لا توجد قيود صريحة تمنع السكربتات أو الإطارات المضمنة من طلب واجهات المتصفح الحساسة.',
      'Modest defense-in-depth reduction; especially relevant when embedding third-party widgets.',
      'نقص في طبقة الحماية الوقائية خصوصاً عند تضمين إضافات أو إطارات من أطراف خارجية.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Permissions-Policy header was not present in observed response headers.',
        'لم ترصد ترويسة Permissions-Policy في الاستجابة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Default web server or CDN configuration does not emit Permissions-Policy.',
        'إعدادات الخادم أو الـ CDN الافتراضية لا تضيف Permissions-Policy تلقائياً.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers.',
      'ترويسات استجابة HTTP.',
      'Configure Permissions-Policy on origin server or edge responses.',
      'أضف ترويسة Permissions-Policy في الخادم الأصلي أو طبقة الحافة.',
    ),
    remediationSteps: [
      step(
        1,
        'Disable unneeded browser features (e.g., camera, microphone, geolocation) using Permissions-Policy.',
        'عطّل ميزات المتصفح غير المستخدمة في موقعك عبر ترويسة Permissions-Policy.',
        'Emit `Permissions-Policy: camera=(), microphone=(), geolocation=()` (allowing specific trusted origins only where used).',
        'أضف ترويسة `Permissions-Policy` مع السماح فقط للميزات التي يستخدمها الموقع فعلياً.',
      ),
    ],
    codeExamples: [
      {
        title: bi('Permissions-Policy header example', 'مثال ترويسة Permissions-Policy'),
        language: 'http',
        scopeDisclaimer: bi(
          'Customize permissions if your pages intentionally use geolocation, camera, or payment APIs.',
          'عدّل الصلاحيات إذا كان موقعك يستخدم أياً من هذه الواجهات عمداً.',
        ),
        requiredEvidenceTag: 'http_header_evidence',
        snippet: 'Permissions-Policy: camera=(), microphone=(), geolocation=()',
      },
    ],
    verificationSteps: [
      step(
        1,
        'Confirm Permissions-Policy appears in response headers and interactive site features remain unaffected, then re-scan.',
        'تأكد من ظهور الترويسة في استجابات الشبكة وعدم تأثر الوظائف ثم أعد الفحص.',
        'Inspect response headers via DevTools or HTTP client and re-run audit.',
        'افحص ترويسات الاستجابة وأعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN Permissions-Policy',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-referrer-policy-missing',
    ruleIds: ['SEC_HEADER_REFERRER_POLICY_MISSING'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Referrer-Policy response header is missing.',
      'ترويسة Referrer-Policy مفقودة من الاستجابة.',
      'Observed response lacks Referrer-Policy, falling back to browser defaults when navigating to external destinations.',
      'تفتقد الاستجابة ترويسة Referrer-Policy، ما يترك التحكم في إرسال رابط المصدر للافتراضيات المتفاوتة للمتصفح.',
    ),
    impact: dual(
      'Full internal URL paths or query strings might leak to external sites when users follow outbound links.',
      'قد تتسرب مسارات الصفحات أو معلمات الاستعلام إلى مواقع خارجية عند النقر على الروابط الصادرة.',
      'Without an explicit policy like `strict-origin-when-cross-origin`, third-party origins may receive unintended URL path details.',
      'بدون سياسة صريحة قد تتلقى الأطراف الخارجية تفاصيل مسار الصفحة غير المرغوب بكشفها.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Referrer-Policy header absent in observed HTTP response.',
        'ترويسة Referrer-Policy غير موجودة في الاستجابة المرصودة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Server or framework configuration does not emit a default Referrer-Policy.',
        'إعدادات الخادم لا ترسل Referrer-Policy افتراضياً.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers.',
      'ترويسات استجابة HTTP.',
      'Add Referrer-Policy at web server, CDN, or meta tag level.',
      'أضف Referrer-Policy على مستوى الخادم أو طبقة CDN.',
    ),
    remediationSteps: [
      step(
        1,
        'Set Referrer-Policy to strict-origin-when-cross-origin (or no-referrer if maximum privacy is needed).',
        'اضبط Referrer-Policy إلى القيمة القياسية الآمنة strict-origin-when-cross-origin.',
        'Add `Referrer-Policy: strict-origin-when-cross-origin` to document HTTP responses.',
        'أضف ترويسة `Referrer-Policy: strict-origin-when-cross-origin` لاستجابات المستندات.',
      ),
    ],
    codeExamples: [
      {
        title: bi('Referrer-Policy header example', 'مثال ترويسة Referrer-Policy'),
        language: 'http',
        scopeDisclaimer: bi('Reference HTTP header configuration.', 'مثال مرجعي لترويسة HTTP.'),
        requiredEvidenceTag: 'http_header_evidence',
        snippet: 'Referrer-Policy: strict-origin-when-cross-origin',
      },
    ],
    verificationSteps: [
      step(
        1,
        'Inspect HTTP response headers for Referrer-Policy and re-scan.',
        'تحقق من ظهور Referrer-Policy في ترويسات الاستجابة ثم أعد الفحص.',
        'Verify `Referrer-Policy: strict-origin-when-cross-origin` in HTTP response headers and re-scan.',
        'تأكد من وجود السياسة في الترويسات وأعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN Referrer-Policy',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-referrer-policy-unsafe',
    ruleIds: ['SEC_HEADER_REFERRER_POLICY_UNSAFE'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Referrer-Policy uses a permissive setting (such as unsafe-url or no-referrer-when-downgrade).',
      'تستخدم ترويسة Referrer-Policy قيمة متساهلة (مثل unsafe-url أو no-referrer-when-downgrade).',
      'Observed Referrer-Policy header sends full URL paths and query parameters across origins (or even across HTTPS-to-HTTP transitions for unsafe-url).',
      'الترويسة الحالية ترسل كامل مسار الرابط ومعاملاته إلى النطاقات الخارجية.',
    ),
    impact: dual(
      'Sensitive URL tokens, customer parameters, or private admin paths could be exposed in Referer headers to third parties.',
      'قد تتسرب معاملات حساسة أو مسارات خاصة ضمن ترويسة Referer للوجهات الخارجية.',
      'External scripts, analytics, and outbound targets receive complete source URLs.',
      'تتلقى الموارد الخارجية والروابط الصادرة عنوان URL الكامل بما قد يحويه من معاملات.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed Referrer-Policy value permits sending full path/query across origins.',
        'القيمة المرصودة لـ Referrer-Policy تسمح بإرسال المسار الكامل عبر النطاقات.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Older server boilerplate or analytics configuration set an overly permissive policy.',
        'قد يكون إعداد خادم قديم أو مكون تحليلات فرض سياسة متساهلة.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers (or HTML <meta name="referrer">).',
      'ترويسات استجابة HTTP أو وسم meta referrer.',
      'Inspect observed Referrer-Policy value on affected URL.',
      'افحص قيمة Referrer-Policy المرصودة في الصفحة المتأثرة.',
    ),
    remediationSteps: [
      step(
        1,
        'Replace the permissive value with strict-origin-when-cross-origin or same-origin.',
        'استبدل القيمة المتساهلة بـ strict-origin-when-cross-origin أو same-origin.',
        'Update the header configuration to `Referrer-Policy: strict-origin-when-cross-origin` and verify no duplicate weaker meta tag overrides it.',
        'حدّث الترويسة إلى `strict-origin-when-cross-origin` وتأكد من عدم وجود وسم meta أضعف يطغى عليها.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm the updated Referrer-Policy value in HTTP responses and re-scan.',
        'تأكد من تحديث القيمة في ترويسات HTTP ثم أعد الفحص.',
        'Verify updated header and absence of permissive meta referrer tags.',
        'تحقق من الترويسة المحدثة وعدم وجود وسم meta متساهل ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN Referrer-Policy Values',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy#directives',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-x-content-type-options-missing',
    ruleIds: ['SEC_HEADER_X_CONTENT_TYPE_OPTIONS_MISSING'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'server_headers', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'X-Content-Type-Options: nosniff header is missing.',
      'ترويسة X-Content-Type-Options: nosniff مفقودة.',
      'Response omits `X-Content-Type-Options: nosniff`, allowing MIME-type sniffing in older/edge content scenarios.',
      'تفتقد الاستجابة إلى `X-Content-Type-Options: nosniff`، ما قد يسمح باستنتاج نوع الملف (MIME sniffing).',
    ),
    impact: dual(
      'Uploaded or non-script responses could be interpreted unexpectedly if served with ambiguous MIME types.',
      'قد يفسر المتصفح ملفات مرفوعة أو نصوصاً كأنواع قابلة للتنفيذ عند غياب الصرامة في نوع المحتوى.',
      'Reduces MIME-confusion protection on stylesheet/script/upload responses.',
      'يقلص الحماية ضد التباس أنواع الملفات في الاستجابات والملفات المرفوعة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'X-Content-Type-Options header was omitted in observed response.',
        'كانت ترويسة X-Content-Type-Options غائبة في الاستجابة المرصودة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Header hardening has not been added to web server / CDN response rules.',
        'لم تُضف ترويسة الحماية إلى إعدادات الخادم أو طبقة CDN.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers.',
      'ترويسات استجابة HTTP.',
      'Apply globally at web server or reverse proxy level.',
      'طبّقها عموماً على مستوى خادم الويب أو البروكسي العكسي.',
    ),
    remediationSteps: [
      step(
        1,
        'Add X-Content-Type-Options: nosniff across all site responses.',
        'أضف ترويسة X-Content-Type-Options: nosniff لجميع استجابات الموقع.',
        'Set `X-Content-Type-Options: nosniff` and ensure accurate `Content-Type` headers are served for JS/CSS assets.',
        'فعّل `X-Content-Type-Options: nosniff` مع التأكد من صحة `Content-Type` لملفات JS وCSS.',
      ),
    ],
    codeExamples: [
      {
        title: bi('X-Content-Type-Options header example', 'مثال ترويسة X-Content-Type-Options'),
        language: 'http',
        scopeDisclaimer: bi('Reference HTTP header configuration.', 'ترويسة HTTP مرجعية.'),
        requiredEvidenceTag: 'http_header_evidence',
        snippet: 'X-Content-Type-Options: nosniff',
      },
    ],
    verificationSteps: [
      step(
        1,
        'Confirm X-Content-Type-Options: nosniff in Network response headers and re-scan.',
        'تحقق من ظهور nosniff في الترويسات ثم أعد الفحص.',
        'Verify `X-Content-Type-Options: nosniff` across document and asset responses.',
        'تأكد من وجود الترويسة في استجابات الصفحات والأصول ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN X-Content-Type-Options',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-header-x-frame-options-missing',
    ruleIds: ['SEC_HEADER_X_FRAME_OPTIONS_MISSING'],
    category: 'security',
    supportedPlatforms: ['generic', 'wordpress', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'Clickjacking framing protection (X-Frame-Options or CSP frame-ancestors) is missing.',
      'حماية منع التضمين الاحتيالي (X-Frame-Options أو CSP frame-ancestors) مفقودة.',
      'Observed response sends neither X-Frame-Options nor a CSP `frame-ancestors` directive.',
      'الاستجابة لا ترسل X-Frame-Options ولا تعليمة `frame-ancestors` ضمن CSP.',
    ),
    impact: dual(
      'Other sites may embed your pages inside hidden iframes to trick users (clickjacking).',
      'يمكن لمواقع خارجية تضمين صفحاتك داخل إطار iframe مخفي وخداع المستخدمين (Clickjacking).',
      'Pages performing authenticated actions or form submissions remain frameable by arbitrary origins.',
      'تظل الصفحات والنماذج قابلة للتضمين داخل مواقع خارجية دون قيود.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Neither X-Frame-Options nor CSP frame-ancestors was present in HTTP headers.',
        'لم توجد ترويسة X-Frame-Options ولا تعليمة frame-ancestors.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Site may allow embeds intentionally on certain routes, or simply omit framing policy globally.',
        'قد يسمح الموقع بالتضمين في مسارات معينة أو لم يضبط السياسة بعد.',
      ),
    ],
    locationGuidance: dual(
      'HTTP response headers.',
      'ترويسات استجابة HTTP.',
      'Configure X-Frame-Options or CSP frame-ancestors on document responses.',
      'اضبط X-Frame-Options أو CSP frame-ancestors في استجابات الصفحات.',
    ),
    remediationSteps: [
      step(
        1,
        'Add X-Frame-Options: SAMEORIGIN (or CSP frame-ancestors) unless external sites legitimately embed your pages.',
        'أضف X-Frame-Options: SAMEORIGIN (أو CSP frame-ancestors) ما لم تكن هناك حاجة لتضمين صفحاتك خارجياً.',
        "Prefer `Content-Security-Policy: frame-ancestors 'self'` (plus `X-Frame-Options: SAMEORIGIN` for legacy compatibility).",
        "يُفضّل استخدام `Content-Security-Policy: frame-ancestors 'self'` مع `X-Frame-Options: SAMEORIGIN` للتوافق.",
      ),
    ],
    codeExamples: [
      {
        title: bi('Anti-clickjacking header example', 'مثال ترويسات الحماية من التضمين'),
        language: 'http',
        scopeDisclaimer: bi(
          'Use only trusted embed origins if external framing is intentionally required.',
          'أدرج النطاقات الموثوقة فقط إذا كان التضمين الخارجي مطلوباً.',
        ),
        requiredEvidenceTag: 'http_header_evidence',
        snippet: 'X-Frame-Options: SAMEORIGIN',
      },
    ],
    verificationSteps: [
      step(
        1,
        'Confirm SAMEORIGIN or CSP frame-ancestors in HTTP response headers and re-scan.',
        'تحقق من وجود الترويسة في استجابات HTTP ثم أعد الفحص.',
        'Verify header presence and test intentional internal previews still work.',
        'تأكد من الترويسة وسلامة المعاينات الداخلية ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'MDN X-Frame-Options',
        url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options',
      },
    ],
  },

  // --- TLS Certificates & Transport (5) ---
  {
    recommendationId: 'rec-sec-tls-cert-expired',
    ruleIds: ['SEC_TLS_CERT_EXPIRED'],
    category: 'security',
    supportedPlatforms: ['generic', 'cdn_cache', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The HTTPS TLS certificate has expired.',
      'انتهت صلاحية شهادة الأمان TLS الخاصة بالاتصال المشفر.',
      'Observed TLS handshake returned a certificate whose `valid_to` timestamp is in the past.',
      'أظهرت مصافحة TLS أن تاريخ انتهاء الشهادة (`valid_to`) قد مضى بالفعل.',
    ),
    impact: dual(
      'Visitors immediately see scary browser security warnings and cannot browse safely.',
      'سيواجه الزوار تحذيرات أمنية خطيرة في المتصفح ولن يتمكنوا من تصفح الموقع بأمان.',
      'HTTPS clients fail certificate chain validation and block automated/browser requests.',
      'تفشل المتصفحات وواجهات البرمجة في التحقق من الشهادة وتحجب الوصول الآمن.',
    ),
    confirmedCauseTemplates: [
      bi(
        'TLS handshake returned an expired X.509 certificate.',
        'أرجعت مصافحة TLS شهادة X.509 منتهية الصلاحية.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Automated certificate renewal (e.g. ACME/Certbot or CDN edge cert) may have failed or stalled.',
        'قد يكون التجديد التلقائي للشهادة قد تعطل أو فشل في التحقق.',
      ),
    ],
    locationGuidance: dual(
      'TLS termination endpoint (hosting panel, origin server, or CDN edge SSL).',
      'نقطة إنهاء شهادة SSL/TLS في الاستضافة أو طبقة الـ CDN.',
      'Inspect the active TLS certificate served by the audited hostname.',
      'افحص شهادة TLS النشطة على النطاق المفحوص.',
    ),
    remediationSteps: [
      step(
        1,
        'Renew and install a valid SSL/TLS certificate immediately through your host, CDN, or ACME client.',
        'جدّد شهادة SSL/TLS وفعلها فوراً عبر لوحة الاستضافة أو الـ CDN أو أداة التجديد.',
        'Issue and deploy a renewed valid X.509 certificate + full intermediate chain at the TLS termination endpoint.',
        'أصدر وفعّل شهادة X.509 مجددة مع سلسلة الشهادات الوسيطة الكاملة في نقطة إنهاء TLS.',
      ),
      step(
        2,
        'Verify automated renewal is enabled and does not fail on DNS/HTTP challenge checks.',
        'تأكد من عمل التجديد التلقائي مستقبلاً دون عوائق في تحدي DNS أو HTTP.',
        'Test ACME/CDN auto-renewal dry-run checks so expiry does not recur.',
        'تحقق من نجاح اختبار التجديد التلقائي (ACME/CDN) لمنع تكرار الانتهاء.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm the new certificate expiration date is in the future in browser lock icon/TLS check and re-scan.',
        'تحقق من تاريخ الصلاحية الجديد في المتصفح ثم أعد الفحص.',
        'Verify valid future `valid_to` and full chain trust via TLS inspection and re-scan.',
        'تحقق من صلاحية الشهادة وسلسلة الثقة عبر فحص TLS ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      { label: 'Let’s Encrypt Renewal Troubleshooting', url: 'https://letsencrypt.org/docs/' },
    ],
  },
  {
    recommendationId: 'rec-sec-tls-cert-expiring-soon',
    ruleIds: ['SEC_TLS_CERT_EXPIRING_SOON'],
    category: 'security',
    supportedPlatforms: ['generic', 'cdn_cache', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The HTTPS TLS certificate will expire soon.',
      'شهادة الأمان TLS قاربت على الانتهاء.',
      'Observed TLS certificate validity window is approaching expiry threshold.',
      'فترة صلاحية شهادة TLS المرصودة تقترب من تاريخ الانتهاء.',
    ),
    impact: dual(
      'If not renewed before expiry, users will soon encounter browser security errors.',
      'إذا لم تُجدَّد قبل الانتهاء، سيظهر للزوار خطأ أمان يمنع دخول الموقع.',
      'Pending expiry risks service outage once `valid_to` passes.',
      'اقتراب الانتهاء يهدد بتوقف الخدمة وظهور تحذيرات المتصفح فور تجاوز تاريخ الانتهاء.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed TLS certificate remaining validity days fell below warning threshold.',
        'الأيام المتبقية لصلاحية شهادة TLS أقل من حد التنبيه المعتمد.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Manual certificate renewal may be required, or auto-renew cron has not run yet.',
        'قد تحتاج الشهادة تجديداً يدوياً أو أن مهمة التجديد التلقائي لم تنجح بعد.',
      ),
    ],
    locationGuidance: dual(
      'Hosting SSL panel, origin server, or CDN SSL management.',
      'لوحة إدارة SSL في الاستضافة أو الـ CDN.',
      'Inspect TLS certificate validity dates on the audited hostname.',
      'راجع تواريخ صلاحية الشهادة على النطاق المفحوص.',
    ),
    remediationSteps: [
      step(
        1,
        'Check whether auto-renewal is scheduled or trigger renewal manually before expiry.',
        'تحقق من تفعيل التجديد التلقائي أو قم بتجديد الشهادة قبل انتهائها.',
        'Verify ACME/host/CDN renewal schedule and renew certificate proactively prior to expiration.',
        'تحقق من جدولة التجديد التلقائي وجدّد الشهادة استباقياً قبل انتهاء الصلاحية.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify extended expiration date on the active certificate and re-scan.',
        'تأكد من تمديد تاريخ الانتهاء للشهادة ثم أعد الفحص.',
        'Confirm updated certificate validity window and re-scan.',
        'تأكد من تحديث فترة صلاحية الشهادة وأعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      { label: 'SSL/TLS Best Practices', url: 'https://wiki.mozilla.org/Security/Server_Side_TLS' },
    ],
  },
  {
    recommendationId: 'rec-sec-tls-cert-invalid',
    ruleIds: ['SEC_TLS_CERT_INVALID'],
    category: 'security',
    supportedPlatforms: ['generic', 'cdn_cache', 'server_headers'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The HTTPS certificate failed trust validation (e.g. untrusted issuer, hostname mismatch, or incomplete chain).',
      'فشلت شهادة HTTPS في التحقق من الثقة (نطاق غير مطابق أو سلسلة شهادات ناقصة أو مصدر غير موثوق).',
      'TLS validation flagged certificate verification failure against the audited hostname or trust store.',
      'أظهر التحقق فشل مصادقة شهادة TLS للنطاق أو عدم اكتمال سلسلة الثقة.',
    ),
    impact: dual(
      'Visitors and API clients encounter security warnings or connection blocks.',
      'سيواجه الزوار وعملاء الشبكة تحذيرات أمنية أو فشل الاتصال.',
      'Modern browsers and HTTP clients reject untrusted/mismatched TLS chains.',
      'ترفض المتصفحات وواجهات البرمجة الاتصال عند عدم تطابق النطاق أو نقص سلسلة الشهادة.',
    ),
    confirmedCauseTemplates: [
      bi(
        'TLS handshake presented a certificate failing hostname, trust root, or intermediate chain verification.',
        'قدمت مصافحة TLS شهادة تفشل في مطابقة النطاق أو سلسلة الثقة الوسيطة.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Self-signed cert, missing intermediate CA bundle, or wrong SAN entry for www/apex domain.',
        'شهادة موقعة ذاتياً أو نقص حزمة الشهادات الوسيطة أو عدم شمول www/النطاق الرئيسي.',
      ),
    ],
    locationGuidance: dual(
      'TLS server configuration / CDN edge SSL.',
      'إعدادات TLS على الخادم أو الـ CDN.',
      'Inspect Subject Alternative Names (SANs) and intermediate chain served on port 443.',
      'افحص أسماء SAN وسلسلة الشهادات الوسيطة على المنفذ 443.',
    ),
    remediationSteps: [
      step(
        1,
        'Install a CA-signed certificate covering both apex and www hostnames and include full intermediate certificates.',
        'ثبّت شهادة موثوقة تشمل النطاق المطلوب (مع السلسلة الوسيطة الكاملة).',
        'Serve fullchain (leaf + intermediate CAs) covering all audited SAN hostnames from a trusted CA.',
        'وفّر سلسلة الشهادات الكاملة من جهة موثوقة تشمل كل أسماء النطاق المطلوبة.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm clean HTTPS load without certificate warnings and re-scan.',
        'تحقق من فتح الموقع عبر HTTPS بدون أي تحذير شهادة ثم أعد الفحص.',
        'Validate trusted chain completion without SNI/SAN mismatch and re-scan.',
        'تحقق من اكتمال السلسلة ومطابقة النطاق وأعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'Mozilla Server Side TLS',
        url: 'https://wiki.mozilla.org/Security/Server_Side_TLS',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-tls-deprecated-protocol',
    ruleIds: ['SEC_TLS_DEPRECATED_PROTOCOL'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'The server negotiated or accepts deprecated TLS 1.0 / TLS 1.1 protocols.',
      'يسمح الخادم ببروتوكولات TLS 1.0 أو TLS 1.1 القديمة المهجورة.',
      'Observed TLS handshake or protocol configuration permits TLSv1 or TLSv1.1 rather than enforcing TLS 1.2+.',
      'تقبل نقطة الاتصال بروتوكول TLS 1.0 أو 1.1 القديم بدلاً من الاقتصار على TLS 1.2 وما فوق.',
    ),
    impact: dual(
      'Older TLS versions have known cryptographic weaknesses and fail modern compliance baselines.',
      'تحتوي الإصدارات القديمة على ثغرات معروفة وتخالف معايير الأمان الحديثة.',
      'Deprecated protocol support enables downgrade risks for legacy clients.',
      'يُبقي دعم البروتوكولات القديمة سطحاً لمخاطر خفض مستوى التشفير.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed TLS negotiation used or accepted a deprecated protocol version (< TLS 1.2).',
        'أظهرت المعاينة قبول نسخة TLS قديمة أقدم من TLS 1.2.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Default legacy server/CDN TLS minimum version remains set to TLS 1.0/1.1.',
        'قد يكون الحد الأدنى لـ TLS في الخادم أو الـ CDN مضبوطاً على 1.0 أو 1.1.',
      ),
    ],
    locationGuidance: dual(
      'Web server SSL settings or CDN TLS Minimum Version setting.',
      'إعدادات TLS في الخادم أو لوحة الـ CDN.',
      'Inspect minimum TLS version setting on the TLS termination layer.',
      'راجع الحد الأدنى لإصدار TLS في طبقة إنهاء التشفير.',
    ),
    remediationSteps: [
      step(
        1,
        'Disable TLS 1.0 and TLS 1.1 and enforce TLS 1.2 and TLS 1.3 only.',
        'عطّل TLS 1.0 وTLS 1.1 وفعّل TLS 1.2 وTLS 1.3 فقط.',
        'Set minimum TLS protocol version to TLSv1.2 (with TLSv1.3 enabled) on origin/edge configuration.',
        'اضبط الحد الأدنى لبروتوكول TLS على TLSv1.2 مع تفعيل TLSv1.3.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Confirm only TLS 1.2 / TLS 1.3 connections succeed and re-scan.',
        'تحقق من قبول TLS 1.2 وTLS 1.3 فقط ثم أعد الفحص.',
        'Verify TLS 1.0/1.1 rejection and TLS 1.2+/1.3 handshake success.',
        'تأكد من رفض TLS 1.0/1.1 ونجاح TLS 1.2/1.3 ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      {
        label: 'RFC 8996 Deprecating TLS 1.0/1.1',
        url: 'https://datatracker.ietf.org/doc/html/rfc8996',
      },
    ],
  },
  {
    recommendationId: 'rec-sec-tls-weak-cipher',
    ruleIds: ['SEC_TLS_WEAK_CIPHER'],
    category: 'security',
    supportedPlatforms: ['generic', 'server_headers', 'cdn_cache'],
    causeConfidence: 'confirmed',
    problem: dual(
      'A weak TLS cipher suite was negotiated during connection inspection.',
      'تم التفاوض على حزمة تشفير TLS ضعيفة أثناء الفحص.',
      'Observed TLS handshake selected a weak cipher suite (such as RC4, 3DES, CBC-legacy, NULL, or export/weak key exchange).',
      'اختارت مصافحة TLS حزمة تشفير ضعيفة أو قديمة لا تلبي المعايير الحديثة.',
    ),
    impact: dual(
      'Weak ciphers degrade transport confidentiality against advanced network attackers.',
      'تضعف خوارزميات التشفير القديمة سرية الاتصال المنقول عبر الشبكة.',
      'Non-AEAD or weak cipher suites lack modern forward secrecy or authenticated encryption guarantees.',
      'تفتقد الحزم الضعيفة لضمانات التشفير المصادق الحديث (AEAD) والسرية الأمامية.',
    ),
    confirmedCauseTemplates: [
      bi(
        'Observed negotiated TLS cipher suite matched weak-cipher rules.',
        'طابقت حزمة التشفير المتفاوض عليها قواعد التشفير الضعيف.',
      ),
    ],
    possibleCauseTemplates: [
      bi(
        'Legacy cipher order preference on the origin server or load balancer.',
        'ترتيب حزم التشفير القديم على الخادم أو موزع الأحمال.',
      ),
    ],
    locationGuidance: dual(
      'Origin TLS cipher suite config or CDN TLS profile.',
      'إعدادات حزم التشفير في الخادم أو الـ CDN.',
      'Inspect TLS cipher list and server preference at TLS termination endpoint.',
      'افحص قائمة حزم التشفير في طبقة إنهاء TLS.',
    ),
    remediationSteps: [
      step(
        1,
        'Update your TLS profile to modern AEAD ciphers (ECDHE + AES-GCM / ChaCha20-Poly1305) and remove legacy ciphers.',
        'حدّث إعدادات التشفير إلى الحزم الحديثة (ECDHE مع AES-GCM أو ChaCha20-Poly1305) وأزل القديمة.',
        'Adopt Mozilla Intermediate cipher configuration on the TLS endpoint and re-test client compatibility.',
        'اعتمد قائمة حزم التشفير الموصى بها من Mozilla Intermediate واختبر التوافق.',
      ),
    ],
    verificationSteps: [
      step(
        1,
        'Verify strong AEAD cipher negotiation and re-scan.',
        'تحقق من استخدام حزمة تشفير حديثة قوية ثم أعد الفحص.',
        'Confirm AEAD + forward-secrecy cipher selection and re-run audit.',
        'تأكد من اختيار تشفير AEAD حديث ثم أعد الفحص.',
      ),
    ],
    limitations: [SEC_PASSIVE_LIMITATION],
    references: [
      { label: 'Mozilla SSL Configuration Generator', url: 'https://ssl-config.mozilla.org/' },
    ],
  },
];
