/**
 * Quality & Content Analyzer.
 * Deterministically evaluates content density, empty links/buttons, DOM bloat,
 * thin text thresholds, and repetitive structure without subjective or AI-based assertions.
 */

import type { CrawledPageResult } from '../crawler/types.js';
import type {
  AnalyzerContext,
  AnalyzerFinding,
  PageAnalysisResult,
  PageAnalyzer,
} from './types.js';

export type PageContentType =
  | 'article'
  | 'blog_post'
  | 'project_detail'
  | 'landing_page'
  | 'taxonomy_archive'
  | 'category_listing'
  | 'technology_listing'
  | 'pagination_page'
  | 'archive_listing'
  | 'utility_page'
  | 'uncertain';

export interface PageClassificationResult {
  readonly pageType: PageContentType;
  readonly isArchiveOrListing: boolean;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly structuralClues: readonly string[];
}

export interface QualityContentData {
  readonly wordCount: number;
  readonly totalNodes: number;
  readonly emptyLinksCount: number;
  readonly emptyButtonsCount: number;
  readonly linkDensityPercent: number;
  readonly repeatedHeadingsCount: number;
  readonly pageType?: PageContentType;
  readonly isArchiveOrListing?: boolean;
}

/**
 * Classifies page content type using combined structural and URL evidence.
 * Conservative classification: if evidence is insufficient, marks pageType as 'uncertain'.
 */
export function classifyPageContentType(page: CrawledPageResult): PageClassificationResult {
  const url = page.requestedUrl;
  const parsedDoc = page.parsedDocument;
  const clues: string[] = [];

  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url.toLowerCase();
  }

  // 1. Pagination Check
  if (
    /\/page\/\d+/i.test(pathname) ||
    /[?&](?:paged|page)=\d+/i.test(url) ||
    parsedDoc?.links.some(l => l.rel === 'next' || l.rel === 'prev')
  ) {
    clues.push('Pagination pattern in URL or link relations');
    return {
      pageType: 'pagination_page',
      isArchiveOrListing: true,
      confidence: 'high',
      structuralClues: clues,
    };
  }

  // 2. Landing / Homepages
  if (
    pathname === '/' ||
    pathname === '/ar/' ||
    pathname === '/en/' ||
    pathname === '/ar' ||
    pathname === '/en'
  ) {
    clues.push('Root or primary language homepage route');
    return {
      pageType: 'landing_page',
      isArchiveOrListing: false,
      confidence: 'high',
      structuralClues: clues,
    };
  }

  // 3. Taxonomy Archive Checks (Categories, Technologies, Tags)
  const isCategoryUrl = /\/(?:project-)?category\//i.test(pathname);
  const isTechnologyUrl = /\/(?:project-)?technology\//i.test(pathname);
  const isTagUrl = /\/(?:project-)?tag\//i.test(pathname);

  if (isCategoryUrl || isTechnologyUrl || isTagUrl) {
    const isOgWebsite = parsedDoc?.metadata.openGraph?.['og:type'] === 'website';
    const linkDensity = parsedDoc?.metrics?.totalNodes ? true : false;
    const hasHeadings = (parsedDoc?.headings.length ?? 0) >= 1;

    if (isTechnologyUrl && (isOgWebsite || hasHeadings || linkDensity)) {
      clues.push('Technology taxonomy URL with listing structure');
      return {
        pageType: 'technology_listing',
        isArchiveOrListing: true,
        confidence: 'high',
        structuralClues: clues,
      };
    }

    if (isCategoryUrl && (isOgWebsite || hasHeadings || linkDensity)) {
      clues.push('Category taxonomy URL with listing structure');
      return {
        pageType: 'category_listing',
        isArchiveOrListing: true,
        confidence: 'high',
        structuralClues: clues,
      };
    }

    if (isTagUrl && (isOgWebsite || hasHeadings || linkDensity)) {
      clues.push('Tag taxonomy URL with listing structure');
      return {
        pageType: 'taxonomy_archive',
        isArchiveOrListing: true,
        confidence: 'high',
        structuralClues: clues,
      };
    }
  }

  // 4. Archive Index Routes (/blog/, /blog-ar/, /project/, /projects/)
  if (/^\/(?:ar\/)?(?:blog|blog-ar|projects|projects-ar|project)\/?$/i.test(pathname)) {
    clues.push('Top-level archive index path');
    return {
      pageType: 'archive_listing',
      isArchiveOrListing: true,
      confidence: 'high',
      structuralClues: clues,
    };
  }

  // 5. Single Project Case Studies
  if (/^\/(?:ar\/)?project\/[^/]+\/?$/i.test(pathname)) {
    clues.push('Single project detail slug path');
    return {
      pageType: 'project_detail',
      isArchiveOrListing: false,
      confidence: 'high',
      structuralClues: clues,
    };
  }

  // 6. Single Blog Posts
  const isOgArticle = parsedDoc?.metadata.openGraph?.['og:type'] === 'article';
  const isBlogPath = /^\/(?:ar\/)?blog\/[^/]+\/?$/i.test(pathname);
  if (isOgArticle || isBlogPath) {
    clues.push(isOgArticle ? 'og:type=article metadata' : 'Blog post slug path');
    return {
      pageType: 'blog_post',
      isArchiveOrListing: false,
      confidence: 'high',
      structuralClues: clues,
    };
  }

  // 7. General Article Check
  if (isOgArticle) {
    clues.push('Explicit article OpenGraph declaration');
    return {
      pageType: 'article',
      isArchiveOrListing: false,
      confidence: 'medium',
      structuralClues: clues,
    };
  }

  // 8. Conservative Default: Uncertain
  clues.push('No conclusive structural or taxonomy archive pattern detected');
  return {
    pageType: 'uncertain',
    isArchiveOrListing: false,
    confidence: 'low',
    structuralClues: clues,
  };
}

export class QualityContentAnalyzer implements PageAnalyzer<QualityContentData> {
  readonly id = 'quality-content-analyzer';
  readonly name = 'Quality & Content Analyzer';

  // Configurable transparent thresholds
  readonly thinTextWordThreshold = 100;
  readonly domBloatThreshold = 1500;
  readonly highLinkDensityThresholdPercent = 70;

  analyzePage(
    page: CrawledPageResult,
    _context: AnalyzerContext,
  ): PageAnalysisResult<QualityContentData> {
    const findings: AnalyzerFinding[] = [];
    const url = page.requestedUrl;
    const parsedDoc = page.parsedDocument;
    const classification = classifyPageContentType(page);

    let wordCount = 0;
    let totalNodes = 0;
    let emptyLinksCount = 0;
    let emptyButtonsCount = 0;
    let linkDensityPercent = 0;
    let repeatedHeadingsCount = 0;

    if (parsedDoc) {
      totalNodes = parsedDoc.metrics.totalNodes;

      // Extract body words from headings and links
      let totalText = '';
      let linkText = '';

      for (const heading of parsedDoc.headings) {
        totalText += ' ' + heading.text;
      }

      for (const link of parsedDoc.links) {
        totalText += ' ' + link.text;
        linkText += ' ' + link.text;

        // Check for empty anchor links
        if (
          link.originalValue &&
          !link.originalValue.startsWith('#') &&
          (!link.text || link.text.trim().length === 0)
        ) {
          emptyLinksCount++;
        }
      }

      // Check for empty buttons
      for (const form of parsedDoc.forms) {
        for (const button of form.buttons) {
          if (!button.text || button.text.trim().length === 0) {
            emptyButtonsCount++;
          }
        }
      }

      // Calculate word count using full visible text when extracted by the HTML parser,
      // falling back cleanly to headings + links if mocked without visibleWordCount.
      const fallbackWordCount = totalText
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 0).length;

      const linkWords = linkText
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 0).length;

      wordCount =
        typeof parsedDoc.visibleWordCount === 'number'
          ? Math.max(parsedDoc.visibleWordCount, linkWords, fallbackWordCount)
          : fallbackWordCount;

      if (wordCount > 0) {
        linkDensityPercent = Math.round((linkWords / wordCount) * 100);
      }

      // ==========================================
      // 1. Content Quantity & Word Count
      // ==========================================
      if (wordCount === 0) {
        findings.push({
          ruleId: 'CONTENT_EMPTY_PAGE',
          category: 'content-quality',
          title: 'Empty Page Content (0 words detected)',
          description: `The page at ${url} contains no readable textual content or headings. Empty pages offer poor user experience and are unlikely to rank in search results.`,
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { wordCount: 0, pageType: classification.pageType },
          remediation:
            'Provide descriptive, informative page copy or remove/redirect the empty document.',
          references: [
            'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
          ],
        });
      } else if (wordCount < this.thinTextWordThreshold) {
        if (classification.isArchiveOrListing) {
          // Legitimate archive or taxonomy listing page whose function is to display a card/link grid.
          // Thin editorial text is expected behavior, not a quality defect. Suppress false positive.
        } else if (classification.pageType === 'uncertain') {
          // If page type cannot be determined reliably, classify it as uncertain rather than silently suppressing.
          findings.push({
            ruleId: 'CONTENT_THIN_TEXT',
            category: 'content-quality',
            title: `Thin Text Content (${wordCount} words detected, Type: Uncertain)`,
            description: `The page contains only ${wordCount} words of text content (threshold: ${this.thinTextWordThreshold} words). Page type could not be definitively established from structural heuristics. Word count observation retained for manual review.`,
            severity: 'low',
            confidence: 'potential',
            status: 'potential',
            targetUrl: url,
            evidence: {
              wordCount,
              threshold: this.thinTextWordThreshold,
              pageType: 'uncertain',
              classificationNotice:
                'Page content type could not be definitively determined. Verify whether this page is intended as a concise utility or editorial article.',
            },
            remediation:
              'If this page is an editorial document meant for search indexation, expand textual copy. If it is an application interface, listing, or utility page, this observation can be safely acknowledged.',
            references: [
              'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
            ],
          });
        } else {
          // Substantive page (article, blog post, project detail, or landing page) with thin text
          findings.push({
            ruleId: 'CONTENT_THIN_TEXT',
            category: 'content-quality',
            title: `Thin Text Content (${wordCount} words detected)`,
            description: `The ${classification.pageType.replace('_', ' ')} page contains only ${wordCount} words of text content (threshold: ${this.thinTextWordThreshold} words). Substantive content pages should provide helpful, detailed copy for visitors.`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: {
              wordCount,
              threshold: this.thinTextWordThreshold,
              pageType: classification.pageType,
              structuralClues: classification.structuralClues,
            },
            remediation:
              'Expand textual copy with detailed, unique explanations and media context.',
            references: [
              'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
            ],
          });
        }
      }

      // ==========================================
      // 2. DOM Node Bloat
      // ==========================================
      if (totalNodes > this.domBloatThreshold) {
        findings.push({
          ruleId: 'CONTENT_DOM_BLOAT',
          category: 'dom-quality',
          title: `Excessive DOM Node Count (${totalNodes} nodes)`,
          description: `The DOM tree on ${url} contains ${totalNodes} nodes, exceeding the recommended limit of ${this.domBloatThreshold} nodes. Large DOMs increase memory overhead and reflow costs.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { totalNodes, threshold: this.domBloatThreshold },
          remediation:
            'Simplify page layout, paginate content, or remove redundant wrapper elements.',
          references: ['https://web.dev/articles/dom-size-and-interactive'],
        });
      }

      // ==========================================
      // 3. High Link Density
      // ==========================================
      if (linkDensityPercent >= this.highLinkDensityThresholdPercent && wordCount > 30) {
        findings.push({
          ruleId: 'CONTENT_HIGH_LINK_DENSITY',
          category: 'content-structure',
          title: `High Link-to-Text Density (${linkDensityPercent}%)`,
          description: `On ${url}, ${linkDensityPercent}% of words reside within anchor links (threshold: ${this.highLinkDensityThresholdPercent}%). High link density may indicate a navigation page or directory rather than editorial content.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: {
            linkDensityPercent,
            linkWords,
            wordCount,
            threshold: this.highLinkDensityThresholdPercent,
          },
          remediation: 'Add introductory and descriptive editorial text around link lists.',
        });
      }

      // ==========================================
      // 4. Empty Links and Buttons
      // ==========================================
      if (emptyLinksCount > 0) {
        findings.push({
          ruleId: 'CONTENT_EMPTY_LINK',
          category: 'accessibility',
          title: `Empty Anchor Links (${emptyLinksCount} found)`,
          description: `${emptyLinksCount} anchor <a> elements on ${url} contain href destinations but no discernible text content or accessible labels.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { emptyLinksCount },
          remediation:
            'Add descriptive link text or an aria-label attribute to empty anchor elements.',
          references: ['https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html'],
        });
      }

      if (emptyButtonsCount > 0) {
        findings.push({
          ruleId: 'CONTENT_EMPTY_BUTTON',
          category: 'accessibility',
          title: `Empty Form Buttons (${emptyButtonsCount} found)`,
          description: `${emptyButtonsCount} button elements have no readable text or label.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { emptyButtonsCount },
          remediation:
            'Provide button label text or aria-label for accessibility assistive technologies.',
          references: ['https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html'],
        });
      }

      // ==========================================
      // 5. Repetitive Heading Patterns
      // ==========================================
      const headingTextCounts = new Map<string, number>();
      for (const heading of parsedDoc.headings) {
        const text = heading.text.trim().toLowerCase();
        if (text.length > 3) {
          headingTextCounts.set(text, (headingTextCounts.get(text) || 0) + 1);
        }
      }

      const duplicateHeadings: string[] = [];
      for (const [text, count] of headingTextCounts.entries()) {
        if (count >= 3) {
          duplicateHeadings.push(`"${text}" (repeated ${count}x)`);
        }
      }

      repeatedHeadingsCount = duplicateHeadings.length;
      if (repeatedHeadingsCount > 0) {
        findings.push({
          ruleId: 'CONTENT_REPEATED_HEADINGS',
          category: 'content-structure',
          title: `Repetitive Headings Detected (${repeatedHeadingsCount} heading patterns)`,
          description: `Identical heading text is repeated 3 or more times on ${url}: ${duplicateHeadings.slice(0, 3).join(', ')}.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { duplicateHeadings: duplicateHeadings.slice(0, 5) },
          remediation:
            'Differentiate section headings so users and search engines can distinguish separate content blocks.',
        });
      }
    }

    const data: QualityContentData = {
      wordCount,
      totalNodes,
      emptyLinksCount,
      emptyButtonsCount,
      linkDensityPercent,
      repeatedHeadingsCount,
      pageType: classification.pageType,
      isArchiveOrListing: classification.isArchiveOrListing,
    };

    return {
      findings,
      data,
    };
  }
}
