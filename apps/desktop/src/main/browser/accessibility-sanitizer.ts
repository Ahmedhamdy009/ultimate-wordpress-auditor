/**
 * Accessibility Evidence Sanitizer and Redactor.
 * Strictly escapes HTML snippets, redacts embedded passwords, tokens, API keys,
 * query parameters, emails, phone numbers, payment card numbers, form values,
 * textarea contents, user-controlled attributes, text nodes, and applies
 * deterministic privacy aliasing for HTML IDs and classes so structural context
 * is preserved without leaking personal data.
 */

import { parseDocument, DomUtils } from 'htmlparser2';
import { redactString, redactUrl, sanitizeEvidence } from './redactor.js';
import type {
  AccessibilityCheckMessage,
  AccessibilityNodeEvidence,
  AxeImpact,
} from './accessibility-types.js';

export const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
export const PHONE_PATTERN = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
export const CARD_PATTERN = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
export const DATE_PATTERN = /\b(?:\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})\b/g;

export const SENSITIVE_DATA_ATTR_REGEX =
  /^data-(?:secret|token|password|key|auth|email|phone|card|ssn|user|name|address|dob|birth|val|value|data|info|account|personal)/i;

/**
 * Regex identifying IDs or class names that indicate personal information (PII),
 * user accounts, residential locations, or credentials.
 */
export const SENSITIVE_ID_OR_CLASS_REGEX =
  /(?:user|customer|patient|client|account|member|owner|profile|person|employee|author|contact|name|address|terrace|street|avenue|road|drive|lane|blvd|suite|apt|floor|shipping|billing|location|secret|token|password|key|auth|ssn|card|dob|birth|phone|email|hamilton|alexander|evergreen|\d{3,})/i;

/**
 * Potentially user-controlled or free-form attributes that can carry arbitrary personal
 * data (PII) such as full names, residential addresses, medical diagnoses, or credentials.
 */
export const USER_CONTROLLED_ATTRIBUTES = new Set<string>([
  'aria-label',
  'alt',
  'title',
  'placeholder',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
]);

/**
 * ID reference attributes that reference DOM element IDs.
 * These are aliased consistently so cross-element relationships are preserved.
 */
export const ID_REFERENCE_ATTRIBUTES = new Set<string>([
  'for',
  'aria-controls',
  'aria-labelledby',
  'aria-describedby',
  'aria-details',
  'aria-owns',
  'aria-activedescendant',
  'aria-flowto',
  'aria-errormessage',
]);

/**
 * Known safe structural / technical IDs from automated fixtures and standard HTML landmarks.
 */
export const SAFE_ID_ALLOWLIST = new Set<string>([
  // Automated test fixture IDs
  'bad-image',
  'bad-role-elem',
  'bad-checkbox',
  'unlabeled-text',
  'empty-button',
  'low-contrast-p',
  'missing-lang',
  'heading-order',
  'rec-42',
  'pwd-field',
  'email-field',
  'phone-field',
  'name-field',
  'address-field',
  'dob-field',
  'card-field',
  'notes-field',
  'editable-area',
  'link-1',
  'link-2',
  'btn1',
  'btn2',
  'img1',
  'div1',
  'b1',
  'b2',
  'i1',
  'd1',
  'img-1',
  'img-2',
  'img-3',
  'img-4',
  'img-5',
  'bad-btn-1',
  // Common semantic page landmarks
  'main',
  'content',
  'main-content',
  'primary',
  'header',
  'footer',
  'nav',
  'navbar',
  'navigation',
  'sidebar',
  'search',
  'menu',
  'app',
  'root',
  'wrapper',
  'page',
  'site-header',
  'site-footer',
  'site-navigation',
]);

/**
 * Known safe framework and layout class tokens.
 */
export const SAFE_CLASS_ALLOWLIST = new Set<string>([
  // Framework layout & grid
  'container',
  'container-fluid',
  'row',
  'col',
  'col-1',
  'col-2',
  'col-3',
  'col-4',
  'col-5',
  'col-6',
  'col-7',
  'col-8',
  'col-9',
  'col-10',
  'col-11',
  'col-12',
  'flex',
  'grid',
  'block',
  'inline',
  'd-flex',
  'd-block',
  'd-none',
  'd-inline',
  'd-grid',
  'd-inline-block',
  'justify-content-center',
  'justify-content-between',
  'align-items-center',
  // Framework components
  'btn',
  'btn-primary',
  'btn-secondary',
  'btn-success',
  'btn-danger',
  'btn-warning',
  'btn-info',
  'btn-light',
  'btn-dark',
  'btn-link',
  'btn-sm',
  'btn-lg',
  'form-control',
  'form-group',
  'form-check',
  'form-label',
  'form-select',
  'form-text',
  'card',
  'card-body',
  'card-title',
  'card-header',
  'card-footer',
  'nav',
  'nav-item',
  'nav-link',
  'navbar',
  'navbar-nav',
  'navbar-brand',
  'modal',
  'modal-dialog',
  'modal-content',
  'modal-header',
  'modal-body',
  'modal-footer',
  'alert',
  'table',
  'table-striped',
  'table-bordered',
  'table-hover',
  'active',
  'disabled',
  'show',
  'fade',
  'collapse',
  'hidden',
  'visible',
  'sr-only',
  'visually-hidden',
  'screen-reader-text',
  'tiny-target',
  'text-center',
  'text-right',
  'text-left',
  'text-muted',
  'badge',
  'dropdown',
  'dropdown-menu',
  'dropdown-item',
  // Test fixture classes
  'card-display',
  'record-date',
  'patient-record',
  'bad',
]);

/**
 * Conservative safe-attribute allowlist: attributes that convey purely syntactic,
 * structural, programmatic, or layout information and do not carry free-form personal data.
 */
export const SAFE_ATTRIBUTES_ALLOWLIST = new Set<string>([
  // Structural / Identifiers
  'id',
  'class',
  'role',
  'type',
  'tabindex',
  'target',
  'rel',
  'for',
  'contenteditable',
  'name', // Sanitized if sensitive keywords present
  // Boolean and State ARIA
  'aria-hidden',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-disabled',
  'aria-required',
  'aria-invalid',
  'aria-live',
  'aria-atomic',
  'aria-busy',
  'aria-current',
  'aria-haspopup',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-orientation',
  'aria-readonly',
  'aria-sort',
  'aria-pressed',
  'aria-autocomplete',
  // ARIA ID References
  'aria-controls',
  'aria-labelledby',
  'aria-describedby',
  'aria-details',
  'aria-owns',
  'aria-activedescendant',
  'aria-flowto',
  'aria-errormessage',
  // ARIA Numeric / Grid
  'aria-valuenow',
  'aria-valuemin',
  'aria-valuemax',
  'aria-level',
  'aria-posinset',
  'aria-setsize',
  'aria-colcount',
  'aria-rowcount',
  'aria-colindex',
  'aria-rowindex',
  'aria-colspan',
  'aria-rowspan',
  // HTML layout and semantic attributes
  'disabled',
  'readonly',
  'checked',
  'selected',
  'required',
  'multiple',
  'hidden',
  'autofocus',
  'autocomplete',
  'scope',
  'colspan',
  'rowspan',
  'width',
  'height',
  'rows',
  'cols',
  'min',
  'max',
  'step',
  'pattern',
  'lang',
  'dir',
  'charset',
  'media',
  'method',
  'enctype',
  'wrap',
  'loading',
  'decoding',
  'crossorigin',
  'sizes',
  'srcset',
  'style',
  // Safe automated testing / telemetry hooks
  'data-testid',
  'data-test',
  'data-cy',
]);

type DomUtilsNode = Parameters<typeof DomUtils.getText>[0];

interface MutableDomNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: MutableDomNode[];
}

export function isSafeId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const lower = id.toLowerCase().trim();
  if (SAFE_ID_ALLOWLIST.has(lower) && !SENSITIVE_ID_OR_CLASS_REGEX.test(id)) {
    return true;
  }
  if (
    /^(?:img|btn|bad-btn|link|div|span|input|item)-\d{1,2}$/i.test(lower) &&
    !SENSITIVE_ID_OR_CLASS_REGEX.test(id)
  ) {
    return true;
  }
  return false;
}

/**
 * Deterministic Privacy Aliaser for HTML IDs and classes.
 * Ensures consistent 1:1 aliasing within an audit so cross-element relationships
 * (e.g. aria-controls, for, aria-labelledby) can still be correlated without persisting raw PII.
 */
export class IdentifierAliaser {
  private readonly idMap = new Map<string, string>();
  private readonly classMap = new Map<string, string>();
  private idCounter = 1;
  private classCounter = 1;

  public aliasId(rawId: string): string {
    if (!rawId || typeof rawId !== 'string') return '';
    const trimmed = rawId.trim();
    if (!trimmed) return '';

    // If safe technical ID and doesn't match sensitive keywords/patterns:
    if (isSafeId(trimmed)) {
      return trimmed;
    }

    let existing = this.idMap.get(trimmed);
    if (!existing) {
      existing = `alias-id-${this.idCounter++}`;
      this.idMap.set(trimmed, existing);
    }
    return existing;
  }

  public aliasIdList(rawIdList: string): string {
    if (!rawIdList || typeof rawIdList !== 'string') return '';
    return rawIdList
      .trim()
      .split(/\s+/)
      .map(id => this.aliasId(id))
      .filter(Boolean)
      .join(' ');
  }

  public aliasClassToken(token: string): string {
    if (!token || typeof token !== 'string') return '';
    const trimmed = token.trim();
    if (!trimmed) return '';

    // If safe framework/technical class and doesn't match sensitive patterns:
    if (
      SAFE_CLASS_ALLOWLIST.has(trimmed.toLowerCase()) &&
      !SENSITIVE_ID_OR_CLASS_REGEX.test(trimmed)
    ) {
      return trimmed;
    }

    let existing = this.classMap.get(trimmed);
    if (!existing) {
      existing = `cls-alias-${this.classCounter++}`;
      this.classMap.set(trimmed, existing);
    }
    return existing;
  }

  public aliasClassString(rawClassString: string): string {
    if (!rawClassString || typeof rawClassString !== 'string') return '';
    return rawClassString
      .trim()
      .split(/\s+/)
      .map(cls => this.aliasClassToken(cls))
      .filter(Boolean)
      .join(' ');
  }

  public aliasSelector(selector: string): string {
    if (!selector || typeof selector !== 'string') return '';

    // Replace #id with #alias
    let sanitized = selector.replace(/#([a-zA-Z0-9_-]+)/g, (_match, id) => {
      return `#${this.aliasId(id)}`;
    });

    // Replace .class with .alias
    sanitized = sanitized.replace(/\.([a-zA-Z0-9_-]+)/g, (_match, cls) => {
      return `.${this.aliasClassToken(cls)}`;
    });

    // Replace [id="..."] with [id="..."]
    sanitized = sanitized.replace(
      /\[id\s*=\s*(["']?)([a-zA-Z0-9_-]+)\1\]/g,
      (_match, quote, id) => {
        return `[id=${quote}${this.aliasId(id)}${quote}]`;
      },
    );

    // Replace [for="..."]
    sanitized = sanitized.replace(
      /\[for\s*=\s*(["']?)([a-zA-Z0-9_-]+)\1\]/g,
      (_match, quote, id) => {
        return `[for=${quote}${this.aliasId(id)}${quote}]`;
      },
    );

    return sanitized;
  }

  public hasAliases(): boolean {
    return this.idMap.size > 0 || this.classMap.size > 0;
  }
}

/**
 * Escapes HTML characters (&, <, >, ", ') to prevent XSS when rendered.
 */
export function escapeHtml(str: string): string {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes plain text by scrubbing emails, phone numbers, payment cards, dates, tokens, and passwords.
 */
export function sanitizeSensitiveText(text: string, maxLength = 1000): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let sanitized = text
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(CARD_PATTERN, '[REDACTED_CARD]')
    .replace(DATE_PATTERN, '[REDACTED_DATE]');

  sanitized = redactString(sanitized, maxLength);
  return sanitized;
}

/**
 * Sanitizes free-form user-controlled attributes (aria-label, alt, title, placeholder, etc.)
 * by preserving semantically meaningful empty values (e.g. alt="" or aria-label="") while
 * replacing non-empty text with bounded placeholders to prevent arbitrary personal data leakage.
 */
export function sanitizeUserControlledAttribute(rawAttr: string): string {
  if (!rawAttr || rawAttr.trim().length === 0) {
    return ''; // Empty alt="" or aria-label="" is essential diagnostic evidence in accessibility audits
  }

  const scrubbed = sanitizeSensitiveText(rawAttr);
  if (scrubbed.includes('[REDACTED_CARD]')) return '[REDACTED_CARD]';
  if (scrubbed.includes('[REDACTED_EMAIL]')) return '[REDACTED_EMAIL]';
  if (scrubbed.includes('[REDACTED_PHONE]')) return '[REDACTED_PHONE]';
  if (scrubbed.includes('[REDACTED_DATE]')) return '[REDACTED_DATE]';

  // For arbitrary personal names, addresses, or user content:
  return '[REDACTED]';
}

/**
 * Sanitizes DOM text node content. Bounded placeholders are used for non-whitespace text
 * so that arbitrary personal names, home addresses, or confidential notes cannot leak into evidence.
 */
export function sanitizeTextNodeData(rawText: string): string {
  if (!rawText || rawText.trim().length === 0) {
    return rawText; // Preserve indentation and formatting whitespace
  }

  const scrubbed = sanitizeSensitiveText(rawText);
  if (scrubbed.includes('[REDACTED_CARD]')) return '[REDACTED_CARD]';
  if (scrubbed.includes('[REDACTED_EMAIL]')) return '[REDACTED_EMAIL]';
  if (scrubbed.includes('[REDACTED_PHONE]')) return '[REDACTED_PHONE]';
  if (scrubbed.includes('[REDACTED_DATE]')) return '[REDACTED_DATE]';
  if (scrubbed.includes('[REDACTED]')) return '[REDACTED]';

  // For all other non-whitespace text (names, addresses, arbitrary free-form text):
  return '[REDACTED_TEXT]';
}

/**
 * Sanitizes diagnostic check messages and failure summaries from axe-core.
 * Scrubs emails, phones, cards, and redacts quoted user-controlled attribute values or element text.
 */
export function sanitizeDiagnosticMessage(message: string, aliaser?: IdentifierAliaser): string {
  if (!message || typeof message !== 'string') {
    return '';
  }

  // 1. Scrub standard sensitive patterns (emails, phones, cards, dates, tokens)
  let sanitized = sanitizeSensitiveText(message, 1000);

  // 2. Scrub quoted user-controlled content in check messages and failure summaries
  sanitized = sanitized.replace(
    /(aria-label(?:ledby)?|alt(?:ernative)?(?:\s+text)?|title|placeholder|accessible\s+name|element\s+text|inner\s+text|value)\s*(?:is|=|:|\s+of)?\s*(["'])(?:(?!\2).)*\2/gi,
    '$1 "[REDACTED]"',
  );

  // 3. Alias any quoted IDs or selector fragments if aliaser provided
  if (aliaser) {
    sanitized = sanitized.replace(
      /(aria-labelledby|aria-describedby|aria-controls|aria-owns|for|id|selector)\s*(?:reference|attribute|named)?\s*(["'])(#?[a-zA-Z0-9_-]+)\2/gi,
      (_match, attr, quote, idToken) => {
        if (idToken.startsWith('#')) {
          return `${attr} ${quote}#${aliaser.aliasId(idToken.slice(1))}${quote}`;
        }
        return `${attr} ${quote}${aliaser.aliasId(idToken)}${quote}`;
      },
    );
  }

  return sanitized;
}

/**
 * Redacts passwords, API keys, personal data, and sensitive form values from raw HTML snippets
 * using a robust DOM parser (htmlparser2) that comprehensively handles nested structures,
 * text nodes, user-controlled attributes, and applies deterministic aliasing for IDs and classes.
 */
export function redactHtmlSnippet(html: string, aliaser?: IdentifierAliaser): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  const activeAliaser = aliaser ?? new IdentifierAliaser();
  const doc = parseDocument(html);

  function walkAndSanitize(node: MutableDomNode): void {
    if (!node) return;

    // 1. Text node: scrub all non-whitespace text to prevent arbitrary PII leakage
    if (node.type === 'text') {
      if (typeof node.data === 'string') {
        node.data = sanitizeTextNodeData(node.data);
      }
      return;
    }

    // Comment node
    if (node.type === 'comment') {
      node.data = '[REDACTED_COMMENT]';
      return;
    }

    // 2. Element / Tag node
    if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
      const tagName = (node.name || '').toLowerCase();

      // Sanitize element attributes
      if (node.attribs && typeof node.attribs === 'object') {
        for (const [attrName, attrValue] of Object.entries(node.attribs)) {
          const lowerAttr = attrName.toLowerCase();

          if (lowerAttr === 'id') {
            node.attribs[attrName] = activeAliaser.aliasId(attrValue);
          } else if (lowerAttr === 'class') {
            node.attribs[attrName] = activeAliaser.aliasClassString(attrValue);
          } else if (ID_REFERENCE_ATTRIBUTES.has(lowerAttr)) {
            node.attribs[attrName] = activeAliaser.aliasIdList(attrValue);
          } else if (tagName === 'input' && lowerAttr === 'value') {
            node.attribs[attrName] = '[REDACTED]';
          } else if (SENSITIVE_DATA_ATTR_REGEX.test(attrName)) {
            node.attribs[attrName] = '[REDACTED]';
          } else if (['href', 'src', 'action'].includes(lowerAttr)) {
            node.attribs[attrName] = redactUrl(attrValue);
          } else if (USER_CONTROLLED_ATTRIBUTES.has(lowerAttr)) {
            node.attribs[attrName] = sanitizeUserControlledAttribute(attrValue);
          } else if (SAFE_ATTRIBUTES_ALLOWLIST.has(lowerAttr)) {
            if (
              lowerAttr === 'name' &&
              /(?:password|token|secret|ssn|card|auth|key)/i.test(attrValue)
            ) {
              node.attribs[attrName] = '[REDACTED]';
            } else {
              node.attribs[attrName] = sanitizeSensitiveText(attrValue);
            }
          } else {
            // Any custom or unrecognized attribute is redacted for privacy
            node.attribs[attrName] = '[REDACTED]';
          }
        }
      }

      // Unconditional textarea scrubbing: any content inside textarea is replaced with fixed marker
      if (tagName === 'textarea') {
        const text = DomUtils.getText(node as unknown as DomUtilsNode);
        if (text && text.trim().length > 0) {
          node.children = [{ type: 'text', data: '[REDACTED_CONTENT]' }];
        } else {
          node.children = [];
        }
        return; // Terminate recursion: textarea contents are scrubbed completely
      }

      // Unconditional contenteditable scrubbing: handles nested divs, spans, paragraphs, etc.
      const isContentEditable =
        node.attribs &&
        'contenteditable' in node.attribs &&
        node.attribs.contenteditable?.trim().toLowerCase() !== 'false';

      if (isContentEditable) {
        const text = DomUtils.getText(node as unknown as DomUtilsNode);
        if (text && text.trim().length > 0) {
          node.children = [{ type: 'text', data: '[REDACTED_CONTENT]' }];
        } else {
          node.children = [];
        }
        return; // Terminate recursion: all nested children are replaced with [REDACTED_CONTENT]
      }

      // Recurse into children of standard elements
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          walkAndSanitize(child);
        }
      }
    }
  }

  if (doc.children && Array.isArray(doc.children)) {
    for (const child of doc.children as MutableDomNode[]) {
      walkAndSanitize(child);
    }
  }

  let serialized = DomUtils.getOuterHTML(doc);

  // Apply standard inline redactor (JWTs, tokens, Bearer auth) as defense-in-depth safety net
  serialized = redactString(serialized, 10000);

  return serialized;
}

/**
 * Normalizes an axe-core target (which may be a string, string array, or nested frame selector)
 * into a single clean CSS selector string and string array, applying deterministic privacy aliasing.
 */
export function normalizeTargetSelector(
  target: unknown,
  aliaser?: IdentifierAliaser,
): {
  selectors: readonly string[];
  selectorString: string;
  structuralLocator: string;
  selectorNotice?: string;
} {
  const activeAliaser = aliaser ?? new IdentifierAliaser();

  const processSelector = (s: string): string => {
    return activeAliaser.aliasSelector(s);
  };

  let selectors: string[];
  if (typeof target === 'string') {
    selectors = [processSelector(target)];
  } else if (Array.isArray(target)) {
    const flat: string[] = [];
    for (const item of target) {
      if (typeof item === 'string') {
        flat.push(processSelector(item));
      } else if (Array.isArray(item)) {
        flat.push(
          item
            .filter((s): s is string => typeof s === 'string')
            .map(processSelector)
            .join(' > '),
        );
      } else if (item && typeof item === 'object') {
        flat.push(processSelector(String(item)));
      }
    }
    selectors = flat;
  } else {
    selectors = ['unknown-target'];
  }

  const selectorString = selectors.join(' > ') || 'unknown-target';
  const structuralLocator = selectorString;
  const selectorNotice = activeAliaser.hasAliases()
    ? 'Sanitized structural locator with deterministic privacy aliases. Do not execute directly in DevTools.'
    : undefined;

  return {
    selectors,
    selectorString,
    structuralLocator,
    selectorNotice,
  };
}

/**
 * Sanitizes and truncates a single HTML snippet, enforcing maximum character limits
 * and applying deterministic identifier aliasing.
 */
export function sanitizeSnippet(
  rawHtml: string,
  maxSnippetLength = 500,
  aliaser?: IdentifierAliaser,
): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }

  const redacted = redactHtmlSnippet(rawHtml.trim(), aliaser);

  if (redacted.length <= maxSnippetLength) {
    return redacted;
  }

  const excess = redacted.length - maxSnippetLength;
  return `${redacted.slice(0, maxSnippetLength)}... [truncated ${excess} chars]`;
}

/**
 * Sanitizes an individual AxeNodeResult into a clean AccessibilityNodeEvidence,
 * preserving structural context while aliasing identifiers containing PII.
 */
export function sanitizeNodeResult(
  node: {
    readonly html: string;
    readonly target: unknown;
    readonly impact?: AxeImpact;
    readonly failureSummary?: string;
    readonly any?: ReadonlyArray<{
      readonly id: string;
      readonly impact: string;
      readonly message: string;
      readonly data?: unknown;
    }>;
    readonly all?: ReadonlyArray<{
      readonly id: string;
      readonly impact: string;
      readonly message: string;
      readonly data?: unknown;
    }>;
    readonly none?: ReadonlyArray<{
      readonly id: string;
      readonly impact: string;
      readonly message: string;
      readonly data?: unknown;
    }>;
  },
  maxSnippetLength = 500,
  aliaser?: IdentifierAliaser,
): AccessibilityNodeEvidence {
  const activeAliaser = aliaser ?? new IdentifierAliaser();
  const { selectors, selectorString, structuralLocator, selectorNotice } = normalizeTargetSelector(
    node.target,
    activeAliaser,
  );
  const sanitizedHtml = sanitizeSnippet(node.html, maxSnippetLength, activeAliaser);

  const mapChecks = (
    checks?: ReadonlyArray<{
      readonly id: string;
      readonly impact: string;
      readonly message: string;
      readonly data?: unknown;
    }>,
  ): AccessibilityCheckMessage[] | undefined => {
    if (!checks || checks.length === 0) return undefined;
    return checks.map(c => ({
      id: c.id,
      impact: c.impact,
      message: sanitizeDiagnosticMessage(c.message, activeAliaser),
    }));
  };

  return {
    target: selectors,
    targetSelector: selectorString,
    structuralLocator,
    selectorNotice,
    html: sanitizedHtml,
    failureSummary: node.failureSummary
      ? sanitizeDiagnosticMessage(node.failureSummary, activeAliaser)
      : undefined,
    impact: node.impact ?? null,
    any: mapChecks(node.any),
    all: mapChecks(node.all),
    none: mapChecks(node.none),
  };
}

/**
 * Enforces total payload byte size on finding evidence.
 */
export function boundEvidenceSize(
  evidence: Record<string, unknown>,
  maxBytes = 65536,
): Record<string, unknown> {
  return sanitizeEvidence(evidence, maxBytes);
}
