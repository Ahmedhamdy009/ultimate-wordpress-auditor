/**
 * Page-Level Structured Data / Schema.org Analyzer.
 * Extracts and validates JSON-LD blocks on individual crawled pages.
 */

import type { CrawledPageResult } from '../crawler/types.js';
import { StructuredDataEngine } from '../seo/structured-data-engine.js';
import type { PageStructuredDataResult } from '../seo/types.js';
import type { AnalyzerContext, PageAnalysisResult, PageAnalyzer } from './types.js';

export class StructuredDataAnalyzer implements PageAnalyzer<PageStructuredDataResult> {
  readonly id = 'structured-data-analyzer';
  readonly name = 'Structured Data & Schema.org Analyzer';

  private readonly engine = new StructuredDataEngine();

  analyzePage(
    page: CrawledPageResult,
    _context: AnalyzerContext,
  ): PageAnalysisResult<PageStructuredDataResult> {
    if (!page.parsedDocument) {
      return { findings: [] };
    }

    const jsonLdScripts = page.parsedDocument.jsonLdScripts ?? [];
    if (jsonLdScripts.length === 0) {
      return { findings: [] };
    }

    const result = this.engine.analyzePage(jsonLdScripts, page.requestedUrl);
    return {
      findings: result.findings,
      data: result,
    };
  }
}
