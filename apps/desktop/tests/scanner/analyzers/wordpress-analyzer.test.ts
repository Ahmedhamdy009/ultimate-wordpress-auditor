import { describe, it, expect } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';
import { WordPressAnalyzer } from '../../../src/main/scanner/analyzers/wordpress-analyzer.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('WordPressAnalyzer', () => {
  const analyzer = new WordPressAnalyzer();
  const context = {
    authorizedOrigin: 'https://example.com',
    entryUrl: 'https://example.com/',
  };

  const createPage = (
    html: string,
    headers: Record<string, string | string[]> = {},
    url = 'https://example.com/',
  ): CrawledPageResult => {
    const parsedDoc = HtmlParserEngine.parseHtml(html, url, 'https://example.com');
    return {
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      statusMessage: 'OK',
      headers,
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
      durationMs: 120,
      depth: 0,
      parentUrl: null,
      encodedBodyBytes: html.length,
      decompressedBodyBytes: html.length,
      parsedDocument: parsedDoc,
    };
  };

  it('identifies WordPress strongly when generator meta is corroborated by asset paths', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Corroborated WP Site</title>
        <meta name="generator" content="WordPress 6.4.2" />
        <link rel="stylesheet" href="/wp-content/themes/twentytwentyfour/style.css" />
      </head>
      <body><h1>Welcome</h1></body>
      </html>
    `;

    const page = createPage(html);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(true);
    expect(result.data.confidence).toBe('confirmed');
    expect(result.data.version).toBe('6.4.2');
    expect(result.data.versionSource).toBe('meta[name=generator]');

    const detectedFinding = result.findings.find(f => f.ruleId === 'WP_DETECTED');
    expect(detectedFinding).toBeDefined();
    expect(detectedFinding?.severity).toBe('info');
    expect(detectedFinding?.confidence).toBe('confirmed');
    expect(detectedFinding?.title).toBe('WordPress Content Management System Strongly Identified');

    const versionFinding = result.findings.find(f => f.ruleId === 'WP_VERSION_DISCLOSED');
    expect(versionFinding).toBeDefined();
    expect(versionFinding?.severity).toBe('low');
    expect(versionFinding?.confidence).toBe('firm');
    expect(versionFinding?.status).toBe('confirmed');
    expect(versionFinding?.evidence).toMatchObject({ version: '6.4.2' });
  });

  it('classifies isolated generator meta as potential WordPress with firm confidence', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Isolated Generator</title>
        <meta name="generator" content="WordPress 5.9" />
      </head>
      <body><h1>Static HTML</h1></body>
      </html>
    `;

    const page = createPage(html);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(true);
    expect(result.data.confidence).toBe('firm');
    expect(result.data.version).toBe('5.9');

    const detected = result.findings.find(f => f.ruleId === 'WP_DETECTED');
    expect(detected?.title).toBe('Potential WordPress Content Management System Detected');
    expect(detected?.status).toBe('potential');
  });

  it('detects WordPress without version if generator tag does not disclose version', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="generator" content="WordPress" />
        <link rel="stylesheet" href="/wp-content/themes/custom/style.css" />
      </head>
      <body><h1>WP Site</h1></body>
      </html>
    `;

    const page = createPage(html);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(true);
    expect(result.data.version).toBeNull();
    expect(result.findings.some(f => f.ruleId === 'WP_DETECTED')).toBe(true);
    expect(result.findings.some(f => f.ruleId === 'WP_VERSION_DISCLOSED')).toBe(false);
  });

  it('detects themes and plugins from asset resource paths', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <link rel="stylesheet" href="/wp-content/themes/astra/style.css" />
        <script src="/wp-content/plugins/woocommerce/assets/js/frontend.js"></script>
        <script src="/wp-includes/js/jquery/jquery.min.js"></script>
      </head>
      <body><h1>Shop</h1></body>
      </html>
    `;

    const page = createPage(html);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(true);
    expect(result.data.detectedThemes).toContain('astra');
    expect(result.data.detectedPlugins).toContain('woocommerce');
    expect(result.findings.some(f => f.ruleId === 'WP_DETECTED')).toBe(true);
  });

  it('correctly reports advertised XML-RPC pingback and REST API linkage without overstating reachability', () => {
    const html = `<!DOCTYPE html><html><body><h1>API Site</h1></body></html>`;
    const headers = {
      'x-pingback': 'https://example.com/xmlrpc.php',
      link: '<https://example.com/wp-json/>; rel="https://api.w.org/"',
    };

    const page = createPage(html, headers);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(true);
    expect(result.data.hasXmlRpc).toBe(true);
    expect(result.data.hasRestApi).toBe(true);
    expect(result.data.restApiEndpoint).toBe('https://example.com/wp-json/');

    const xmlRpcFinding = result.findings.find(f => f.ruleId === 'WP_XMLRPC_PINGBACK_ADVERTISED');
    expect(xmlRpcFinding).toBeDefined();
    expect(xmlRpcFinding?.title).toBe('WordPress XML-RPC Pingback Interface Advertised');
    expect(xmlRpcFinding?.severity).toBe('info');
    expect(xmlRpcFinding?.confidence).toBe('firm');
    expect(xmlRpcFinding?.status).toBe('potential');
    expect(xmlRpcFinding?.description).toContain(
      'passive analysis does not verify whether the endpoint is enabled or reachable',
    );

    const restFinding = result.findings.find(f => f.ruleId === 'WP_REST_API_ADVERTISED');
    expect(restFinding).toBeDefined();
    expect(restFinding?.title).toBe('WordPress REST API Linkage Advertised');
    expect(restFinding?.severity).toBe('info');
    expect(restFinding?.confidence).toBe('firm');
    expect(restFinding?.status).toBe('potential');
    expect(restFinding?.description).toContain(
      'passive analysis does not verify whether the endpoint is publicly active or reachable',
    );
  });

  it('detects WordPress cookies from Set-Cookie header', () => {
    const html = `<!DOCTYPE html><html><body><h1>Members</h1></body></html>`;
    const headers = {
      'set-cookie': [
        'wordpress_test_cookie=WP+Cookie+check; path=/',
        'wp-settings-1=editor%3Dtinymce; path=/',
      ],
    };

    const page = createPage(html, headers);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(true);
    expect(result.data.signals.some(s => s.signal === 'COOKIE_WP_MARKER')).toBe(true);
  });

  it('does NOT classify a site as WordPress on a single isolated tentative link', () => {
    // E.g., a tutorial article linking to an external wp-login.php
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Tutorial</title></head>
      <body>
        <h1>How to Secure Your Login</h1>
        <p>Reference article about <a href="https://other-site.com/wp-login.php">WordPress logins</a>.</p>
      </body>
      </html>
    `;

    const page = createPage(html);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(false);
    expect(result.data.confidence).toBe('low');
    expect(result.findings.length).toBe(0);
  });

  it('correctly reports non-WordPress site when no WordPress indicators are present', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Static Page</title>
        <meta name="generator" content="Next.js" />
        <link rel="stylesheet" href="/_next/static/css/app.css" />
      </head>
      <body>
        <h1>Static React Site</h1>
        <a href="/about">About</a>
      </body>
      </html>
    `;

    const page = createPage(html);
    const result = analyzer.analyzePage(page, context);

    expect(result.data.isWordPress).toBe(false);
    expect(result.data.version).toBeNull();
    expect(result.data.detectedThemes.length).toBe(0);
    expect(result.data.detectedPlugins.length).toBe(0);
    expect(result.findings.length).toBe(0);
  });
});
