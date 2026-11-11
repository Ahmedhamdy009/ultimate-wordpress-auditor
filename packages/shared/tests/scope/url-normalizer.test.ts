import { describe, it, expect } from 'vitest';
import {
  normalizeCrawlUrl,
  isSameOrigin,
  classifyDiscoveredLink,
  MAX_CRAWL_URL_LENGTH,
} from '../../src/scope/url-normalizer.js';

describe('URL Normalization & Scope Safety Engine', () => {
  describe('normalizeCrawlUrl', () => {
    it('normalizes simple absolute HTTP and HTTPS URLs', () => {
      const resHttp = normalizeCrawlUrl('http://example.com/blog');
      expect(resHttp).not.toBeNull();
      expect(resHttp!.href).toBe('http://example.com/blog');
      expect(resHttp!.origin).toBe('http://example.com');
      expect(resHttp!.protocol).toBe('http:');
      expect(resHttp!.hostname).toBe('example.com');
      expect(resHttp!.port).toBe(80);
      expect(resHttp!.pathname).toBe('/blog');
      expect(resHttp!.search).toBe('');

      const resHttps = normalizeCrawlUrl('https://example.com/products');
      expect(resHttps).not.toBeNull();
      expect(resHttps!.href).toBe('https://example.com/products');
      expect(resHttps!.origin).toBe('https://example.com');
      expect(resHttps!.port).toBe(443);
    });

    it('resolves relative URLs against a base URL', () => {
      const base = 'https://example.com/shop/categories/';
      const res = normalizeCrawlUrl('../cart?item=123', base);
      expect(res).not.toBeNull();
      expect(res!.href).toBe('https://example.com/shop/cart?item=123');
      expect(res!.pathname).toBe('/shop/cart');
      expect(res!.search).toBe('?item=123');
    });

    it('resolves root-relative URLs against a base URL', () => {
      const base = 'https://example.com/shop/categories/';
      const res = normalizeCrawlUrl('/about-us', base);
      expect(res).not.toBeNull();
      expect(res!.href).toBe('https://example.com/about-us');
      expect(res!.pathname).toBe('/about-us');
    });

    it('resolves protocol-relative URLs against base URL scheme', () => {
      const base = 'https://example.com/page';
      const res = normalizeCrawlUrl('//cdn.example.com/assets', base);
      expect(res).not.toBeNull();
      expect(res!.href).toBe('https://cdn.example.com/assets');
      expect(res!.origin).toBe('https://cdn.example.com');
    });

    it('strips fragment identifiers while preserving path and query', () => {
      const res = normalizeCrawlUrl('https://example.com/article?page=1#heading-2');
      expect(res).not.toBeNull();
      expect(res!.href).toBe('https://example.com/article?page=1');
      expect(res!.search).toBe('?page=1');
      expect(res!.href).not.toContain('#');
    });

    it('preserves query parameters and their ordering/semantics', () => {
      const url = 'https://example.com/search?q=wordpress&sort=date&filter=active';
      const res = normalizeCrawlUrl(url);
      expect(res).not.toBeNull();
      expect(res!.href).toBe(url);
      expect(res!.search).toBe('?q=wordpress&sort=date&filter=active');
    });

    it('removes default ports (:80 for HTTP, :443 for HTTPS)', () => {
      const httpRes = normalizeCrawlUrl('http://example.com:80/index.html');
      expect(httpRes!.href).toBe('http://example.com/index.html');
      expect(httpRes!.port).toBe(80);

      const httpsRes = normalizeCrawlUrl('https://example.com:443/secure.html');
      expect(httpsRes!.href).toBe('https://example.com/secure.html');
      expect(httpsRes!.port).toBe(443);
    });

    it('preserves non-default ports in origin and href', () => {
      const res = normalizeCrawlUrl('https://example.com:8443/admin');
      expect(res!.href).toBe('https://example.com:8443/admin');
      expect(res!.origin).toBe('https://example.com:8443');
      expect(res!.port).toBe(8443);
    });

    it('normalizes dot segments in pathnames', () => {
      const res = normalizeCrawlUrl('https://example.com/a/b/../c/./d');
      expect(res!.pathname).toBe('/a/c/d');
      expect(res!.href).toBe('https://example.com/a/c/d');
    });

    it('lowercases domain names while preserving path casing', () => {
      const res = normalizeCrawlUrl('https://ExAmPLe.CoM/CaseSensitivePath');
      expect(res!.hostname).toBe('example.com');
      expect(res!.pathname).toBe('/CaseSensitivePath');
    });

    it('strictly rejects embedded credentials (username and password)', () => {
      expect(normalizeCrawlUrl('http://admin:secret@example.com/login')).toBeNull();
      expect(normalizeCrawlUrl('https://user@example.com/dashboard')).toBeNull();
      expect(normalizeCrawlUrl('http://:secret@example.com/')).toBeNull();
    });

    it('strictly rejects prohibited URI schemes', () => {
      expect(normalizeCrawlUrl('javascript:alert(1)')).toBeNull();
      expect(normalizeCrawlUrl('data:text/html,<h1>bad</h1>')).toBeNull();
      expect(normalizeCrawlUrl('file:///etc/passwd')).toBeNull();
      expect(normalizeCrawlUrl('mailto:admin@example.com')).toBeNull();
      expect(normalizeCrawlUrl('tel:+1234567890')).toBeNull();
      expect(normalizeCrawlUrl('blob:https://example.com/uuid')).toBeNull();
      expect(normalizeCrawlUrl('vbscript:msgbox(1)')).toBeNull();
      expect(normalizeCrawlUrl('ftp://example.com/file.zip')).toBeNull();
    });

    it('rejects URLs exceeding maximum permitted length', () => {
      const hugePath = 'a'.repeat(MAX_CRAWL_URL_LENGTH + 10);
      expect(normalizeCrawlUrl(`https://example.com/${hugePath}`)).toBeNull();
    });

    it('handles canonical bracketed IPv6 destinations', () => {
      const res = normalizeCrawlUrl('http://[2606:2800:220:1:248:1893:25c8:1946]:8080/path');
      expect(res).not.toBeNull();
      expect(res!.hostname).toBe('[2606:2800:0220:0001:0248:1893:25c8:1946]');
      expect(res!.port).toBe(8080);
    });
  });

  describe('isSameOrigin', () => {
    it('returns true for matching protocol, host, and port', () => {
      expect(isSameOrigin('https://example.com/a', 'https://example.com/b?q=1')).toBe(true);
      expect(isSameOrigin('http://example.com:80/a', 'http://example.com/b')).toBe(true);
      expect(isSameOrigin('https://example.com:443/a', 'https://example.com/b')).toBe(true);
    });

    it('returns false for different protocols (HTTP vs HTTPS)', () => {
      expect(isSameOrigin('http://example.com/a', 'https://example.com/a')).toBe(false);
    });

    it('returns false for different hostnames or subdomains', () => {
      expect(isSameOrigin('https://blog.example.com', 'https://example.com')).toBe(false);
      expect(isSameOrigin('https://example.com', 'https://other-site.com')).toBe(false);
    });

    it('returns false for different ports', () => {
      expect(isSameOrigin('https://example.com:8443', 'https://example.com:9443')).toBe(false);
    });

    it('returns false when either URL is invalid', () => {
      expect(isSameOrigin('invalid-url', 'https://example.com')).toBe(false);
      expect(isSameOrigin('javascript:void(0)', 'https://example.com')).toBe(false);
    });
  });

  describe('classifyDiscoveredLink', () => {
    const authorizedOrigin = 'https://audit-target.com';
    const sourcePage = 'https://audit-target.com/blog/article-1';

    it('classifies relative internal links as eligible for crawling', () => {
      const res = classifyDiscoveredLink('../article-2', sourcePage, authorizedOrigin);
      expect(res.isInternal).toBe(true);
      expect(res.isEligibleForCrawl).toBe(true);
      expect(res.resolvedUrl).toBe('https://audit-target.com/article-2');
      expect(res.rejectionReason).toBeUndefined();
    });

    it('classifies absolute same-origin links as eligible', () => {
      const res = classifyDiscoveredLink(
        'https://audit-target.com/contact',
        sourcePage,
        authorizedOrigin,
      );
      expect(res.isInternal).toBe(true);
      expect(res.isEligibleForCrawl).toBe(true);
      expect(res.resolvedUrl).toBe('https://audit-target.com/contact');
    });

    it('classifies cross-origin external links as not eligible for crawl', () => {
      const res = classifyDiscoveredLink(
        'https://external-partner.com/docs',
        sourcePage,
        authorizedOrigin,
      );
      expect(res.isInternal).toBe(false);
      expect(res.isEligibleForCrawl).toBe(false);
      expect(res.resolvedUrl).toBe('https://external-partner.com/docs');
      expect(res.rejectionReason).toBe('EXTERNAL_ORIGIN');
    });

    it('classifies anchor fragment-only links as not eligible', () => {
      const res = classifyDiscoveredLink('#section-1', sourcePage, authorizedOrigin);
      expect(res.isEligibleForCrawl).toBe(false);
      expect(res.resolvedUrl).toBeNull();
      expect(res.rejectionReason).toBe('EMPTY_OR_FRAGMENT_ONLY');
    });

    it('classifies javascript: pseudo-protocol as rejected', () => {
      const res = classifyDiscoveredLink('javascript:void(0)', sourcePage, authorizedOrigin);
      expect(res.isEligibleForCrawl).toBe(false);
      expect(res.resolvedUrl).toBeNull();
      expect(res.rejectionReason).toBe('INVALID_OR_DISALLOWED_PROTOCOL');
    });
  });
});
