/**
 * Standards-oriented HTML Parser Engine.
 * Extracts structured metadata, headings, links, media, forms, and security attributes
 * without executing JavaScript or initializing browser environments.
 */

import { parseDocument, DomUtils, ElementType } from 'htmlparser2';
import { classifyDiscoveredLink, normalizeCrawlUrl } from '@auditor/shared';
import type {
  ExtractedButton,
  ExtractedForm,
  ExtractedFormField,
  ExtractedImage,
  ExtractedLink,
  ExtractedMediaResource,
  HeadingItem,
  HeadingLevel,
  HeadingTag,
  HtmlParserOptions,
  HtmlStructureInfo,
  InlineEventHandlerInfo,
  MetaRefreshInfo,
  PageMetadata,
  ParsedHtmlDocument,
  ParserMetrics,
} from './types.js';

const DEFAULT_OPTIONS: Required<HtmlParserOptions> = {
  maxSnippetLength: 100,
  maxLinks: 500,
  maxImages: 500,
  maxResources: 500,
};

type DocumentNode = ReturnType<typeof parseDocument>;
type DomNode = DocumentNode['children'][number];
type DomElement = DomNode & {
  name: string;
  attribs: Record<string, string>;
  children?: DomNode[];
};

/**
 * Collapses multiple whitespace characters and trims text.
 */
function cleanText(text: string | null | undefined): string {
  if (!text) {
    return '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Checks if a node is an Element.
 */
function isElement(node: DomNode): node is DomElement {
  return ElementType.isTag(node);
}

/**
 * Extracts meta refresh configuration if present.
 */
function parseMetaRefresh(content: string | undefined, baseUrl: string): MetaRefreshInfo | null {
  if (!content) {
    return null;
  }
  const trimmed = content.trim();
  // Format: "5; url=https://example.com" or "0;URL='https://example.com'" or "10"
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(?:\s*;\s*(?:url\s*=)?\s*['"]?([^'"\s]+)['"]?)?/i);
  if (!match) {
    return null;
  }
  const delaySeconds = Math.max(0, parseFloat(match[1]));
  const rawTarget = match[2];
  let targetUrl: string | null = null;
  if (rawTarget) {
    const normalized = normalizeCrawlUrl(rawTarget, baseUrl);
    targetUrl = normalized ? normalized.href : rawTarget;
  }
  return {
    delaySeconds,
    targetUrl,
  };
}

/**
 * Extracts charset from a meta tag.
 */
function parseCharset(meta: DomElement): string | null {
  if (meta.attribs.charset) {
    return meta.attribs.charset.trim();
  }
  const httpEquiv = meta.attribs['http-equiv'];
  if (httpEquiv && httpEquiv.toLowerCase() === 'content-type' && meta.attribs.content) {
    const match = meta.attribs.content.match(/charset=\s*([a-zA-Z0-9_-]+)/i);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

const NON_VISIBLE_CONTENT_TAGS = new Set([
  'head',
  'script',
  'style',
  'noscript',
  'template',
  'svg',
]);

const INLINE_TEXT_JOIN_TAGS = new Set([
  'b',
  'em',
  'i',
  'strong',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'mark',
  'code',
  'abbr',
  'cite',
  'dfn',
  'kbd',
  'samp',
  'var',
]);

/**
 * Collects visible prose text excluding non-rendered containers (head, script, style, svg).
 */
function collectVisibleText(nodes: DomNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.type === ElementType.Text) {
      const data = (node as unknown as { data?: string }).data;
      if (data) {
        out.push(data);
      }
    } else if (isElement(node)) {
      const tag = node.name.toLowerCase();
      if (!NON_VISIBLE_CONTENT_TAGS.has(tag) && node.children && node.children.length > 0) {
        collectVisibleText(node.children as DomNode[], out);
        if (!INLINE_TEXT_JOIN_TAGS.has(tag)) {
          out.push(' ');
        }
      }
    }
  }
}

/**
 * Counts visible body/element words excluding markup and non-rendered containers.
 */
function countVisibleWords(nodes: DomNode[]): number {
  const chunks: string[] = [];
  collectVisibleText(nodes, chunks);
  const normalized = cleanText(chunks.join(''));
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).filter(w => w.length > 0).length;
}

export class HtmlParserEngine {
  private readonly defaultOptions: Required<HtmlParserOptions>;

  constructor(options?: HtmlParserOptions) {
    this.defaultOptions = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Static convenience helper to parse HTML without explicit instantiation.
   */
  static parseHtml(
    html: string,
    pageUrl: string,
    authorizedOrigin: string,
    options?: HtmlParserOptions,
  ): ParsedHtmlDocument {
    return new HtmlParserEngine(options).parse(html, pageUrl, authorizedOrigin, options);
  }

  /**
   * Parses raw HTML into a structured, standards-oriented ParsedHtmlDocument.
   */
  parse(
    html: string,
    pageUrl: string,
    authorizedOrigin: string,
    options?: HtmlParserOptions,
  ): ParsedHtmlDocument {
    const startTime = performance.now();
    const effectiveOptions = { ...this.defaultOptions, ...options };

    const doc = parseDocument(html, {
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
      recognizeSelfClosing: true,
    });

    let totalNodes = 0;
    let hasDoctype = false;
    const allElements: DomElement[] = [];

    // Check root children for DOCTYPE directive
    for (const child of doc.children) {
      if (
        child.type === 'directive' &&
        (child as unknown as { name?: string }).name?.toLowerCase().includes('doctype')
      ) {
        hasDoctype = true;
      }
    }

    // Single-pass depth-first collection of all elements in document order
    function traverse(nodes: DomNode[]) {
      for (const node of nodes) {
        totalNodes++;
        if (isElement(node)) {
          allElements.push(node);
          if (node.children && node.children.length > 0) {
            traverse(node.children as DomNode[]);
          }
        }
      }
    }

    traverse(doc.children as DomNode[]);

    // 1. Page Metadata
    let title: string | null = null;
    let description: string | null = null;
    let robots: string | null = null;
    let canonical: string | null = null;
    let generator: string | null = null;
    let lang: string | null = null;
    let dir: string | null = null;
    let charset: string | null = null;
    let viewport: string | null = null;
    let metaRefresh: MetaRefreshInfo | null = null;
    const openGraph: Record<string, string> = {};
    const twitterCard: Record<string, string> = {};

    // 2. Headings
    const headings: HeadingItem[] = [];

    // 3. Links
    const links: ExtractedLink[] = [];

    // 4. Images
    const images: ExtractedImage[] = [];

    // 5. Media Resources
    const resources: ExtractedMediaResource[] = [];

    // 6. Forms
    const forms: ExtractedForm[] = [];

    // 7. Structure & Security attributes
    const elementIds: string[] = [];
    const inlineEventHandlers: InlineEventHandlerInfo[] = [];
    const jsonLdScripts: string[] = [];

    for (const el of allElements) {
      const tag = el.name.toLowerCase();
      const attribs: Record<string, string> = el.attribs || {};

      // Element IDs
      if (attribs.id && attribs.id.trim().length > 0) {
        elementIds.push(attribs.id.trim());
      }

      // Inline Event Handlers (e.g. onclick, onload, onerror, onmouseover)
      for (const [attrName, attrValue] of Object.entries(attribs)) {
        if (/^on[a-z]+/i.test(attrName)) {
          const snippet = attrValue
            ? attrValue.slice(0, effectiveOptions.maxSnippetLength).trim()
            : '';
          inlineEventHandlers.push({
            tag,
            attribute: attrName.toLowerCase(),
            valueSnippet: snippet,
          });
        }
      }

      // HTML tag lang & dir
      if (tag === 'html') {
        if (attribs.lang) {
          lang = attribs.lang.trim();
        }
        if (attribs.dir) {
          dir = attribs.dir.trim().toLowerCase();
        }
      }

      // Title
      if (tag === 'title' && title === null) {
        title = cleanText(DomUtils.textContent(el));
      }

      // Meta tags
      if (tag === 'meta') {
        if (!charset) {
          const extractedCharset = parseCharset(el);
          if (extractedCharset) {
            charset = extractedCharset;
          }
        }

        const nameAttr = attribs.name ? attribs.name.toLowerCase().trim() : '';
        const propAttr = attribs.property ? attribs.property.toLowerCase().trim() : '';
        const contentVal = attribs.content ? attribs.content.trim() : '';

        if (nameAttr === 'description' && description === null) {
          description = contentVal;
        } else if (nameAttr === 'robots' && robots === null) {
          robots = contentVal;
        } else if (nameAttr === 'viewport' && viewport === null) {
          viewport = contentVal;
        } else if (nameAttr === 'generator' && generator === null) {
          generator = contentVal;
        } else if (nameAttr.startsWith('twitter:') || propAttr.startsWith('twitter:')) {
          const key = (nameAttr.startsWith('twitter:') ? nameAttr : propAttr).slice(8);
          if (key && !(key in twitterCard)) {
            twitterCard[key] = contentVal;
          }
        }

        if (propAttr.startsWith('og:')) {
          const key = propAttr.slice(3);
          if (key && !(key in openGraph)) {
            openGraph[key] = contentVal;
          }
        }

        const httpEquiv = attribs['http-equiv'] ? attribs['http-equiv'].toLowerCase().trim() : '';
        if (httpEquiv === 'refresh' && metaRefresh === null) {
          metaRefresh = parseMetaRefresh(attribs.content, pageUrl);
        }
      }

      // Link tags (canonical, stylesheets, icons)
      if (tag === 'link') {
        const rel = attribs.rel ? attribs.rel.toLowerCase().trim() : '';
        const href = attribs.href ? attribs.href.trim() : '';

        if (rel === 'canonical' && href && canonical === null) {
          const normalized = normalizeCrawlUrl(href, pageUrl);
          canonical = normalized ? normalized.href : href;
        }

        if (rel === 'stylesheet' && href && resources.length < effectiveOptions.maxResources) {
          const normalized = normalizeCrawlUrl(href, pageUrl);
          const extra: Record<string, string> = {};
          if (attribs.media) extra.media = attribs.media.trim();
          resources.push({
            type: 'stylesheet',
            url: normalized ? normalized.href : null,
            originalValue: href,
            extra: Object.keys(extra).length > 0 ? extra : undefined,
          });
        }

        if (
          (rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon') &&
          href &&
          resources.length < effectiveOptions.maxResources
        ) {
          const normalized = normalizeCrawlUrl(href, pageUrl);
          const extra: Record<string, string> = { rel };
          if (attribs.sizes) extra.sizes = attribs.sizes.trim();
          resources.push({
            type: 'icon',
            url: normalized ? normalized.href : null,
            originalValue: href,
            extra,
          });
        }
      }

      // Headings (H1 to H6)
      const headingMatch = tag.match(/^h([1-6])$/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1], 10) as HeadingLevel;
        const text = cleanText(DomUtils.textContent(el));
        headings.push({
          tag: tag as HeadingTag,
          level,
          text,
          id: attribs.id ? attribs.id.trim() : null,
        });
      }

      // Anchor and Area links
      if ((tag === 'a' || tag === 'area') && attribs.href !== undefined) {
        if (links.length < effectiveOptions.maxLinks) {
          const rawHref = attribs.href;
          const classification = classifyDiscoveredLink(rawHref, pageUrl, authorizedOrigin);
          const linkText = cleanText(DomUtils.textContent(el));
          links.push({
            originalValue: rawHref,
            resolvedUrl: classification.resolvedUrl,
            text: linkText,
            rel: attribs.rel ? attribs.rel.trim() : null,
            target: attribs.target ? attribs.target.trim() : null,
            isInternal: classification.isInternal,
            isEligibleForCrawl: classification.isEligibleForCrawl,
            rejectionReason: classification.rejectionReason,
          });
        }
      }

      // Images
      if (tag === 'img' && images.length < effectiveOptions.maxImages) {
        images.push({
          src: attribs.src ? attribs.src.trim() : null,
          srcset: attribs.srcset ? attribs.srcset.trim() : null,
          dataSrc: attribs['data-src'] ? attribs['data-src'].trim() : null,
          dataSrcset: attribs['data-srcset'] ? attribs['data-srcset'].trim() : null,
          alt: attribs.alt !== undefined ? attribs.alt.trim() : null,
          width: attribs.width ? attribs.width.trim() : null,
          height: attribs.height ? attribs.height.trim() : null,
          loading: attribs.loading ? attribs.loading.trim().toLowerCase() : null,
        });
      }

      // Scripts
      if (tag === 'script') {
        const typeAttr = (attribs.type || '').trim().toLowerCase();
        if (typeAttr === 'application/ld+json') {
          const rawContent = DomUtils.getText(el).trim();
          if (rawContent.length > 0) {
            jsonLdScripts.push(rawContent);
          }
        } else if (attribs.src && resources.length < effectiveOptions.maxResources) {
          const normalized = normalizeCrawlUrl(attribs.src, pageUrl);
          const extra: Record<string, string> = {};
          if ('async' in attribs) extra.async = 'true';
          if ('defer' in attribs) extra.defer = 'true';
          if (attribs.type) extra.type = attribs.type.trim();
          resources.push({
            type: 'script',
            url: normalized ? normalized.href : null,
            originalValue: attribs.src.trim(),
            extra: Object.keys(extra).length > 0 ? extra : undefined,
          });
        }
      }

      // Iframes
      if (tag === 'iframe' && attribs.src && resources.length < effectiveOptions.maxResources) {
        const normalized = normalizeCrawlUrl(attribs.src, pageUrl);
        resources.push({
          type: 'iframe',
          url: normalized ? normalized.href : null,
          originalValue: attribs.src.trim(),
        });
      }

      // Audio
      if (tag === 'audio' && resources.length < effectiveOptions.maxResources) {
        if (attribs.src) {
          const normalized = normalizeCrawlUrl(attribs.src, pageUrl);
          resources.push({
            type: 'audio',
            url: normalized ? normalized.href : null,
            originalValue: attribs.src.trim(),
          });
        }
      }

      // Video
      if (tag === 'video' && resources.length < effectiveOptions.maxResources) {
        if (attribs.src) {
          const normalized = normalizeCrawlUrl(attribs.src, pageUrl);
          const extra: Record<string, string> = {};
          if (attribs.poster) extra.poster = attribs.poster.trim();
          resources.push({
            type: 'video',
            url: normalized ? normalized.href : null,
            originalValue: attribs.src.trim(),
            extra: Object.keys(extra).length > 0 ? extra : undefined,
          });
        }
      }

      // Forms
      if (tag === 'form') {
        const rawAction = attribs.action !== undefined ? attribs.action.trim() : null;
        let action: string | null = null;
        if (rawAction) {
          const normalized = normalizeCrawlUrl(rawAction, pageUrl);
          action = normalized ? normalized.href : rawAction;
        }

        const method = (attribs.method || 'get').toLowerCase().trim();
        const enctype = attribs.enctype ? attribs.enctype.trim() : null;

        // Query nested inputs, selects, textareas, buttons
        const formFields: ExtractedFormField[] = [];
        const formButtons: ExtractedButton[] = [];

        function collectFormControls(nodes: DomNode[]) {
          for (const node of nodes) {
            if (isElement(node)) {
              const controlTag = node.name.toLowerCase();
              const cAttribs: Record<string, string> = node.attribs || {};

              if (controlTag === 'input') {
                const inputType = (cAttribs.type || 'text').toLowerCase().trim();
                if (['submit', 'button', 'reset', 'image'].includes(inputType)) {
                  formButtons.push({
                    type: inputType,
                    name: cAttribs.name ? cAttribs.name.trim() : null,
                    text: cAttribs.value ? cAttribs.value.trim() : inputType,
                  });
                } else {
                  formFields.push({
                    name: cAttribs.name ? cAttribs.name.trim() : '',
                    type: inputType,
                    id: cAttribs.id ? cAttribs.id.trim() : null,
                    required: 'required' in cAttribs,
                    disabled: 'disabled' in cAttribs,
                  });
                }
              } else if (controlTag === 'textarea') {
                formFields.push({
                  name: cAttribs.name ? cAttribs.name.trim() : '',
                  type: 'textarea',
                  id: cAttribs.id ? cAttribs.id.trim() : null,
                  required: 'required' in cAttribs,
                  disabled: 'disabled' in cAttribs,
                });
              } else if (controlTag === 'select') {
                formFields.push({
                  name: cAttribs.name ? cAttribs.name.trim() : '',
                  type: 'select',
                  id: cAttribs.id ? cAttribs.id.trim() : null,
                  required: 'required' in cAttribs,
                  disabled: 'disabled' in cAttribs,
                });
              } else if (controlTag === 'button') {
                const btnType = (cAttribs.type || 'submit').toLowerCase().trim();
                formButtons.push({
                  type: btnType,
                  name: cAttribs.name ? cAttribs.name.trim() : null,
                  text: cleanText(DomUtils.textContent(node)),
                });
              }

              if (node.children && node.children.length > 0) {
                collectFormControls(node.children as DomNode[]);
              }
            }
          }
        }

        if (el.children && el.children.length > 0) {
          collectFormControls(el.children as DomNode[]);
        }

        forms.push({
          id: attribs.id ? attribs.id.trim() : null,
          name: attribs.name ? attribs.name.trim() : null,
          action,
          rawAction,
          method,
          enctype,
          fields: formFields,
          buttons: formButtons,
        });
      }
    }

    const parseDurationMs = Math.round((performance.now() - startTime) * 100) / 100;
    const htmlSizeBytes = Buffer.byteLength(html, 'utf8');
    const visibleWordCount = countVisibleWords(doc.children as DomNode[]);

    const metadata: PageMetadata = {
      title,
      description,
      robots,
      canonical,
      generator,
      lang,
      dir,
      charset,
      viewport,
      openGraph,
      twitterCard,
    };

    const structure: HtmlStructureInfo = {
      elementIds,
      inlineEventHandlers,
      metaRefresh,
      hasDoctype,
    };

    const metrics: ParserMetrics = {
      parseDurationMs,
      totalNodes,
      htmlSizeBytes,
    };

    return {
      pageUrl,
      authorizedOrigin,
      metadata,
      headings,
      links,
      images,
      resources,
      forms,
      structure,
      metrics,
      visibleWordCount,
      jsonLdScripts: Object.freeze(jsonLdScripts),
    };
  }
}
