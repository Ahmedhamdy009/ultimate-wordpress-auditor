import { describe, it, expect } from 'vitest';
import { SecurityHeadersAnalyzer } from '../../../src/main/scanner/analyzers/security-headers-analyzer.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';
import type { TlsConnectionMetadata } from '../../../src/main/scanner/client/types.js';

describe('SecurityHeadersAnalyzer', () => {
  const analyzer = new SecurityHeadersAnalyzer();
  const context = {
    authorizedOrigin: 'https://example.com',
    entryUrl: 'https://example.com/',
  };

  const createPage = (
    headers: Record<string, string | string[]> = {},
    url = 'https://example.com/',
    tlsOverrides: TlsConnectionMetadata | null = null,
  ): CrawledPageResult => {
    return {
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      statusMessage: 'OK',
      headers,
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
      durationMs: 100,
      depth: 0,
      parentUrl: null,
      encodedBodyBytes: 500,
      decompressedBodyBytes: 500,
      parsedDocument: null,
      tls: tlsOverrides,
    };
  };

  it('detects missing HSTS on HTTPS endpoints', () => {
    const page = createPage({}, 'https://example.com/');
    const result = analyzer.analyzePage(page, context);

    const hstsFinding = result.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_MISSING');
    expect(hstsFinding).toBeDefined();
    expect(hstsFinding?.severity).toBe('medium');
    expect(hstsFinding?.confidence).toBe('confirmed');
  });

  it('does NOT evaluate HSTS on plain HTTP endpoints', () => {
    const page = createPage({}, 'http://example.com/');
    const result = analyzer.analyzePage(page, {
      authorizedOrigin: 'http://example.com',
      entryUrl: 'http://example.com/',
    });

    expect(result.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_MISSING')).toBe(false);
  });

  it('detects weak HSTS max-age and accurately classifies missing includeSubDomains as informational', () => {
    const page = createPage({
      'strict-transport-security': 'max-age=86400', // only 1 day
    });
    const result = analyzer.analyzePage(page, context);

    const weakAge = result.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_WEAK' && f.title.includes('Too Short'),
    );
    expect(weakAge).toBeDefined();
    expect(weakAge?.severity).toBe('low');
    expect(weakAge?.description).toContain('internal heuristic');

    const missingSub = result.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_NO_SUBDOMAINS');
    expect(missingSub).toBeDefined();
    expect(missingSub?.severity).toBe('info');
    expect(missingSub?.title).toBe('HSTS Header Missing includeSubDomains Directive');
    expect(missingSub?.description).toContain(
      'Subdomains of https://example.com/ are not automatically protected',
    );
  });

  it('correctly distinguishes internal 120-day threshold from official hstspreload.org 1-year requirement', () => {
    // 1. max-age below 120 days (86400s) -> flags SEC_HEADER_HSTS_WEAK
    const pageUnder120 = createPage({
      'strict-transport-security': 'max-age=86400; includeSubDomains',
    });
    const resUnder120 = analyzer.analyzePage(pageUnder120, context);
    expect(resUnder120.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBe(true);

    // 2. max-age exactly 120 days (10,368,000s) -> does NOT flag SEC_HEADER_HSTS_WEAK
    const pageExactly120 = createPage({
      'strict-transport-security': 'max-age=10368000; includeSubDomains',
    });
    const resExactly120 = analyzer.analyzePage(pageExactly120, context);
    expect(resExactly120.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBe(false);

    // 3. max-age below 1 year (180 days: 15,552,000s) with includeSubDomains and preload
    //    -> does NOT flag SEC_HEADER_HSTS_WEAK, flags SEC_HEADER_HSTS_PRELOAD_INELIGIBLE
    const page180DaysPreload = createPage({
      'strict-transport-security': 'max-age=15552000; includeSubDomains; preload',
    });
    const res180Days = analyzer.analyzePage(page180DaysPreload, context);
    expect(res180Days.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBe(false);
    const ineligibleFinding = res180Days.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_INELIGIBLE',
    );
    expect(ineligibleFinding).toBeDefined();
    expect(ineligibleFinding?.severity).toBe('info');
    expect(ineligibleFinding?.description).toContain('below the 31,536,000s (1 year) requirement');

    // 4. max-age exactly 31,536,000s (1 year) with includeSubDomains and preload
    //    -> flags SEC_HEADER_HSTS_PRELOAD_ELIGIBLE
    const pageExactly1Year = createPage({
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
    });
    const res1Year = analyzer.analyzePage(pageExactly1Year, context);
    const eligible1Year = res1Year.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE',
    );
    expect(eligible1Year).toBeDefined();
    expect(eligible1Year?.severity).toBe('info');
    expect(eligible1Year?.title).toBe('HSTS Preload Eligibility Indicators Present');
    // Ensure no claim of actual preload list membership is made
    expect(eligible1Year?.description).toContain(
      'actual inclusion in browser preload lists requires explicit domain submission to hstspreload.org',
    );
    expect(eligible1Year?.description).not.toContain('is included in the preload list');

    // 5. max-age above 1 year (2 years: 63,072,000s) with includeSubDomains and preload
    //    -> flags SEC_HEADER_HSTS_PRELOAD_ELIGIBLE
    const page2Years = createPage({
      'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    });
    const res2Years = analyzer.analyzePage(page2Years, context);
    expect(res2Years.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      true,
    );

    // 6. Missing includeSubDomains -> flags SEC_HEADER_HSTS_NO_SUBDOMAINS
    const pageNoSub = createPage({
      'strict-transport-security': 'max-age=31536000; preload',
    });
    const resNoSub = analyzer.analyzePage(pageNoSub, context);
    expect(resNoSub.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_NO_SUBDOMAINS')).toBe(true);

    // 7. Missing preload directive when max-age >= 1 year and includeSubDomains
    //    -> flags SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED
    const pageNoPreload = createPage({
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    });
    const resNoPreload = analyzer.analyzePage(pageNoPreload, context);
    const noPreloadFinding = resNoPreload.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED',
    );
    expect(noPreloadFinding).toBeDefined();
    expect(noPreloadFinding?.severity).toBe('info');
    expect(noPreloadFinding?.title).toBe('HSTS Preload Directive Not Declared');

    // 8. Plain HTTP response -> HSTS is not evaluated
    const pageHttp = createPage(
      {
        'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
      },
      'http://example.com/',
    );
    const resHttp = analyzer.analyzePage(pageHttp, {
      authorizedOrigin: 'http://example.com',
      entryUrl: 'http://example.com/',
    });
    expect(resHttp.findings.some(f => f.ruleId.startsWith('SEC_HEADER_HSTS_'))).toBe(false);
  });

  it('performs strict, exact HSTS directive parsing and handles malformed/duplicate directives conservatively', () => {
    // 1. Valid preload directive
    const pageValidPreload = createPage({
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
    });
    const resValidPreload = analyzer.analyzePage(pageValidPreload, context);
    expect(
      resValidPreload.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE'),
    ).toBe(true);

    // 2. Substring false positive test: "notpreload" must NOT be treated as "preload"
    const pageNotPreload = createPage({
      'strict-transport-security': 'max-age=31536000; includeSubDomains; notpreload',
    });
    const resNotPreload = analyzer.analyzePage(pageNotPreload, context);
    expect(resNotPreload.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      false,
    );
    expect(
      resNotPreload.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED'),
    ).toBe(true);

    // 3. Valid includeSubDomains directive
    const pageValidSub = createPage({
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
    });
    const resValidSub = analyzer.analyzePage(pageValidSub, context);
    expect(resValidSub.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_NO_SUBDOMAINS')).toBe(
      false,
    );

    // 4. Substring false positive test: "notincludesubdomains" must NOT be treated as "includeSubDomains"
    const pageNotSub = createPage({
      'strict-transport-security': 'max-age=31536000; notincludesubdomains',
    });
    const resNotSub = analyzer.analyzePage(pageNotSub, context);
    expect(resNotSub.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_NO_SUBDOMAINS')).toBe(true);

    // 5. Whitespace and case variations: arbitrary whitespace and mixed case must parse cleanly
    const pageWhitespaceCase = createPage({
      'strict-transport-security': '   MAX-AGE = 31536000  ;  INCLUDESUBDOMAINS  ;   PRELOAD   ;  ',
    });
    const resWhitespaceCase = analyzer.analyzePage(pageWhitespaceCase, context);
    expect(
      resWhitespaceCase.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE'),
    ).toBe(true);
    expect(resWhitespaceCase.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED')).toBe(
      false,
    );

    // 6. Missing max-age: RFC 6797 requires max-age
    const pageMissingMaxAge = createPage({
      'strict-transport-security': 'includeSubDomains; preload',
    });
    const resMissingMaxAge = analyzer.analyzePage(pageMissingMaxAge, context);
    const missingMaxAgeFinding = resMissingMaxAge.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED',
    );
    expect(missingMaxAgeFinding).toBeDefined();
    expect(missingMaxAgeFinding?.description).toContain('Missing required "max-age" directive');
    expect(
      resMissingMaxAge.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE'),
    ).toBe(false);

    // 7. Malformed max-age: non-numeric or negative values must be rejected
    const pageMalformedMaxAge = createPage({
      'strict-transport-security': 'max-age=notanumber; includeSubDomains',
    });
    const resMalformedMaxAge = analyzer.analyzePage(pageMalformedMaxAge, context);
    const malformedFinding = resMalformedMaxAge.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED',
    );
    expect(malformedFinding).toBeDefined();
    expect(malformedFinding?.description).toContain('Malformed "max-age" value');
    expect(resMalformedMaxAge.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBe(false);

    // 8. Duplicate max-age directives: conservative handling invalidates max-age
    const pageDuplicateMaxAge = createPage({
      'strict-transport-security': 'max-age=31536000; max-age=10368000; includeSubDomains; preload',
    });
    const resDuplicateMaxAge = analyzer.analyzePage(pageDuplicateMaxAge, context);
    const duplicateFinding = resDuplicateMaxAge.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED',
    );
    expect(duplicateFinding).toBeDefined();
    expect(duplicateFinding?.description).toContain('Duplicate "max-age" directive');
    expect(
      resDuplicateMaxAge.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE'),
    ).toBe(false);
    expect(resDuplicateMaxAge.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBe(false);

    // 9. Invalid directive formatting: missing directive name before "="
    const pageInvalidFormat = createPage({
      'strict-transport-security': '=31536000; includeSubDomains',
    });
    const resInvalidFormat = analyzer.analyzePage(pageInvalidFormat, context);
    const formatFinding = resInvalidFormat.findings.find(
      f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED',
    );
    expect(formatFinding).toBeDefined();
    expect(formatFinding?.description).toContain('missing directive name');
  });

  it('validates RFC 6797 quoted max-age, duplicate directives, and extension directives', () => {
    // Helper to compare finding semantics independent of literal rawHeader string
    const normalizeFindings = (findings: typeof resUnquoted.findings) =>
      findings.map(f => ({
        ...f,
        evidence: f.evidence ? { ...f.evidence, rawHeader: undefined } : undefined,
      }));

    // 1. Quoted max-age and unquoted max-age produce identical evaluation results
    const pageUnquoted = createPage({
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
    });
    const pageQuoted = createPage({
      'strict-transport-security': 'max-age="31536000"; includeSubDomains; preload',
    });
    const resUnquoted = analyzer.analyzePage(pageUnquoted, context);
    const resQuoted = analyzer.analyzePage(pageQuoted, context);

    expect(resUnquoted.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      true,
    );
    expect(resQuoted.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      true,
    );
    expect(normalizeFindings(resUnquoted.findings)).toEqual(normalizeFindings(resQuoted.findings));

    // 2. Valid zero max-age (unquoted and quoted)
    const pageZeroUnquoted = createPage({
      'strict-transport-security': 'max-age=0; includeSubDomains',
    });
    const pageZeroQuoted = createPage({
      'strict-transport-security': 'max-age="0"; includeSubDomains',
    });
    const resZeroUnquoted = analyzer.analyzePage(pageZeroUnquoted, context);
    const resZeroQuoted = analyzer.analyzePage(pageZeroQuoted, context);
    expect(resZeroUnquoted.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBe(true);
    expect(resZeroQuoted.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBe(true);
    expect(normalizeFindings(resZeroUnquoted.findings)).toEqual(
      normalizeFindings(resZeroQuoted.findings),
    );

    // 3. Mixed case and surrounding whitespace with quotes
    const pageMixedCaseQuoted = createPage({
      'strict-transport-security': '  MaX-AgE = "31536000" ;  InClUdEsUbDoMaInS ;  PreLoad  ',
    });
    const resMixedCase = analyzer.analyzePage(pageMixedCaseQuoted, context);
    expect(resMixedCase.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      true,
    );
    expect(resMixedCase.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED')).toBe(false);

    // 4. Malformed quoted strings (unclosed, misplaced quote, unescaped interior quote)
    const pageUnclosedQuote = createPage({
      'strict-transport-security': 'max-age="31536000; includeSubDomains',
    });
    const resUnclosed = analyzer.analyzePage(pageUnclosedQuote, context);
    expect(
      resUnclosed.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('Malformed unclosed quoted string'),
      ),
    ).toBe(true);

    const pageMisplacedQuote = createPage({
      'strict-transport-security': 'max-age=31536000"; includeSubDomains',
    });
    const resMisplaced = analyzer.analyzePage(pageMisplacedQuote, context);
    expect(
      resMisplaced.findings.some(
        f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' && f.description.includes('misplaced quote'),
      ),
    ).toBe(true);

    const pagePrematureQuote = createPage({
      'strict-transport-security': 'max-age="3153"extra"; includeSubDomains',
    });
    const resPremature = analyzer.analyzePage(pagePrematureQuote, context);
    expect(
      resPremature.findings.some(
        f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' && f.description.includes('unescaped quote'),
      ),
    ).toBe(true);

    // 5. Duplicate includeSubDomains directive
    const pageDupSub = createPage({
      'strict-transport-security':
        'max-age=31536000; includeSubDomains; includeSubDomains; preload',
    });
    const resDupSub = analyzer.analyzePage(pageDupSub, context);
    expect(
      resDupSub.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('Duplicate "includesubdomains" directive'),
      ),
    ).toBe(true);
    // Malformed duplicate must suppress misleading preload eligibility
    expect(resDupSub.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      false,
    );

    // 6. Duplicate preload directive (case-insensitive)
    const pageDupPreload = createPage({
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload; PRELOAD',
    });
    const resDupPreload = analyzer.analyzePage(pageDupPreload, context);
    expect(
      resDupPreload.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('Duplicate "preload" directive'),
      ),
    ).toBe(true);
    expect(resDupPreload.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      false,
    );

    // 7. Duplicate max-age with different values
    const pageDupMaxAgeDiff = createPage({
      'strict-transport-security': 'max-age=100; max-age=200; includeSubDomains',
    });
    const resDupMaxAgeDiff = analyzer.analyzePage(pageDupMaxAgeDiff, context);
    expect(
      resDupMaxAgeDiff.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('Duplicate "max-age" directive'),
      ),
    ).toBe(true);

    // 8. Empty max-age value (empty token or empty quotes)
    const pageEmptyMaxAgeToken = createPage({
      'strict-transport-security': 'max-age=; includeSubDomains',
    });
    const resEmptyToken = analyzer.analyzePage(pageEmptyMaxAgeToken, context);
    expect(
      resEmptyToken.findings.some(
        f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' && f.description.includes('Empty value'),
      ),
    ).toBe(true);

    const pageEmptyMaxAgeQuotes = createPage({
      'strict-transport-security': 'max-age=""; includeSubDomains',
    });
    const resEmptyQuotes = analyzer.analyzePage(pageEmptyMaxAgeQuotes, context);
    expect(
      resEmptyQuotes.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('Malformed "max-age" value'),
      ),
    ).toBe(true);

    // 9. Negative and decimal max-age
    const pageNegativeMaxAge = createPage({
      'strict-transport-security': 'max-age=-3600; includeSubDomains',
    });
    const resNegative = analyzer.analyzePage(pageNegativeMaxAge, context);
    expect(
      resNegative.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('Malformed "max-age" value'),
      ),
    ).toBe(true);

    const pageDecimalMaxAge = createPage({
      'strict-transport-security': 'max-age=31536000.5; includeSubDomains',
    });
    const resDecimal = analyzer.analyzePage(pageDecimalMaxAge, context);
    expect(
      resDecimal.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('Malformed "max-age" value'),
      ),
    ).toBe(true);

    // 10. Values exceeding Number.MAX_SAFE_INTEGER
    const pageExcessiveMaxAge = createPage({
      'strict-transport-security': 'max-age=99999999999999999999; includeSubDomains',
    });
    const resExcessive = analyzer.analyzePage(pageExcessiveMaxAge, context);
    expect(
      resExcessive.findings.some(
        f =>
          f.ruleId === 'SEC_HEADER_HSTS_MALFORMED' &&
          f.description.includes('exceeds maximum safe integer'),
      ),
    ).toBe(true);

    // 11. Syntactically valid unknown extension directives per RFC 6797 are safely ignored
    const pageUnknownExt = createPage({
      'strict-transport-security':
        'max-age=31536000; includeSubDomains; preload; custom-ext="custom-val"; custom-flag',
    });
    const resUnknownExt = analyzer.analyzePage(pageUnknownExt, context);
    expect(resUnknownExt.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED')).toBe(false);
    expect(resUnknownExt.findings.some(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBe(
      true,
    );
  });

  it('detects missing CSP and flaggy directives, but respects nonces over unsafe-inline', () => {
    // 1. Missing CSP
    const pageNoCsp = createPage({});
    const resNoCsp = analyzer.analyzePage(pageNoCsp, context);
    expect(resNoCsp.findings.some(f => f.ruleId === 'SEC_HEADER_CSP_MISSING')).toBe(true);

    // 2. Unsafe inline without nonce
    const pageUnsafe = createPage({
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    });
    const resUnsafe = analyzer.analyzePage(pageUnsafe, context);
    expect(resUnsafe.findings.some(f => f.ruleId === 'SEC_HEADER_CSP_UNSAFE_INLINE')).toBe(true);
    expect(resUnsafe.findings.some(f => f.ruleId === 'SEC_HEADER_CSP_UNSAFE_EVAL')).toBe(true);

    // 3. Unsafe inline WITH cryptographic nonce (under CSP Level 3, nonces override unsafe-inline)
    const pageWithNonce = createPage({
      'content-security-policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'nonce-rAnd0m12345'",
    });
    const resWithNonce = analyzer.analyzePage(pageWithNonce, context);
    expect(resWithNonce.findings.some(f => f.ruleId === 'SEC_HEADER_CSP_UNSAFE_INLINE')).toBe(
      false,
    );

    // 4. Report-only CSP
    const pageReportOnly = createPage({
      'content-security-policy-report-only': "default-src 'self'",
    });
    const resReportOnly = analyzer.analyzePage(pageReportOnly, context);
    expect(resReportOnly.findings.some(f => f.ruleId === 'SEC_HEADER_CSP_REPORT_ONLY')).toBe(true);
  });

  it('detects missing X-Content-Type-Options: nosniff', () => {
    const pageMissing = createPage({});
    const resMissing = analyzer.analyzePage(pageMissing, context);
    expect(
      resMissing.findings.some(f => f.ruleId === 'SEC_HEADER_X_CONTENT_TYPE_OPTIONS_MISSING'),
    ).toBe(true);

    const pageValid = createPage({
      'x-content-type-options': 'nosniff',
    });
    const resValid = analyzer.analyzePage(pageValid, context);
    expect(
      resValid.findings.some(f => f.ruleId === 'SEC_HEADER_X_CONTENT_TYPE_OPTIONS_MISSING'),
    ).toBe(false);
  });

  it('correctly evaluates framing protection and avoids reporting missing XFO when CSP frame-ancestors is present', () => {
    // 1. Missing both XFO and frame-ancestors
    const pageMissing = createPage({});
    const resMissing = analyzer.analyzePage(pageMissing, context);
    expect(resMissing.findings.some(f => f.ruleId === 'SEC_HEADER_X_FRAME_OPTIONS_MISSING')).toBe(
      true,
    );

    // 2. XFO present
    const pageWithXfo = createPage({
      'x-frame-options': 'SAMEORIGIN',
    });
    const resWithXfo = analyzer.analyzePage(pageWithXfo, context);
    expect(resWithXfo.findings.some(f => f.ruleId === 'SEC_HEADER_X_FRAME_OPTIONS_MISSING')).toBe(
      false,
    );

    // 3. CSP frame-ancestors 'self' present without XFO (modern standard supercedes XFO)
    const pageWithCspFraming = createPage({
      'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
    });
    const resWithCspFraming = analyzer.analyzePage(pageWithCspFraming, context);
    expect(
      resWithCspFraming.findings.some(f => f.ruleId === 'SEC_HEADER_X_FRAME_OPTIONS_MISSING'),
    ).toBe(false);
  });

  it('evaluates Referrer-Policy and Permissions-Policy with appropriate informational severities', () => {
    const pageMissing = createPage({});
    const resMissing = analyzer.analyzePage(pageMissing, context);
    const permFinding = resMissing.findings.find(
      f => f.ruleId === 'SEC_HEADER_PERMISSIONS_POLICY_MISSING',
    );
    expect(permFinding).toBeDefined();
    expect(permFinding?.severity).toBe('info');
    expect(permFinding?.category).toBe('security');
    expect(permFinding?.title).toBe('No Permissions-Policy Header Declared');

    const pageUnsafeRef = createPage({
      'referrer-policy': 'unsafe-url',
    });
    const resUnsafeRef = analyzer.analyzePage(pageUnsafeRef, context);
    expect(resUnsafeRef.findings.some(f => f.ruleId === 'SEC_HEADER_REFERRER_POLICY_UNSAFE')).toBe(
      true,
    );
  });

  it('evaluates TLS protocols, weak ciphers, and certificate expiration', () => {
    // 1. Deprecated TLS 1.0
    const pageOldTls = createPage({}, 'https://example.com/', {
      protocol: 'TLSv1',
      cipher: {
        name: 'AES128-SHA',
        standardName: 'TLS_RSA_WITH_AES_128_CBC_SHA',
        version: 'TLSv1',
      },
      authorized: true,
    });
    const resOldTls = analyzer.analyzePage(pageOldTls, context);
    expect(resOldTls.findings.some(f => f.ruleId === 'SEC_TLS_DEPRECATED_PROTOCOL')).toBe(true);

    // 2. Weak Cipher Suite
    const pageWeakCipher = createPage({}, 'https://example.com/', {
      protocol: 'TLSv1.2',
      cipher: { name: 'RC4-MD5', standardName: 'SSL_RSA_WITH_RC4_128_MD5', version: 'TLSv1.2' },
      authorized: true,
    });
    const resWeakCipher = analyzer.analyzePage(pageWeakCipher, context);
    expect(resWeakCipher.findings.some(f => f.ruleId === 'SEC_TLS_WEAK_CIPHER')).toBe(true);

    // 3. Expired Certificate
    const pageExpired = createPage({}, 'https://example.com/', {
      protocol: 'TLSv1.3',
      cipher: {
        name: 'TLS_AES_256_GCM_SHA384',
        standardName: 'TLS_AES_256_GCM_SHA384',
        version: 'TLSv1.3',
      },
      authorized: false,
      authorizationError: 'CERT_HAS_EXPIRED',
      peerCertificate: {
        subject: { CN: 'example.com' },
        issuer: { O: 'Example CA' },
        validFrom: 'Jan 1 2025',
        validTo: 'Jan 1 2026',
        daysUntilExpiration: -30,
      },
    });
    const resExpired = analyzer.analyzePage(pageExpired, context);
    expect(resExpired.findings.some(f => f.ruleId === 'SEC_TLS_CERT_INVALID')).toBe(true);
    expect(resExpired.findings.some(f => f.ruleId === 'SEC_TLS_CERT_EXPIRED')).toBe(true);
  });

  it('evaluates SameSite=None without Secure and rejects unsafe configurations', () => {
    const page = createPage({
      'set-cookie': 'tracking_pref=ad_opt_in; SameSite=None; path=/',
    });
    const res = analyzer.analyzePage(page, context);

    const noneInsecure = res.findings.find(f => f.ruleId === 'SEC_COOKIE_SAMESITE_NONE_INSECURE');
    expect(noneInsecure).toBeDefined();
    expect(noneInsecure?.severity).toBe('medium');
    expect(noneInsecure?.title).toContain('SameSite=None Cookie Declared Without Secure Flag');
  });

  it('audits cookie security flags and strictly prevents secret exposure in adversarial scenario', () => {
    const REALISTIC_JWT =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFobWVkIn0.s3cr3t_s1gn4tur3_h4sh';
    const REALISTIC_SESSION_ID = 'sess_01HZX87K99MMPQ44VBGTR8832X_TOP_SECRET_SESSION_TOKEN';
    const REALISTIC_PASSWORD_HASH = '$2b$12$e8Y4L/y2aB8j4Q5mK1o9euP1O0aB5cD4eF6gH8iJ0kL2mN4oP6qR8s';

    const page = createPage({
      'set-cookie': [
        `session_token=${REALISTIC_SESSION_ID}; path=/`,
        `auth_jwt=${REALISTIC_JWT}; path=/; SameSite=Lax`,
        `user_auth=${REALISTIC_PASSWORD_HASH}; path=/; Secure`,
      ],
    });

    const result = analyzer.analyzePage(page, context);

    // 1. Sensitive cookie lacking HttpOnly is reported as a potential issue
    const httpOnlyFinding = result.findings.find(
      f => f.ruleId === 'SEC_COOKIE_NO_HTTPONLY' && f.title.includes('session_token'),
    );
    expect(httpOnlyFinding).toBeDefined();
    expect(httpOnlyFinding?.confidence).toBe('potential');
    expect(httpOnlyFinding?.status).toBe('potential');

    // 2. CRITICAL AUDIT ASSERTION: Neither JWT, session id, nor password hash must ever exist in findings!
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(REALISTIC_JWT);
    expect(serialized).not.toContain(REALISTIC_SESSION_ID);
    expect(serialized).not.toContain(REALISTIC_PASSWORD_HASH);
    expect(serialized).not.toContain('s3cr3t_s1gn4tur3');
    expect(serialized).not.toContain('TOP_SECRET_SESSION_TOKEN');
  });
});
