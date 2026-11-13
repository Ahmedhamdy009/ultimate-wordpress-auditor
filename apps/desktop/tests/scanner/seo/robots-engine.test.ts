import { describe, it, expect, vi } from 'vitest';
import {
  parseRobotsTxt,
  matchesRobotsPattern,
  isPathAllowed,
  RobotsEngine,
} from '../../../src/main/scanner/seo/robots-engine.js';
import type { SafeHttpClient } from '../../../src/main/scanner/client/http-client.js';
import type { SafeHttpResponse } from '../../../src/main/scanner/client/types.js';

describe('Robots.txt Analysis Engine', () => {
  describe('matchesRobotsPattern', () => {
    it('matches exact and prefix paths correctly', () => {
      expect(matchesRobotsPattern('/admin/dashboard', '/admin')).toBe(true);
      expect(matchesRobotsPattern('/admin/dashboard', '/admin/')).toBe(true);
      expect(matchesRobotsPattern('/public/page', '/admin')).toBe(false);
    });

    it('handles wildcard patterns (*)', () => {
      expect(matchesRobotsPattern('/files/report.pdf', '/*.pdf')).toBe(true);
      expect(matchesRobotsPattern('/files/report.html', '/*.pdf')).toBe(false);
      expect(matchesRobotsPattern('/api/v1/users/list', '/api/*/users')).toBe(true);
    });

    it('handles end-anchor patterns ($)', () => {
      expect(matchesRobotsPattern('/secret.php', '/*.php$')).toBe(true);
      expect(matchesRobotsPattern('/secret.php?query=1', '/*.php$')).toBe(false);
      expect(matchesRobotsPattern('/exact-path', '/exact-path$')).toBe(true);
      expect(matchesRobotsPattern('/exact-path/', '/exact-path$')).toBe(false);
    });
  });

  describe('parseRobotsTxt & RFC 9309 precedence', () => {
    it('parses multiple user-agent groups, disallows, allows, comments and sitemaps', () => {
      const robotsContent = `
# Robots.txt for testing
User-agent: Googlebot
Disallow: /private/
Allow: /private/public-doc

User-agent: *
Disallow: /admin/
Disallow: /secret
Allow: /admin/login
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-news.xml
`;
      const parsed = parseRobotsTxt(robotsContent);

      expect(parsed.sitemaps).toEqual([
        'https://example.com/sitemap.xml',
        'https://example.com/sitemap-news.xml',
      ]);
      expect(parsed.groups).toHaveLength(2);
      expect(parsed.groups[0].userAgents).toContain('googlebot');
      expect(parsed.groups[1].userAgents).toContain('*');
      expect(parsed.syntaxErrors).toHaveLength(0);
    });

    it('treats standalone empty Disallow as disallowing nothing (RFC 9309 §2.2.1)', () => {
      const robotsContent = `
User-agent: *
Disallow:
`;
      const parsed = parseRobotsTxt(robotsContent);
      expect(parsed.groups[0].disallows).toHaveLength(0);
    });

    it('does not erase previously declared Disallow directives when followed by empty Disallow (RFC 9309 §2.2.1)', () => {
      const robotsContent = `
User-agent: *
Disallow: /private
Disallow:
`;
      const parsed = parseRobotsTxt(robotsContent);
      expect(parsed.groups[0].disallows).toEqual(['/private']);

      const checkPrivate = isPathAllowed('/private/data', [], parsed.groups[0].disallows);
      expect(checkPrivate.allowed).toBe(false);

      const checkPublic = isPathAllowed('/public/data', [], parsed.groups[0].disallows);
      expect(checkPublic.allowed).toBe(true);
    });

    it('preserves subsequent Disallow directives when preceded by empty Disallow (RFC 9309 §2.2.1)', () => {
      const robotsContent = `
User-agent: *
Disallow:
Disallow: /restricted
`;
      const parsed = parseRobotsTxt(robotsContent);
      expect(parsed.groups[0].disallows).toEqual(['/restricted']);

      const checkRestricted = isPathAllowed('/restricted/file', [], parsed.groups[0].disallows);
      expect(checkRestricted.allowed).toBe(false);
    });

    it('applies longest-match precedence rule (RFC 9309 §2.2.2)', () => {
      const allows = ['/page'];
      const disallows = ['/p'];

      // /page matches /page (len 5) and /p (len 2). Allow is longer -> allowed.
      expect(isPathAllowed('/page', allows, disallows).allowed).toBe(true);

      // /path matches only /p (len 2) -> disallowed.
      expect(isPathAllowed('/path', allows, disallows).allowed).toBe(false);
    });

    it('defaults to allow when allow and disallow have identical length (RFC 9309)', () => {
      const allows = ['/exact'];
      const disallows = ['/exact'];
      expect(isPathAllowed('/exact', allows, disallows).allowed).toBe(true);
    });

    it('detects syntax errors in malformed directives', () => {
      const robotsContent = `
User-agent: *
InvalidDirectiveNoColon
Disallow: /valid
`;
      const parsed = parseRobotsTxt(robotsContent);
      expect(parsed.syntaxErrors.length).toBeGreaterThan(0);
      expect(parsed.syntaxErrors[0]).toContain('InvalidDirectiveNoColon');
    });
  });

  describe('RobotsEngine.analyze', () => {
    const mockHttpClient = (status: number, body: string): SafeHttpClient =>
      ({
        request: vi.fn().mockResolvedValue({
          statusCode: status,
          headers: { 'content-type': 'text/plain' },
          text: () => body,
        } as unknown as SafeHttpResponse),
      }) as unknown as SafeHttpClient;

    it('handles missing robots.txt (404) gracefully with informative finding', async () => {
      const engine = new RobotsEngine();
      const client = mockHttpClient(404, 'Not Found');

      const result = await engine.analyze({
        authorizedOrigin: 'https://example.com',
        httpClient: client,
        crawledUrls: ['https://example.com/'],
      });

      expect(result.exists).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].ruleId).toBe('SEO_ROBOTS_MISSING');
      expect(result.findings[0].severity).toBe('info');
    });

    it('detects site-wide Disallow: / as high severity finding', async () => {
      const engine = new RobotsEngine();
      const client = mockHttpClient(200, `User-agent: *\nDisallow: /\n`);

      const result = await engine.analyze({
        authorizedOrigin: 'https://example.com',
        httpClient: client,
      });

      expect(result.exists).toBe(true);
      const disallowAll = result.findings.find(f => f.ruleId === 'SEO_ROBOTS_DISALLOW_ALL');
      expect(disallowAll).toBeDefined();
      expect(disallowAll?.severity).toBe('high');
      expect(disallowAll?.confidence).toBe('confirmed');
    });

    it('detects conflicting rules and malformed syntax', async () => {
      const engine = new RobotsEngine();
      const client = mockHttpClient(
        200,
        `User-agent: *\nAllow: /catalog\nDisallow: /catalog\nCorruptedLineHere\n`,
      );

      const result = await engine.analyze({
        authorizedOrigin: 'https://example.com',
        httpClient: client,
      });

      const conflictFinding = result.findings.find(
        f => f.ruleId === 'SEO_ROBOTS_CONFLICTING_RULES',
      );
      expect(conflictFinding).toBeDefined();

      const syntaxFinding = result.findings.find(f => f.ruleId === 'SEO_ROBOTS_MALFORMED_SYNTAX');
      expect(syntaxFinding).toBeDefined();
    });

    it('detects crawled pages that are blocked by robots.txt rules', async () => {
      const engine = new RobotsEngine();
      const client = mockHttpClient(200, `User-agent: *\nDisallow: /private-area/\n`);

      const result = await engine.analyze({
        authorizedOrigin: 'https://example.com',
        httpClient: client,
        crawledUrls: [
          'https://example.com/',
          'https://example.com/about',
          'https://example.com/private-area/secret-doc',
        ],
      });

      const blockedFinding = result.findings.find(
        f => f.ruleId === 'SEO_ROBOTS_IMPORTANT_PAGE_BLOCKED',
      );
      expect(blockedFinding).toBeDefined();
      expect(blockedFinding?.evidence?.sampleUrls).toContain(
        'https://example.com/private-area/secret-doc',
      );
    });

    it('returns skipped coverage when no HTTP client is provided', async () => {
      const engine = new RobotsEngine();
      const result = await engine.analyze({
        authorizedOrigin: 'https://example.com',
      });

      expect(result.coverage.executed).toBe(false);
      expect(result.coverage.status).toBe('skipped');
    });
  });
});
