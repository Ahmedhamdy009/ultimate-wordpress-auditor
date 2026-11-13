/**
 * Standards-compliant RFC 9309 robots.txt Parser & Analysis Engine.
 * Evaluates crawler access, user-agent groups, path precedence, wildcard matching,
 * rule conflicts, and sitemap references.
 */

import { URL } from 'node:url';
import type { SafeHttpClient } from '../client/http-client.js';
import type { AnalyzerFinding } from '../analyzers/types.js';
import type { RobotsAnalysisResult, RobotsRuleGroup, SeoCoverageReport } from './types.js';

export interface ParsedRobotsRecord {
  readonly groups: readonly RobotsRuleGroup[];
  readonly sitemaps: readonly string[];
  readonly syntaxErrors: readonly string[];
}

/**
 * Checks if a path matches a robots.txt pattern supporting wildcard (*) and end anchor ($).
 */
export function matchesRobotsPattern(targetPath: string, pattern: string): boolean {
  if (pattern === '' || pattern === '/') {
    return targetPath.startsWith('/');
  }

  // Escape regex special chars except * and $
  let regexStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      regexStr += '.*';
    } else if (char === '$' && i === pattern.length - 1) {
      regexStr += '$';
    } else if (/[\\^.+?{}()[\]|]/.test(char)) {
      regexStr += `\\${char}`;
    } else {
      regexStr += char;
    }
  }

  if (!pattern.endsWith('$')) {
    regexStr += '.*';
  }

  try {
    const reg = new RegExp(regexStr);
    return reg.test(targetPath);
  } catch {
    return targetPath.startsWith(pattern);
  }
}

/**
 * Determines whether a target URL path is allowed according to RFC 9309 longest-match rules.
 */
export function isPathAllowed(
  targetPath: string,
  allows: readonly string[],
  disallows: readonly string[],
): { allowed: boolean; matchedPattern?: string; ruleType?: 'allow' | 'disallow' } {
  let longestMatchLength = -1;
  let ruleType: 'allow' | 'disallow' = 'allow';
  let matchedPattern: string | undefined;

  for (const allowPattern of allows) {
    if (matchesRobotsPattern(targetPath, allowPattern)) {
      if (allowPattern.length > longestMatchLength) {
        longestMatchLength = allowPattern.length;
        ruleType = 'allow';
        matchedPattern = allowPattern;
      }
    }
  }

  for (const disallowPattern of disallows) {
    if (matchesRobotsPattern(targetPath, disallowPattern)) {
      // RFC 9309: If allow and disallow have identical length, Allow takes precedence
      if (disallowPattern.length > longestMatchLength) {
        longestMatchLength = disallowPattern.length;
        ruleType = 'disallow';
        matchedPattern = disallowPattern;
      }
    }
  }

  return {
    allowed: ruleType === 'allow',
    matchedPattern,
    ruleType,
  };
}

/**
 * Parses raw robots.txt content according to RFC 9309.
 */
export function parseRobotsTxt(content: string): ParsedRobotsRecord {
  const lines = content.split(/\r?\n/);
  const groups: RobotsRuleGroup[] = [];
  const sitemaps: string[] = [];
  const syntaxErrors: string[] = [];

  let currentUserAgents: string[] = [];
  let currentAllows: string[] = [];
  let currentDisallows: string[] = [];
  let currentCrawlDelay: number | undefined;

  const flushGroup = () => {
    if (currentUserAgents.length > 0) {
      groups.push({
        userAgents: Object.freeze([...currentUserAgents]),
        allows: Object.freeze([...currentAllows]),
        disallows: Object.freeze([...currentDisallows]),
        crawlDelay: currentCrawlDelay,
      });
      currentUserAgents = [];
      currentAllows = [];
      currentDisallows = [];
      currentCrawlDelay = undefined;
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex].trim();
    // Strip comments
    const hashIndex = line.indexOf('#');
    if (hashIndex !== -1) {
      line = line.slice(0, hashIndex).trim();
    }
    if (!line) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      syntaxErrors.push(`Line ${lineIndex + 1}: Missing colon delimiter in directive "${line}"`);
      continue;
    }

    const directive = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (directive === 'user-agent') {
      if (currentAllows.length > 0 || currentDisallows.length > 0) {
        flushGroup();
      }
      if (value) {
        currentUserAgents.push(value.toLowerCase());
      }
    } else if (directive === 'allow') {
      if (currentUserAgents.length === 0) {
        syntaxErrors.push(`Line ${lineIndex + 1}: Allow directive declared before User-agent`);
        currentUserAgents.push('*');
      }
      if (value) {
        currentAllows.push(value);
      }
    } else if (directive === 'disallow') {
      if (currentUserAgents.length === 0) {
        syntaxErrors.push(`Line ${lineIndex + 1}: Disallow directive declared before User-agent`);
        currentUserAgents.push('*');
      }
      if (value) {
        currentDisallows.push(value);
      } else {
        // Disallow with empty value resets previous disallows in this group (means Allow all)
        currentDisallows = [];
      }
    } else if (directive === 'sitemap') {
      if (value) {
        sitemaps.push(value);
      }
    } else if (directive === 'crawl-delay') {
      const delay = parseFloat(value);
      if (!isNaN(delay) && delay >= 0) {
        currentCrawlDelay = delay;
      }
    } else {
      syntaxErrors.push(`Line ${lineIndex + 1}: Unknown directive "${directive}"`);
    }
  }

  flushGroup();

  return {
    groups: Object.freeze(groups),
    sitemaps: Object.freeze(sitemaps),
    syntaxErrors: Object.freeze(syntaxErrors),
  };
}

export class RobotsEngine {
  readonly id = 'robots-engine';
  readonly name = 'robots.txt Analysis Engine';

  /**
   * Fetches and analyzes the robots.txt file for a target origin.
   */
  async analyze(args: {
    entryUrl: string;
    authorizedOrigin: string;
    httpClient?: SafeHttpClient;
    signal?: AbortSignal;
    botUserAgent?: string;
    crawledUrls?: readonly string[];
  }): Promise<RobotsAnalysisResult> {
    const {
      authorizedOrigin,
      httpClient,
      signal,
      botUserAgent = 'WordPressAuditorBot',
      crawledUrls = [],
    } = args;
    const robotsUrl = `${authorizedOrigin.replace(/\/$/, '')}/robots.txt`;
    const findings: AnalyzerFinding[] = [];

    let coverage: SeoCoverageReport = {
      engine: 'robots',
      executed: true,
      status: 'full',
      itemsEvaluated: 1,
    };

    if (!httpClient) {
      return {
        exists: false,
        robotsUrl,
        sitemapDirectives: [],
        groups: [],
        effectiveRulesForAuditor: { matchedAgent: '*', allows: [], disallows: [] },
        findings: [],
        coverage: {
          engine: 'robots',
          executed: false,
          status: 'skipped',
          itemsEvaluated: 0,
          reason: 'No HTTP client provided to fetch robots.txt',
        },
      };
    }

    let responseText = '';
    let statusCode = 0;

    try {
      const response = await httpClient.request({
        url: robotsUrl,
        method: 'GET',
        signal,
      });

      statusCode = response.statusCode;
      if (statusCode >= 200 && statusCode < 300) {
        responseText = response.text();
      }
    } catch (err: unknown) {
      coverage = {
        engine: 'robots',
        executed: true,
        status: 'partial',
        itemsEvaluated: 0,
        reason: `Failed to fetch robots.txt: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 1. Missing or 404 robots.txt
    if (statusCode === 404 || !responseText.trim()) {
      findings.push({
        ruleId: 'SEO_ROBOTS_MISSING',
        category: 'technical-seo',
        title: 'robots.txt File Not Found (HTTP 404)',
        description: `No robots.txt file was detected at ${robotsUrl}. When absent, search engine crawlers assume unrestricted crawl access to the entire site.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: robotsUrl,
        evidence: { statusCode, robotsUrl, isOptional: true },
        remediation:
          'Create a robots.txt file at the site root to specify sitemap locations and prevent crawlers from indexing administrative or duplicate URL paths.',
        references: ['https://developers.google.com/search/docs/crawling-indexing/robots/intro'],
      });

      return {
        exists: false,
        robotsUrl,
        sitemapDirectives: [],
        groups: [],
        effectiveRulesForAuditor: { matchedAgent: '*', allows: [], disallows: [] },
        findings: Object.freeze(findings),
        coverage,
      };
    }

    // 2. Parse robots.txt
    const parsed = parseRobotsTxt(responseText);

    // 3. Find effective rule group for this auditor (prefer specific agent, fallback to *)
    const normalizedBot = botUserAgent.toLowerCase();
    let matchedGroup: RobotsRuleGroup | undefined;

    for (const group of parsed.groups) {
      if (group.userAgents.includes(normalizedBot)) {
        matchedGroup = group;
        break;
      }
    }

    if (!matchedGroup) {
      matchedGroup = parsed.groups.find(g => g.userAgents.includes('*'));
    }

    const effectiveAllows = matchedGroup?.allows ?? [];
    const effectiveDisallows = matchedGroup?.disallows ?? [];

    // 4. Check for Disallow All (Disallow: /)
    const disallowAllPattern = effectiveDisallows.find(d => d === '/' || d === '/*');
    if (disallowAllPattern && !effectiveAllows.some(a => a === '/' || a === '/*')) {
      findings.push({
        ruleId: 'SEO_ROBOTS_DISALLOW_ALL',
        category: 'technical-seo',
        title: 'Site-Wide Disallow Directive (Disallow: /) in robots.txt',
        description: `The robots.txt file specifies "Disallow: ${disallowAllPattern}", which instructs search engines not to crawl or index any page on this domain.`,
        severity: 'high',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: robotsUrl,
        evidence: {
          userAgent: matchedGroup?.userAgents.join(', ') ?? '*',
          disallowDirective: disallowAllPattern,
        },
        remediation:
          'If this website is intended for public indexing, remove the site-wide "Disallow: /" directive.',
        references: [
          'https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt',
        ],
      });
    }

    // 5. Check for Conflicting Allow / Disallow Rules on the same pattern
    if (matchedGroup) {
      const conflictSet = new Set<string>();
      for (const allow of matchedGroup.allows) {
        if (matchedGroup.disallows.includes(allow)) {
          conflictSet.add(allow);
        }
      }

      if (conflictSet.size > 0) {
        findings.push({
          ruleId: 'SEO_ROBOTS_CONFLICTING_RULES',
          category: 'technical-seo',
          title: `Conflicting Allow and Disallow Rules Declared (${conflictSet.size} pattern(s))`,
          description: `The robots.txt file declares identical path patterns in both Allow and Disallow directives (${Array.from(conflictSet).join(', ')}). Under RFC 9309, Allow takes precedence when pattern lengths are equal.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: robotsUrl,
          evidence: {
            conflictingPatterns: Array.from(conflictSet),
            precedence: 'Allow wins on equal match length per RFC 9309',
          },
          remediation:
            'Remove the redundant Disallow or Allow rule to avoid parser ambiguity across non-standard search engines.',
          references: ['https://datatracker.ietf.org/doc/html/rfc9309#section-2.2.2'],
        });
      }
    }

    // 6. Check for Malformed Directives / Syntax Errors
    if (parsed.syntaxErrors.length > 0) {
      findings.push({
        ruleId: 'SEO_ROBOTS_MALFORMED_SYNTAX',
        category: 'technical-seo',
        title: `Malformed Directives in robots.txt (${parsed.syntaxErrors.length} issue(s))`,
        description: `The robots.txt file contains unrecognized syntax or out-of-order directives that search engine parsers may ignore.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: robotsUrl,
        evidence: {
          syntaxErrors: parsed.syntaxErrors.slice(0, 10),
          totalErrors: parsed.syntaxErrors.length,
        },
        remediation: 'Review and fix the robots.txt syntax according to RFC 9309.',
        references: ['https://datatracker.ietf.org/doc/html/rfc9309'],
      });
    }

    // 7. Check if important crawled pages are blocked by robots.txt
    const blockedCrawledUrls: string[] = [];
    for (const url of crawledUrls) {
      try {
        const u = new URL(url);
        const path = u.pathname + u.search;
        const check = isPathAllowed(path, effectiveAllows, effectiveDisallows);
        if (!check.allowed) {
          blockedCrawledUrls.push(url);
        }
      } catch {
        // Skip invalid URL
      }
    }

    if (blockedCrawledUrls.length > 0) {
      findings.push({
        ruleId: 'SEO_ROBOTS_IMPORTANT_PAGE_BLOCKED',
        category: 'technical-seo',
        title: `Crawled Pages Blocked by robots.txt (${blockedCrawledUrls.length} page(s))`,
        description: `Discovered internal URLs are blocked from crawler access by robots.txt Disallow directives. While blocked pages can still be indexed if linked externally, their content cannot be crawled.`,
        severity: 'medium',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: blockedCrawledUrls[0],
        evidence: {
          blockedCount: blockedCrawledUrls.length,
          sampleUrls: blockedCrawledUrls.slice(0, 5),
          disallowDirectives: effectiveDisallows,
        },
        remediation:
          'Verify if these pages should be blocked. If they contain valuable public content, adjust Disallow directives or use <meta name="robots" content="noindex"> instead.',
        references: ['https://developers.google.com/search/docs/crawling-indexing/robots/intro'],
      });
    }

    return {
      exists: true,
      robotsUrl,
      sitemapDirectives: parsed.sitemaps,
      groups: parsed.groups,
      effectiveRulesForAuditor: {
        matchedAgent: matchedGroup?.userAgents.join(', ') ?? '*',
        allows: effectiveAllows,
        disallows: effectiveDisallows,
      },
      findings: Object.freeze(findings),
      coverage,
    };
  }
}
