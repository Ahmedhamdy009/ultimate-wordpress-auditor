/**
 * Technical SEO & Static Performance Analyzer.
 * Evaluates declared SEO metadata, heading hierarchy, canonical tags, mobile viewport,
 * and lightweight static resource/performance metrics without browser rendering.
 */

import { normalizeCrawlUrl, type RuleExecutionRecord } from '@auditor/shared';
import { redactUrl } from '../../browser/redactor.js';
import { validateHreflangTag } from '../parser/hreflang-validator.js';
import type { CrawledPageResult } from '../crawler/types.js';
import type {
  AnalyzerContext,
  AnalyzerFinding,
  PageAnalysisResult,
  PageAnalyzer,
} from './types.js';

export interface SeoPerformanceData {
  readonly titleLength: number;
  readonly descriptionLength: number;
  readonly h1Count: number;
  readonly headingLevels: readonly number[];
  readonly hasCanonical: boolean;
  readonly canonicalUrl: string | null;
  readonly isNoindex: boolean;
  readonly hasViewport: boolean;
  readonly hasLang: boolean;
  readonly missingAltImagesCount: number;
  readonly responseDurationMs: number;
  readonly encodedBytes: number;
  readonly decompressedBytes: number;
  readonly scriptCount: number;
  readonly stylesheetCount: number;
  readonly imageCount: number;
  readonly missingDimensionsImageCount: number;
  readonly hreflangsCount?: number;
}

export class SeoPerformanceAnalyzer implements PageAnalyzer<SeoPerformanceData> {
  readonly id = 'seo-performance-analyzer';
  readonly name = 'Technical SEO & Performance Analyzer';

  analyzePage(
    page: CrawledPageResult,
    context: AnalyzerContext,
  ): PageAnalysisResult<SeoPerformanceData> {
    const findings: AnalyzerFinding[] = [];
    const ruleExecutions: RuleExecutionRecord[] = [];
    const url = redactUrl(page.requestedUrl);
    const parsedDoc = page.parsedDocument;

    // Default metric accumulators
    let titleLength = 0;
    let descriptionLength = 0;
    let h1Count = 0;
    const headingLevels: number[] = [];
    let hasCanonical = false;
    let canonicalUrl: string | null = null;
    let isNoindex = false;
    let hasViewport = false;
    let hasLang = false;
    let missingAltImagesCount = 0;
    let scriptCount = 0;
    let stylesheetCount = 0;
    let imageCount = 0;
    let missingDimensionsImageCount = 0;

    const responseDurationMs = page.durationMs;
    const encodedBytes = page.encodedBodyBytes;
    const decompressedBytes = page.decompressedBodyBytes;

    if (parsedDoc) {
      const meta = parsedDoc.metadata;

      // ==========================================
      // 1. Technical SEO Checks
      // ==========================================

      // A. Page Title
      if (!meta.title || meta.title.trim().length === 0) {
        findings.push({
          ruleId: 'SEO_TITLE_MISSING',
          category: 'technical-seo',
          title: 'Missing Page Title Element',
          description: `The page at ${url} does not have a <title> element. Page titles are critical for search indexability and browser tab identification.`,
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { title: null },
          remediation:
            'Add a descriptive, keyword-relevant <title> element between 10 and 65 characters.',
          references: ['https://developers.google.com/search/docs/appearance/title-link'],
        });
      } else {
        titleLength = meta.title.length;
        if (titleLength < 10) {
          findings.push({
            ruleId: 'SEO_TITLE_LENGTH',
            category: 'technical-seo',
            title: `Page Title Too Short (${titleLength} characters)`,
            description: `The page title ("${meta.title}") is shorter than 10 characters, which may provide insufficient context for search engines.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { title: meta.title, length: titleLength, recommendedMin: 10 },
            remediation:
              'Expand the title to at least 10–15 characters to accurately reflect page topic.',
            references: ['https://developers.google.com/search/docs/appearance/title-link'],
          });
        } else if (titleLength > 65) {
          findings.push({
            ruleId: 'SEO_TITLE_LENGTH',
            category: 'technical-seo',
            title: `Page Title Too Long (${titleLength} characters)`,
            description: `The page title ("${meta.title.slice(0, 60)}...") exceeds 65 characters and is likely to be truncated on search engine results pages.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { title: meta.title, length: titleLength, recommendedMax: 65 },
            remediation: 'Shorten the title to under 65 characters to avoid SERP truncation.',
            references: ['https://developers.google.com/search/docs/appearance/title-link'],
          });
        }
      }

      // B. Meta Description
      if (!meta.description || meta.description.trim().length === 0) {
        findings.push({
          ruleId: 'SEO_DESCRIPTION_MISSING',
          category: 'technical-seo',
          title: 'Missing Meta Description Tag',
          description: `The page at ${url} does not declare a <meta name="description"> tag. Search engines may generate suboptimal snippets from body text.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { description: null },
          remediation:
            'Add a compelling meta description between 50 and 160 characters summarizing the page content.',
          references: ['https://developers.google.com/search/docs/appearance/snippets'],
        });
      } else {
        descriptionLength = meta.description.length;
        if (descriptionLength < 50) {
          findings.push({
            ruleId: 'SEO_DESCRIPTION_LENGTH',
            category: 'technical-seo',
            title: `Meta Description Too Short (${descriptionLength} characters)`,
            description: `The meta description on ${url} is shorter than 50 characters.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: {
              description: meta.description,
              length: descriptionLength,
              recommendedMin: 50,
            },
            remediation:
              'Expand the meta description to at least 50–70 characters for richer SERP snippets.',
            references: ['https://developers.google.com/search/docs/appearance/snippets'],
          });
        } else if (descriptionLength > 160) {
          findings.push({
            ruleId: 'SEO_DESCRIPTION_LENGTH',
            category: 'technical-seo',
            title: `Meta Description Too Long (${descriptionLength} characters)`,
            description: `The meta description on ${url} exceeds 160 characters and may be truncated on search engine results.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: {
              description: meta.description,
              length: descriptionLength,
              recommendedMax: 160,
            },
            remediation:
              'Trim the meta description to under 160 characters to fit standard search snippet displays.',
            references: ['https://developers.google.com/search/docs/appearance/snippets'],
          });
        }
      }

      // C. H1 Headings Analysis
      const h1Headings = parsedDoc.headings.filter(h => h.level === 1);
      h1Count = h1Headings.length;
      if (h1Count === 0) {
        findings.push({
          ruleId: 'SEO_H1_MISSING',
          category: 'technical-seo',
          title: 'Missing Primary H1 Heading',
          description: `The page at ${url} does not declare an <h1> heading, which anchors the semantic hierarchy for search engines and accessibility screen readers.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { h1Count: 0 },
          remediation: 'Include exactly one clear, thematic <h1> heading per page.',
          references: [
            'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements',
          ],
        });
        ruleExecutions.push({ ruleId: 'SEO_H1_MISSING', outcome: 'WITH_FINDINGS' });
        ruleExecutions.push({ ruleId: 'SEO_H1_MULTIPLE', outcome: 'SKIPPED', skipReason: 'NO_MATCHING_ELEMENTS' });
      } else if (h1Count === 1) {
        ruleExecutions.push({ ruleId: 'SEO_H1_MISSING', outcome: 'CLEAN' });
        ruleExecutions.push({ ruleId: 'SEO_H1_MULTIPLE', outcome: 'CLEAN' });
      } else {
        findings.push({
          ruleId: 'SEO_H1_MULTIPLE',
          category: 'technical-seo',
          title: `Multiple H1 Headings Declared (${h1Count} found)`,
          description: `The page at ${url} contains ${h1Count} separate <h1> headings. While valid HTML5, a single primary H1 provides clearer semantic focus.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { h1Count, headings: h1Headings.map(h => h.text).slice(0, 5) },
          remediation:
            'Reserve <h1> for the page title/topic, and structure secondary sections under <h2> and <h3>.',
          references: [
            'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/Heading_Elements',
          ],
        });
        ruleExecutions.push({ ruleId: 'SEO_H1_MISSING', outcome: 'CLEAN' });
        ruleExecutions.push({ ruleId: 'SEO_H1_MULTIPLE', outcome: 'WITH_FINDINGS' });
      }

      // D. Heading Hierarchy Gaps
      for (let i = 0; i < parsedDoc.headings.length; i++) {
        const current = parsedDoc.headings[i];
        headingLevels.push(current.level);
        if (i > 0) {
          const previous = parsedDoc.headings[i - 1];
          // Gap occurs when stepping deeper by more than 1 level (e.g. H1 -> H3 without H2)
          if (current.level > previous.level + 1) {
            findings.push({
              ruleId: 'SEO_HEADING_HIERARCHY_GAP',
              category: 'technical-seo',
              title: `Heading Level Skipped (H${previous.level} to H${current.level})`,
              description: `Heading hierarchy jumped directly from <h${previous.level}> ("${previous.text.slice(0, 30)}") to <h${current.level}> ("${current.text.slice(0, 30)}") without an intermediate <h${previous.level + 1}>.`,
              severity: 'info',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: url,
              evidence: {
                previousLevel: previous.level,
                currentLevel: current.level,
                headingText: current.text,
              },
              remediation:
                'Structure headings sequentially without skipping levels to maintain accessible document outline.',
              references: ['https://www.w3.org/WAI/tutorials/page-structure/headings/'],
            });
            break; // Report one hierarchy gap sample per page to prevent spam
          }
        }
      }

      // E. Canonical URL Validation
      if (!meta.canonical) {
        findings.push({
          ruleId: 'SEO_CANONICAL_MISSING',
          category: 'technical-seo',
          title: 'Missing Canonical URL Link Tag',
          description: `The page at ${url} does not declare a <link rel="canonical"> element to consolidate indexing signals and duplicate URL parameters.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { canonical: null },
          remediation:
            'Add a self-referencing or authoritative <link rel="canonical" href="..."> tag to each indexable page.',
          references: [
            'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
          ],
        });
      } else {
        hasCanonical = true;
        canonicalUrl = meta.canonical;
        const normCanonical = normalizeCrawlUrl(meta.canonical, url);

        if (!normCanonical) {
          findings.push({
            ruleId: 'SEO_CANONICAL_INVALID',
            category: 'technical-seo',
            title: 'Invalid or Malformed Canonical URL',
            description: `The declared canonical URL ("${meta.canonical}") is invalid or uses an unpermitted protocol.`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { canonical: meta.canonical },
            remediation: 'Provide a valid, absolute HTTP/HTTPS URL in the canonical tag.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
            ],
          });
        } else if (normCanonical.origin !== context.authorizedOrigin) {
          findings.push({
            ruleId: 'SEO_CANONICAL_OUT_OF_SCOPE',
            category: 'technical-seo',
            title: 'Cross-Domain / Out-of-Scope Canonical URL Declared',
            description: `The canonical URL ("${normCanonical.href}") points to an external origin outside the audit scope (${context.authorizedOrigin}).`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { canonical: normCanonical.href, authorizedOrigin: context.authorizedOrigin },
            remediation:
              'Verify whether cross-domain canonicalization to an external host is intended.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
            ],
          });
        } else if (
          normCanonical.href !== url &&
          normCanonical.href.replace(/\/$/, '') !== url.replace(/\/$/, '')
        ) {
          findings.push({
            ruleId: 'SEO_CANONICAL_MISMATCH',
            category: 'technical-seo',
            title: 'Non-Self-Referencing Canonical URL (Points to Alternate URL)',
            description: `The page at ${url} specifies a canonical link pointing to a different internal URL ("${normCanonical.href}"). This indicates that this page is intended as a non-canonical alternate or duplicate alias of the target page.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: {
              declaredCanonical: normCanonical.href,
              requestedUrl: url,
              isCanonicalAlias: true,
            },
            remediation:
              'Verify whether this page is intended as a non-canonical alternate or alias. If this page has unique editorial content, update the canonical tag to point to itself.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
            ],
          });
        }
      }

      // F. Robots Meta Directive
      if (meta.robots) {
        const lowerRobots = meta.robots.toLowerCase();
        if (lowerRobots.includes('noindex')) {
          isNoindex = true;
          findings.push({
            ruleId: 'SEO_ROBOTS_NOINDEX',
            category: 'technical-seo',
            title: 'Robots Noindex Directive Present on Crawled Page',
            description: `The page at ${url} contains <meta name="robots" content="${meta.robots}">, instructing search engines not to index this page.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { robotsDirective: meta.robots },
            remediation:
              'If this page should appear in search results, remove the "noindex" directive.',
            references: [
              'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag',
            ],
          });
        }
      }

      // G. Viewport Tag (Mobile SEO)
      if (meta.viewport && meta.viewport.trim().length > 0) {
        hasViewport = true;
      } else {
        findings.push({
          ruleId: 'SEO_VIEWPORT_MISSING',
          category: 'technical-seo',
          title: 'Missing Mobile Viewport Meta Tag',
          description: `The page at ${url} does not declare a <meta name="viewport"> tag. Mobile browsers will render the page at desktop width, failing mobile-friendliness.`,
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { viewport: null },
          remediation:
            'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> to the document head.',
          references: ['https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag'],
        });
      }

      // H. HTML Lang Attribute
      if (meta.lang && meta.lang.trim().length > 0) {
        hasLang = true;
      } else {
        findings.push({
          ruleId: 'SEO_LANG_MISSING',
          category: 'technical-seo',
          title: 'Missing HTML Language Attribute',
          description: `The <html> tag on ${url} is missing the "lang" attribute, hindering screen reader pronunciation and international search engine targeting.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { lang: null },
          remediation:
            'Add a valid BCP 47 language tag to the html element (e.g. <html lang="en">).',
          references: ['https://www.w3.org/WAI/tutorials/page-structure/labels/#language'],
        });
      }

      // I. Open Graph & Twitter Cards
      const openGraph = meta.openGraph || {};
      const ogKeys = Object.keys(openGraph);
      const hasOgTitle = Boolean(openGraph['title']);
      const hasOgImage = Boolean(openGraph['image']);
      const hasOgDesc = Boolean(openGraph['description']);

      if (ogKeys.length > 0 && (!hasOgTitle || !hasOgImage || !hasOgDesc)) {
        findings.push({
          ruleId: 'SEO_OPENGRAPH_INCOMPLETE',
          category: 'technical-seo',
          title: 'Incomplete Open Graph Metadata',
          description: `The Open Graph metadata on ${url} is missing essential tags (title: ${hasOgTitle}, image: ${hasOgImage}, description: ${hasOgDesc}).`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: {
            missingTags: [
              !hasOgTitle && 'og:title',
              !hasOgImage && 'og:image',
              !hasOgDesc && 'og:description',
            ].filter(Boolean),
          },
          remediation:
            'Provide og:title, og:image, and og:description tags to optimize social sharing previews.',
          references: ['https://ogp.me/'],
        });
      }

      const twitterCard = meta.twitterCard || {};
      if (Object.keys(twitterCard).length === 0) {
        findings.push({
          ruleId: 'SEO_TWITTER_CARD_MISSING',
          category: 'technical-seo',
          title: 'Missing Twitter Card Metadata',
          description: `The page at ${url} does not define Twitter Card metadata tags (twitter:card, twitter:title).`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { twitterCardTags: 0 },
          remediation:
            'Include <meta name="twitter:card" content="summary_large_image"> for enhanced social rich snippets.',
          references: [
            'https://developer.x.com/en/docs/x-for-websites/cards/overview/abouts-cards',
          ],
        });
      }

      // J. Image Alt Attributes
      imageCount = parsedDoc.images.length;
      for (const img of parsedDoc.images) {
        if (img.alt === null || img.alt.trim().length === 0) {
          missingAltImagesCount++;
        }
        if (!img.width && !img.height) {
          missingDimensionsImageCount++;
        }
      }

      if (missingAltImagesCount > 0) {
        findings.push({
          ruleId: 'SEO_IMG_ALT_MISSING',
          category: 'technical-seo',
          title: `Images Missing Alt Text (${missingAltImagesCount} images)`,
          description: `${missingAltImagesCount} of ${imageCount} <img> elements on ${url} lack descriptive "alt" attributes.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { missingAltCount: missingAltImagesCount, totalImages: imageCount },
          remediation:
            'Add concise, descriptive alt text to informative images and alt="" to purely decorative images.',
          references: ['https://www.w3.org/WAI/tutorials/images/decision-tree/'],
        });
      }

      // K. Hreflang Multilingual Annotations
      const pageHreflangs = parsedDoc.hreflangs || [];
      if (pageHreflangs.length > 0) {
        let hasSelfReference = false;
        const hreflangsByTag = new Map<string, (typeof pageHreflangs)[number][]>();

        for (const item of pageHreflangs) {
          if (item.isSelfReference) {
            hasSelfReference = true;
          }

          // 1. Language tag BCP 47 syntax validation
          const valResult = validateHreflangTag(item.hreflang);
          if (!valResult.valid) {
            findings.push({
              ruleId: 'SEO_HREFLANG_INVALID_TAG',
              category: 'technical-seo',
              title: `Invalid hreflang Language Tag ("${item.hreflang}")`,
              description: `The page declares a link rel="alternate" with an invalid or non-standard language tag ("${item.hreflang}"). Hreflang values must conform to BCP 47 standards (e.g., "en", "ar-EG", "zh-Hant") or "x-default". Reason: ${valResult.reason}.`,
              severity: 'medium',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: redactUrl(url),
              evidence: {
                rawHreflang: item.hreflang,
                rawHref: redactUrl(item.rawHref),
                resolvedUrl: item.resolvedUrl ? redactUrl(item.resolvedUrl) : null,
                reason: valResult.reason,
              },
              remediation:
                'Use a standard BCP 47 language code (such as "en-US" instead of "en_US") or "x-default".',
              references: [
                'https://developers.google.com/search/docs/specialty/international/localized-versions',
              ],
            });
          }

          // 2. x-default destination URL validity
          if (item.normalizedHreflang === 'x-default') {
            if (!item.resolvedUrl || item.rawHref.trim() === '' || item.rawHref.trim() === '#') {
              findings.push({
                ruleId: 'SEO_HREFLANG_X_DEFAULT_INVALID',
                category: 'technical-seo',
                title: 'Invalid Destination URL for x-default hreflang',
                description:
                  'The page declares an "x-default" hreflang fallback annotation, but its destination URL is empty, missing, or unresolvable.',
                severity: 'medium',
                confidence: 'confirmed',
                status: 'confirmed',
                targetUrl: redactUrl(url),
                evidence: {
                  hreflang: 'x-default',
                  rawHref: redactUrl(item.rawHref),
                },
                remediation:
                  'Provide a valid absolute or resolvable URL for the x-default alternate version.',
                references: [
                  'https://developers.google.com/search/docs/specialty/international/localized-versions#xdefault',
                ],
              });
            }
          }

          const group = hreflangsByTag.get(item.normalizedHreflang) || [];
          group.push(item);
          hreflangsByTag.set(item.normalizedHreflang, group);
        }

        // 3. Duplicate and Conflicting declarations for the same language
        for (const [normTag, items] of hreflangsByTag.entries()) {
          if (items.length >= 2) {
            const distinctUrls = Array.from(new Set(items.map(i => i.resolvedUrl || i.rawHref)));
            if (distinctUrls.length > 1) {
              findings.push({
                ruleId: 'SEO_HREFLANG_CONFLICTING_URLS',
                category: 'technical-seo',
                title: `Conflicting Destination URLs for hreflang ("${normTag}")`,
                description: `The page declares ${items.length} alternate links for the same language ("${normTag}") pointing to different destinations. Search engines cannot determine which URL is authoritative for this language.`,
                severity: 'medium',
                confidence: 'confirmed',
                status: 'confirmed',
                targetUrl: redactUrl(url),
                evidence: {
                  hreflang: normTag,
                  conflictingUrls: distinctUrls.map(u => redactUrl(u)),
                },
                remediation:
                  'Ensure each language or region tag is mapped to exactly one unique destination URL.',
                references: [
                  'https://developers.google.com/search/docs/specialty/international/localized-versions',
                ],
              });
            } else {
              findings.push({
                ruleId: 'SEO_HREFLANG_DUPLICATE_DECLARATION',
                category: 'technical-seo',
                title: `Duplicate hreflang Declaration ("${normTag}")`,
                description: `The page declares identical link rel="alternate" hreflang="${normTag}" multiple times pointing to the same destination.`,
                severity: 'low',
                confidence: 'confirmed',
                status: 'confirmed',
                targetUrl: redactUrl(url),
                evidence: {
                  hreflang: normTag,
                  destinationUrl: redactUrl(distinctUrls[0]),
                  count: items.length,
                },
                remediation:
                  'Remove duplicate alternate link declarations to keep page markup clean.',
                references: [
                  'https://developers.google.com/search/docs/specialty/international/localized-versions',
                ],
              });
            }
          }
        }

        // 4. Missing self-reference recommendation
        if (!hasSelfReference) {
          findings.push({
            ruleId: 'SEO_HREFLANG_MISSING_SELF_REFERENCE',
            category: 'technical-seo',
            title: 'Missing Self-Referencing hreflang Annotation',
            description: `The page declares alternate hreflang links for other languages/regions but does not include a self-referencing hreflang link for its own URL. Google and BCP 47 guidelines recommend that alternate sets always include the current page URL.`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: redactUrl(url),
            evidence: {
              pageUrl: redactUrl(url),
              hreflangsDeclared: pageHreflangs.map(h => h.normalizedHreflang),
            },
            remediation:
              'Add a <link rel="alternate" hreflang="..." href="..."> pointing to the current page URL with its matching language code.',
            references: [
              'https://developers.google.com/search/docs/specialty/international/localized-versions',
            ],
          });
        }
      }

      // Resource counts
      const docResources = parsedDoc.resources || [];
      scriptCount = docResources.filter(r => r.type === 'script').length;
      stylesheetCount = docResources.filter(r => r.type === 'stylesheet').length;

      // ==========================================
      // 2. Static Performance Indicators
      // ==========================================
      if (responseDurationMs > 1000) {
        findings.push({
          ruleId: 'PERF_SLOW_SERVER_RESPONSE',
          category: 'static-performance',
          title: `Slow HTTP Response Duration (${responseDurationMs}ms)`,
          description: `The initial HTTP request-response cycle on ${url} took ${responseDurationMs}ms (threshold: 1000ms). Note: This measures total HTTP transfer duration for the initial HTML request; it is NOT Time to First Byte (TTFB) and does NOT reflect client-rendered Core Web Vitals (LCP, INP, CLS).`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { durationMs: responseDurationMs, thresholdMs: 1000 },
          remediation:
            'Optimize database queries, enable server-side page caching, or utilize a reverse proxy/CDN.',
          references: ['https://web.dev/articles/speed-tools-overview'],
        });
      }

      if (decompressedBytes > 1024 * 1024 || encodedBytes > 500 * 1024) {
        findings.push({
          ruleId: 'PERF_LARGE_HTML_DOCUMENT',
          category: 'static-performance',
          title: `Large HTML Document Size (${Math.round(decompressedBytes / 1024)} KB decompressed)`,
          description: `The HTML document payload for ${url} is unusually large (${Math.round(decompressedBytes / 1024)} KB decompressed, ${Math.round(encodedBytes / 1024)} KB encoded).`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { decompressedBytes, encodedBytes },
          remediation:
            'Reduce DOM depth, paginate large lists, and avoid inline base64 assets or large embedded scripts.',
          references: ['https://web.dev/articles/dom-size-and-interactive'],
        });
      }

      if (scriptCount > 25) {
        findings.push({
          ruleId: 'PERF_EXCESSIVE_SCRIPTS',
          category: 'static-performance',
          title: `High Number of External Scripts (${scriptCount} scripts)`,
          description: `The page declares ${scriptCount} external script tags, which can introduce parse blocking and dependency chaining.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { scriptCount, threshold: 25 },
          remediation: 'Bundle, defer, or asynchronously load scripts to avoid render blocking.',
          references: ['https://web.dev/articles/render-blocking-resources'],
        });
      }

      if (stylesheetCount > 15) {
        findings.push({
          ruleId: 'PERF_EXCESSIVE_STYLESHEETS',
          category: 'static-performance',
          title: `High Number of External Stylesheets (${stylesheetCount} CSS files)`,
          description: `The page links ${stylesheetCount} separate stylesheet resources.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { stylesheetCount, threshold: 15 },
          remediation: 'Combine CSS files where possible and inline critical CSS.',
          references: ['https://web.dev/articles/defer-non-critical-css'],
        });
      }

      if (missingDimensionsImageCount > 0) {
        findings.push({
          ruleId: 'PERF_IMG_DIMENSIONS_MISSING',
          category: 'static-performance',
          title: `Images Missing Width and Height Attributes (${missingDimensionsImageCount} images)`,
          description: `${missingDimensionsImageCount} images lack explicit HTML width and height attributes in static markup. While modern browsers utilize dimensions to preserve aspect ratio during layout, this is a static markup observation, not proof of client-rendered Cumulative Layout Shift (CLS).`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: {
            missingDimensionsCount: missingDimensionsImageCount,
            totalImages: imageCount,
          },
          remediation:
            'Declare explicit width and height attributes or CSS aspect-ratio on image elements.',
          references: ['https://web.dev/articles/optimize-cls#images-without-dimensions'],
        });
      }
    } else {
      ruleExecutions.push({ ruleId: 'SEO_H1_MISSING', outcome: 'SKIPPED', skipReason: 'NON_HTML_DOCUMENT' });
      ruleExecutions.push({ ruleId: 'SEO_H1_MULTIPLE', outcome: 'SKIPPED', skipReason: 'NON_HTML_DOCUMENT' });
    }

    const data: SeoPerformanceData = {
      titleLength,
      descriptionLength,
      h1Count,
      headingLevels,
      hasCanonical,
      canonicalUrl,
      isNoindex,
      hasViewport,
      hasLang,
      missingAltImagesCount,
      responseDurationMs,
      encodedBytes,
      decompressedBytes,
      scriptCount,
      stylesheetCount,
      imageCount,
      missingDimensionsImageCount,
      hreflangsCount: parsedDoc?.hreflangs?.length ?? 0,
    };

    return {
      findings,
      data,
      ruleExecutions,
    };
  }
}
