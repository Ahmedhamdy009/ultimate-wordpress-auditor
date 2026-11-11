import type { Page } from 'playwright-core';
import type { CreateFindingRequest } from '@auditor/shared';
import type {
  OverflowingElementInfo,
  ResponsiveAnalyzerOptions,
  ResponsivePageMetrics,
  ViewportProfile,
} from './visual-types.js';

export const DEFAULT_OVERFLOW_TOLERANCE_PX = 2.0;
export const DEFAULT_ELEMENT_INSPECTION_LIMIT = 500;
export const DEFAULT_MAX_FINDINGS_PER_VIEWPORT = 50;

interface InBrowserEvaluationResult {
  windowInnerWidth: number;
  windowInnerHeight: number;
  documentScrollWidth: number;
  documentScrollHeight: number;
  bodyScrollWidth: number;
  bodyScrollHeight: number;
  hasHorizontalOverflow: boolean;
  maxHorizontalOverflowPx: number;
  documentOverflowX: string;
  bodyOverflowX: string;
  rootClipsOverflow: boolean;
  inspectedElementsCount: number;
  candidateElements: Array<{
    selector: string;
    tagName: string;
    id?: string;
    className?: string;
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
    boundingBox: {
      x: number;
      y: number;
      width: number;
      height: number;
      right: number;
      bottom: number;
    };
    overflowAmountPx: number;
    overflowType: OverflowingElementInfo['overflowType'];
    isFixedPosition?: boolean;
    snippet?: string;
    parentSelector?: string;
    computedStyles?: {
      width?: string;
      maxWidth?: string;
      overflowX?: string;
      overflowY?: string;
      display?: string;
      position?: string;
      whiteSpace?: string;
      textOverflow?: string;
    };
  }>;
}

const IN_BROWSER_EVALUATION_SCRIPT = `
(function(options) {
  var tolerance = options.tolerance;
  var limit = options.limit;
  var configuredWidth = options.viewportWidth || (window.visualViewport ? window.visualViewport.width : window.innerWidth);
  var innerWidth = Math.min(window.innerWidth, configuredWidth);
  var innerHeight = window.innerHeight;

  var docElem = document.documentElement;
  var body = document.body;

  var docScrollWidth = docElem ? docElem.scrollWidth : 0;
  var docScrollHeight = docElem ? docElem.scrollHeight : 0;
  var bodyScrollWidth = body ? body.scrollWidth : 0;
  var bodyScrollHeight = body ? body.scrollHeight : 0;

  var docStyle = docElem ? window.getComputedStyle(docElem) : null;
  var bodyStyle = body ? window.getComputedStyle(body) : null;
  var docOverflowX = docStyle ? docStyle.overflowX : 'visible';
  var bodyOverflowX = bodyStyle ? bodyStyle.overflowX : 'visible';
  var htmlClipsOverflow = docOverflowX === 'hidden' || docOverflowX === 'clip';
  var bodyClipsOverflow = bodyOverflowX === 'hidden' || bodyOverflowX === 'clip';
  var rootClipsOverflow =
    htmlClipsOverflow || (docOverflowX === 'visible' && bodyClipsOverflow);

  var maxScrollHeight = Math.max(docScrollHeight, bodyScrollHeight, innerHeight);

  // Confirmed document-level horizontal scrolling requires unclipped document overflow.
  // Never rely solely on bodyScrollWidth when <html> clips horizontal overflow.
  var docOverflowPx = Math.max(0, docScrollWidth - configuredWidth);
  var hasHorizontalOverflow = !rootClipsOverflow && docScrollWidth > configuredWidth + tolerance;
  var maxHorizontalOverflowPx = hasHorizontalOverflow ? docOverflowPx : 0;

  function getSelector(el) {
    if (el.id) {
      return '#' + (window.CSS && window.CSS.escape ? window.CSS.escape(el.id) : el.id);
    }
    var tagName = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      var firstClass = el.className.trim().split(/\\s+/)[0];
      if (firstClass) {
        return tagName + '.' + (window.CSS && window.CSS.escape ? window.CSS.escape(firstClass) : firstClass);
      }
    }
    return tagName;
  }

  function isClippedByAncestor(el) {
    var parent = el.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      var parentStyle = window.getComputedStyle(parent);
      var ox = parentStyle.overflowX;
      if (ox === 'hidden' || ox === 'clip') {
        var pRect = parent.getBoundingClientRect();
        if (pRect.right <= configuredWidth + tolerance && pRect.left >= -tolerance) {
          return true;
        }
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function getEffectiveContainerWidth(el, fallbackWidth) {
    var parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      var parentStyle = window.getComputedStyle(parent);
      if (
        parentStyle &&
        parentStyle.display !== 'inline' &&
        parentStyle.display !== 'contents' &&
        parent.clientWidth > 0
      ) {
        return parent.clientWidth;
      }
      parent = parent.parentElement;
    }
    return fallbackWidth;
  }

  var candidateElements = [];
  var selectorList = 'main, header, nav, footer, section, article, aside, div, table, img, svg, form, input, button, select, .container, [class*="container"], [class*="card"], [class*="content"]';
  var allCandidates = Array.from(document.querySelectorAll(selectorList));
  var inspectedCount = 0;

  for (var i = 0; i < allCandidates.length; i++) {
    if (inspectedCount >= limit) {
      break;
    }
    inspectedCount++;

    var el = allCandidates[i];
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      (rect.width === 0 && rect.height === 0)
    ) {
      continue;
    }

    if (isClippedByAncestor(el)) {
      continue;
    }

    var tagName = el.tagName.toUpperCase();
    var selector = getSelector(el);
    var parentSelector = el.parentElement ? getSelector(el.parentElement) : undefined;

    // 1. Responsive image overflow (check before fixed-width so images are categorized accurately)
    if (tagName === 'IMG' || tagName === 'SVG') {
      var parentWidth = getEffectiveContainerWidth(el, configuredWidth);
      if (rect.width > configuredWidth + tolerance || el.clientWidth > parentWidth + tolerance) {
        var overflowPx = Math.max(rect.right - configuredWidth, el.clientWidth - parentWidth);
        if (overflowPx > tolerance) {
          candidateElements.push({
            selector: selector,
            tagName: tagName,
            id: el.id || undefined,
            className: typeof el.className === 'string' ? el.className : undefined,
            clientWidth: el.clientWidth,
            clientHeight: el.clientHeight,
            scrollWidth: el.scrollWidth,
            scrollHeight: el.scrollHeight,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            },
            overflowAmountPx: Math.round(overflowPx),
            overflowType: 'image-overflow',
            parentSelector: parentSelector,
            computedStyles: {
              maxWidth: style.maxWidth,
              display: style.display,
            },
          });
          continue;
        }
      }
    }

    // 2. Form controls / buttons overflow
    if (tagName === 'BUTTON' || tagName === 'INPUT' || tagName === 'SELECT') {
      var ctrlParentWidth = getEffectiveContainerWidth(el, configuredWidth);
      if (rect.right > configuredWidth + tolerance || el.clientWidth > ctrlParentWidth + tolerance) {
        var ctrlOverflowPx = Math.max(rect.right - configuredWidth, el.clientWidth - ctrlParentWidth);
        if (ctrlOverflowPx > tolerance) {
          candidateElements.push({
            selector: selector,
            tagName: tagName,
            id: el.id || undefined,
            className: typeof el.className === 'string' ? el.className : undefined,
            clientWidth: el.clientWidth,
            clientHeight: el.clientHeight,
            scrollWidth: el.scrollWidth,
            scrollHeight: el.scrollHeight,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            },
            overflowAmountPx: Math.round(ctrlOverflowPx),
            overflowType: 'control-overflow',
            parentSelector: parentSelector,
          });
          continue;
        }
      }
    }

    // 3. Text clipping / overflow
    if (
      el.scrollWidth > el.clientWidth + tolerance &&
      (style.whiteSpace === 'nowrap' || style.textOverflow === 'ellipsis') &&
      el.textContent &&
      el.textContent.trim().length > 0
    ) {
      candidateElements.push({
        selector: selector,
        tagName: tagName,
        id: el.id || undefined,
        className: typeof el.className === 'string' ? el.className : undefined,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
        boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        overflowAmountPx: Math.round(el.scrollWidth - el.clientWidth),
        overflowType: 'text-clipping',
        parentSelector: parentSelector,
        computedStyles: {
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow,
          overflowX: style.overflowX,
        },
      });
      continue;
    }

    // 4. Fixed width container overflow
    if (style.width && style.width.endsWith('px')) {
      var fixedPx = parseFloat(style.width);
      if (fixedPx > configuredWidth + tolerance && rect.right > configuredWidth + tolerance) {
        candidateElements.push({
          selector: selector,
          tagName: tagName,
          id: el.id || undefined,
          className: typeof el.className === 'string' ? el.className : undefined,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            right: rect.right,
            bottom: rect.bottom,
          },
          overflowAmountPx: Math.round(rect.right - configuredWidth),
          overflowType: 'fixed-width-overflow',
          parentSelector: parentSelector,
          computedStyles: {
            width: style.width,
            maxWidth: style.maxWidth,
            display: style.display,
            position: style.position,
          },
        });
        continue;
      }
    }

    // 5. General viewport boundary overflow
    if (rect.right > configuredWidth + tolerance) {
      candidateElements.push({
        selector: selector,
        tagName: tagName,
        id: el.id || undefined,
        className: typeof el.className === 'string' ? el.className : undefined,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
        boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        overflowAmountPx: Math.round(rect.right - configuredWidth),
        overflowType: 'viewport-horizontal-overflow',
        isFixedPosition: style.position === 'fixed',
        parentSelector: parentSelector,
        computedStyles: {
          width: style.width,
          maxWidth: style.maxWidth,
          position: style.position,
        },
      });
    }
  }

  return {
    windowInnerWidth: innerWidth,
    windowInnerHeight: innerHeight,
    documentScrollWidth: docScrollWidth,
    documentScrollHeight: docScrollHeight,
    bodyScrollWidth: bodyScrollWidth,
    bodyScrollHeight: bodyScrollHeight,
    hasHorizontalOverflow: hasHorizontalOverflow,
    maxHorizontalOverflowPx: maxHorizontalOverflowPx,
    documentOverflowX: docOverflowX,
    bodyOverflowX: bodyOverflowX,
    rootClipsOverflow: rootClipsOverflow,
    inspectedElementsCount: inspectedCount,
    candidateElements: candidateElements,
  };
})
`;

export class ResponsiveLayoutAnalyzer {
  private readonly tolerancePx: number;
  private readonly inspectionLimit: number;
  private readonly maxFindings: number;

  constructor(options: ResponsiveAnalyzerOptions = {}) {
    this.tolerancePx = options.overflowTolerancePx ?? DEFAULT_OVERFLOW_TOLERANCE_PX;
    this.inspectionLimit = options.elementInspectionLimit ?? DEFAULT_ELEMENT_INSPECTION_LIMIT;
    this.maxFindings = options.maxFindingsPerViewport ?? DEFAULT_MAX_FINDINGS_PER_VIEWPORT;
  }

  /**
   * Executes DOM evaluation on the page and returns measured metrics and identified overflowing elements.
   */
  public async analyzePage(
    page: Page,
    viewport: ViewportProfile,
    targetUrl: string,
    scanRunId = '00000000-0000-0000-0000-000000000000',
  ): Promise<{
    metrics: ResponsivePageMetrics;
    overflowingElements: readonly OverflowingElementInfo[];
    findings: readonly CreateFindingRequest[];
  }> {
    const rawResult: InBrowserEvaluationResult = await page.evaluate(
      `(${IN_BROWSER_EVALUATION_SCRIPT})(${JSON.stringify({
        tolerance: this.tolerancePx,
        limit: this.inspectionLimit,
        viewportWidth: viewport.width,
      })})`,
    );

    // Build metrics
    const metrics: ResponsivePageMetrics = {
      viewport,
      windowInnerWidth: rawResult.windowInnerWidth,
      windowInnerHeight: rawResult.windowInnerHeight,
      documentScrollWidth: rawResult.documentScrollWidth,
      documentScrollHeight: rawResult.documentScrollHeight,
      bodyScrollWidth: rawResult.bodyScrollWidth,
      bodyScrollHeight: rawResult.bodyScrollHeight,
      hasHorizontalOverflow: rawResult.hasHorizontalOverflow,
      maxHorizontalOverflowPx: rawResult.maxHorizontalOverflowPx,
      inspectedElementsCount: rawResult.inspectedElementsCount,
      overflowingElementsCount: rawResult.candidateElements.length,
    };

    // Deduplicate elements:
    // If a parent container has already been recorded with generic viewport overflow,
    // suppress its direct children that only exhibit generic viewport overflow to prevent cascade findings.
    // Specific defects (image-overflow, control-overflow, fixed-width-overflow, text-clipping) are retained as root causes.
    const parentSelectorsWithGenericOverflow = new Set(
      rawResult.candidateElements
        .filter(c => c.overflowType === 'viewport-horizontal-overflow')
        .map(c => c.selector)
        .filter(Boolean),
    );

    const deduplicatedElements: OverflowingElementInfo[] = [];
    for (const item of rawResult.candidateElements) {
      if (
        item.overflowType === 'viewport-horizontal-overflow' &&
        item.parentSelector &&
        parentSelectorsWithGenericOverflow.has(item.parentSelector)
      ) {
        // Child of an already recorded overflowing container with generic overflow - skip cascade duplicate
        continue;
      }
      deduplicatedElements.push({
        selector: item.selector,
        tagName: item.tagName,
        id: item.id,
        className: item.className,
        clientWidth: item.clientWidth,
        clientHeight: item.clientHeight,
        scrollWidth: item.scrollWidth,
        scrollHeight: item.scrollHeight,
        boundingBox: item.boundingBox,
        overflowAmountPx: item.overflowAmountPx,
        overflowType: item.overflowType,
        isFixedPosition: item.isFixedPosition,
        snippet: item.snippet,
        computedStyles: item.computedStyles,
      });
      if (deduplicatedElements.length >= this.maxFindings) {
        break;
      }
    }

    // Generate Findings
    const findings: CreateFindingRequest[] = [];

    // 1. Page-level horizontal overflow
    // Mathematically consistent validation:
    // Page-level horizontal overflow occurs ONLY when document/body scrollWidth
    // or a rendered element's viewport bounding box right edge extends beyond the viewport width.
    // Internal text-clipping or sub-container overflow inside the viewport boundary
    // does not cause document-level horizontal scrolling.
    const boundaryOverflowElements = deduplicatedElements.filter(
      el => el.boundingBox.right > viewport.width + this.tolerancePx,
    );
    const elementMaxBoundaryOverflow = boundaryOverflowElements.reduce(
      (max, el) => Math.max(max, Math.round(el.boundingBox.right - viewport.width)),
      0,
    );
    const rootClipsOverflow = rawResult.rootClipsOverflow;
    const docExceedsViewport = metrics.documentScrollWidth > viewport.width + this.tolerancePx;
    const bodyExceedsViewport = metrics.bodyScrollWidth > viewport.width + this.tolerancePx;
    const bodyOverflowPx = Math.max(0, Math.round(metrics.bodyScrollWidth - viewport.width));

    const isConfirmedHorizontalScroll =
      !rootClipsOverflow && (docExceedsViewport || boundaryOverflowElements.length > 0);
    const verifiedOverflowPx = isConfirmedHorizontalScroll
      ? Math.max(
          Math.max(0, Math.round(metrics.documentScrollWidth - viewport.width)),
          elementMaxBoundaryOverflow,
        )
      : 0;

    const finalMetrics: ResponsivePageMetrics = {
      ...metrics,
      hasHorizontalOverflow: isConfirmedHorizontalScroll && verifiedOverflowPx > this.tolerancePx,
      maxHorizontalOverflowPx: verifiedOverflowPx,
      documentOverflowX: rawResult.documentOverflowX,
      bodyOverflowX: rawResult.bodyOverflowX,
      rootClipsOverflow,
    };

    if (finalMetrics.hasHorizontalOverflow) {
      findings.push({
        scanRunId,
        ruleId: 'RESPONSIVE_HORIZONTAL_OVERFLOW',
        category: 'responsive-design',
        title: `Horizontal layout overflow (${verifiedOverflowPx}px) on ${viewport.name}`,
        description:
          `The document width exceeds the visible viewport (${viewport.width}px) by ` +
          `${verifiedOverflowPx}px, causing unwanted horizontal scrolling. ` +
          `Viewport: ${viewport.name} (${viewport.width}x${viewport.height}).`,
        severity: viewport.isMobile ? 'high' : 'medium',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl,
        evidence: {
          viewport: {
            id: viewport.id,
            name: viewport.name,
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: viewport.deviceScaleFactor,
          },
          windowInnerWidth: finalMetrics.windowInnerWidth,
          documentScrollWidth: finalMetrics.documentScrollWidth,
          bodyScrollWidth: finalMetrics.bodyScrollWidth,
          documentOverflowX: rawResult.documentOverflowX,
          bodyOverflowX: rawResult.bodyOverflowX,
          rootClipsOverflow,
          visibleHorizontalScrollEstablished: true,
          maxHorizontalOverflowPx: verifiedOverflowPx,
          overflowingElementsCount: boundaryOverflowElements.length,
          topOverflowingSelectors: boundaryOverflowElements.slice(0, 5).map(e => e.selector),
        },
        remediation:
          'Ensure all container elements use responsive width (e.g., max-width: 100%, box-sizing: border-box) ' +
          'and eliminate fixed-width declarations that exceed mobile viewports.',
      });
    } else if (bodyExceedsViewport && bodyOverflowPx > this.tolerancePx) {
      findings.push({
        scanRunId,
        ruleId: 'RESPONSIVE_HORIZONTAL_OVERFLOW',
        category: 'responsive-design',
        title: `Potential clipped horizontal overflow (${bodyOverflowPx}px body excess) on ${viewport.name}`,
        description:
          `Body scrollWidth (${finalMetrics.bodyScrollWidth}px) exceeds the ${viewport.width}px viewport by ` +
          `${bodyOverflowPx}px, while documentScrollWidth is ${finalMetrics.documentScrollWidth}px ` +
          `(html overflow-x: ${rawResult.documentOverflowX}, body overflow-x: ${rawResult.bodyOverflowX}). ` +
          `Visible document-level horizontal scrolling could not be established because root overflow is clipped.`,
        severity: 'low',
        confidence: 'potential',
        status: 'potential',
        targetUrl,
        evidence: {
          viewport: {
            id: viewport.id,
            name: viewport.name,
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: viewport.deviceScaleFactor,
          },
          windowInnerWidth: finalMetrics.windowInnerWidth,
          documentScrollWidth: finalMetrics.documentScrollWidth,
          bodyScrollWidth: finalMetrics.bodyScrollWidth,
          documentOverflowX: rawResult.documentOverflowX,
          bodyOverflowX: rawResult.bodyOverflowX,
          rootClipsOverflow,
          visibleHorizontalScrollEstablished: false,
          overflowClippedByRoot: true,
          bodyOverflowAmountPx: bodyOverflowPx,
          maxHorizontalOverflowPx: 0,
          overflowingElementsCount: boundaryOverflowElements.length,
          topOverflowingSelectors: boundaryOverflowElements.slice(0, 5).map(e => e.selector),
        },
        remediation:
          'Verify whether overflowing inner elements are intentionally clipped by html/body overflow-x rules or represent hidden content cropping on narrow viewports.',
      });
    }

    const isClippedAtRoot = rootClipsOverflow;

    // 2. Element-level findings
    for (const el of deduplicatedElements) {
      if (findings.length >= this.maxFindings) {
        break;
      }

      switch (el.overflowType) {
        case 'fixed-width-overflow':
          findings.push({
            scanRunId,
            ruleId: 'RESPONSIVE_FIXED_WIDTH_CONTAINER',
            category: 'responsive-design',
            title: `Fixed-width container exceeds viewport on ${viewport.name}`,
            description:
              `Element "${el.selector}" has a fixed width of ${el.computedStyles?.width ?? 'px'} ` +
              `which exceeds the viewport width (${viewport.width}px) by ${el.overflowAmountPx}px.`,
            severity: isClippedAtRoot ? 'low' : 'medium',
            confidence: isClippedAtRoot ? 'potential' : 'firm',
            status: isClippedAtRoot ? 'potential' : 'confirmed',
            targetUrl,
            evidence: {
              viewport: viewport.id,
              selector: el.selector,
              tagName: el.tagName,
              computedStyles: el.computedStyles,
              overflowAmountPx: el.overflowAmountPx,
              boundingBox: el.boundingBox,
              clippedByRoot: isClippedAtRoot,
            },
            remediation:
              'Replace fixed pixel widths with max-width: 100%, flexbox, or CSS grid layouts.',
          });
          break;

        case 'image-overflow':
          findings.push({
            scanRunId,
            ruleId: 'RESPONSIVE_IMAGE_OVERFLOW',
            category: 'responsive-design',
            title: `Responsive image exceeds viewport or container boundary`,
            description:
              `Image or media element "${el.selector}" overflows its container or viewport ` +
              `by ${el.overflowAmountPx}px at viewport ${viewport.name}.`,
            severity: isClippedAtRoot ? 'low' : 'medium',
            confidence: isClippedAtRoot ? 'potential' : 'confirmed',
            status: isClippedAtRoot ? 'potential' : 'confirmed',
            targetUrl,
            evidence: {
              viewport: viewport.id,
              selector: el.selector,
              tagName: el.tagName,
              overflowAmountPx: el.overflowAmountPx,
              boundingBox: el.boundingBox,
              clippedByRoot: isClippedAtRoot,
            },
            remediation:
              'Add "max-width: 100%; height: auto;" to image styles to ensure proportional scaling within parent containers.',
          });
          break;

        case 'control-overflow':
          findings.push({
            scanRunId,
            ruleId: 'RESPONSIVE_CONTROL_OVERFLOW',
            category: 'responsive-design',
            title: `Interactive control extends beyond container: ${el.selector}`,
            description:
              `Interactive form control or button "${el.selector}" overflows its container ` +
              `by ${el.overflowAmountPx}px at viewport ${viewport.name}.`,
            severity: 'low',
            confidence: 'potential',
            status: 'potential',
            targetUrl,
            evidence: {
              viewport: viewport.id,
              selector: el.selector,
              tagName: el.tagName,
              overflowAmountPx: el.overflowAmountPx,
              boundingBox: el.boundingBox,
              clippedByRoot: isClippedAtRoot,
            },
            remediation:
              'Ensure input fields and buttons have max-width: 100% and wrap gracefully on narrow viewports.',
          });
          break;

        case 'text-clipping':
          findings.push({
            scanRunId,
            ruleId: 'RESPONSIVE_TEXT_CLIPPED',
            category: 'responsive-design',
            title: `Text clipped or truncated: ${el.selector}`,
            description:
              `Text inside element "${el.selector}" overflows its visible width by ` +
              `${el.overflowAmountPx}px at viewport ${viewport.name}.`,
            severity: 'low',
            confidence: 'potential',
            status: 'potential',
            targetUrl,
            evidence: {
              viewport: viewport.id,
              selector: el.selector,
              tagName: el.tagName,
              overflowAmountPx: el.overflowAmountPx,
              computedStyles: el.computedStyles,
            },
            remediation:
              'Allow text to wrap naturally using "overflow-wrap: break-word" or adjust font size for smaller viewports.',
          });
          break;

        case 'viewport-horizontal-overflow':
        default:
          findings.push({
            scanRunId,
            ruleId: 'RESPONSIVE_ELEMENT_OVERFLOW',
            category: 'responsive-design',
            title: `Element extends beyond viewport boundary: ${el.selector}`,
            description:
              `Element "${el.selector}" extends ${el.overflowAmountPx}px beyond the right edge of ` +
              `viewport ${viewport.name} (${viewport.width}x${viewport.height}).`,
            severity: isClippedAtRoot ? 'low' : 'medium',
            confidence: isClippedAtRoot ? 'potential' : 'confirmed',
            status: isClippedAtRoot ? 'potential' : 'confirmed',
            targetUrl,
            evidence: {
              viewport: viewport.id,
              selector: el.selector,
              tagName: el.tagName,
              overflowAmountPx: el.overflowAmountPx,
              boundingBox: el.boundingBox,
              clippedByRoot: isClippedAtRoot,
            },
            remediation:
              'Constrain element width with max-width: 100% and check for negative margins or padding causing overflow.',
          });
          break;
      }
    }

    return {
      metrics: finalMetrics,
      overflowingElements: deduplicatedElements,
      findings,
    };
  }
}
