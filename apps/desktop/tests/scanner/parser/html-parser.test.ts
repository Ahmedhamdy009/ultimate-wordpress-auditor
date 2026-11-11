import { describe, it, expect } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';

describe('HtmlParserEngine', () => {
  const pageUrl = 'https://example.com/blog/article-1';
  const authorizedOrigin = 'https://example.com';
  const engine = new HtmlParserEngine();

  describe('Document Metadata Extraction', () => {
    it('extracts complete metadata, OpenGraph, Twitter Card, and charset', () => {
      const html = `
        <!DOCTYPE html>
        <html lang="en-US" dir="ltr">
        <head>
          <meta charset="utf-8">
          <title>   My Awesome Blog Post   </title>
          <meta name="description" content="This is an in-depth article about web auditing.">
          <meta name="robots" content="index, follow">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="canonical" href="https://example.com/canonical-article">
          <meta property="og:title" content="OG Title">
          <meta property="og:description" content="OG Description">
          <meta property="og:image" content="https://example.com/image.png">
          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:creator" content="@auditor">
        </head>
        <body>
          <p>Hello world</p>
        </body>
        </html>
      `;

      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.structure.hasDoctype).toBe(true);
      expect(parsed.metadata.title).toBe('My Awesome Blog Post');
      expect(parsed.metadata.description).toBe('This is an in-depth article about web auditing.');
      expect(parsed.metadata.robots).toBe('index, follow');
      expect(parsed.metadata.canonical).toBe('https://example.com/canonical-article');
      expect(parsed.metadata.lang).toBe('en-US');
      expect(parsed.metadata.dir).toBe('ltr');
      expect(parsed.metadata.charset).toBe('utf-8');
      expect(parsed.metadata.viewport).toBe('width=device-width, initial-scale=1.0');
      expect(parsed.metadata.openGraph).toEqual({
        title: 'OG Title',
        description: 'OG Description',
        image: 'https://example.com/image.png',
      });
      expect(parsed.metadata.twitterCard).toEqual({
        card: 'summary_large_image',
        creator: '@auditor',
      });
    });

    it('extracts charset from http-equiv Content-Type', () => {
      const html = `
        <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">
        </head>
        <body></body>
        </html>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);
      expect(parsed.metadata.charset).toBe('iso-8859-1');
    });

    it('extracts meta refresh directive with delay and target URL', () => {
      const html = `
        <html>
        <head>
          <meta http-equiv="refresh" content="5; url=https://example.com/redirect-dest">
        </head>
        <body></body>
        </html>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);
      expect(parsed.structure.metaRefresh).toEqual({
        delaySeconds: 5,
        targetUrl: 'https://example.com/redirect-dest',
      });
    });
  });

  describe('Headings Hierarchy Extraction', () => {
    it('extracts headings in document order with levels and IDs', () => {
      const html = `
        <body>
          <h1 id="main-heading">Main <span>Title</span></h1>
          <p>Some text</p>
          <h2 id="sec-1">Section 1</h2>
          <h3>Subsection 1.1</h3>
          <h2>Section 2</h2>
          <h4>Deep Section</h4>
          <h5>Deeper Section</h5>
          <h6>Deepest Section</h6>
        </body>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.headings).toHaveLength(7);
      expect(parsed.headings[0]).toEqual({
        tag: 'h1',
        level: 1,
        text: 'Main Title',
        id: 'main-heading',
      });
      expect(parsed.headings[1]).toEqual({
        tag: 'h2',
        level: 2,
        text: 'Section 1',
        id: 'sec-1',
      });
      expect(parsed.headings[2]).toEqual({
        tag: 'h3',
        level: 3,
        text: 'Subsection 1.1',
        id: null,
      });
      expect(parsed.headings[3].level).toBe(2);
      expect(parsed.headings[4].level).toBe(4);
      expect(parsed.headings[5].level).toBe(5);
      expect(parsed.headings[6].level).toBe(6);
    });
  });

  describe('Links Extraction and Classification', () => {
    it('extracts links, normalizes relative URLs, and classifies internal vs external', () => {
      const html = `
        <body>
          <a href="/about" rel="author">About Us</a>
          <a href="../contact">Contact</a>
          <a href="https://example.com/pricing" target="_blank">Pricing</a>
          <a href="https://external-site.org/partner">External Partner</a>
          <a href="#top">Back to top</a>
          <a href="javascript:alert(1)">Click me</a>
          <a href="mailto:info@example.com">Email Us</a>
        </body>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.links).toHaveLength(7);

      // Root-relative internal
      expect(parsed.links[0]).toEqual({
        originalValue: '/about',
        resolvedUrl: 'https://example.com/about',
        text: 'About Us',
        rel: 'author',
        target: null,
        isInternal: true,
        isEligibleForCrawl: true,
        rejectionReason: undefined,
      });

      // Relative internal
      expect(parsed.links[1]).toEqual({
        originalValue: '../contact',
        resolvedUrl: 'https://example.com/contact',
        text: 'Contact',
        rel: null,
        target: null,
        isInternal: true,
        isEligibleForCrawl: true,
        rejectionReason: undefined,
      });

      // Absolute same-origin internal
      expect(parsed.links[2].isInternal).toBe(true);
      expect(parsed.links[2].isEligibleForCrawl).toBe(true);
      expect(parsed.links[2].target).toBe('_blank');

      // Cross-origin external
      expect(parsed.links[3].isInternal).toBe(false);
      expect(parsed.links[3].isEligibleForCrawl).toBe(false);
      expect(parsed.links[3].rejectionReason).toBe('EXTERNAL_ORIGIN');

      // Fragment-only
      expect(parsed.links[4].isEligibleForCrawl).toBe(false);
      expect(parsed.links[4].resolvedUrl).toBeNull();
      expect(parsed.links[4].rejectionReason).toBe('EMPTY_OR_FRAGMENT_ONLY');

      // Prohibited javascript: pseudo-protocol
      expect(parsed.links[5].isEligibleForCrawl).toBe(false);
      expect(parsed.links[5].resolvedUrl).toBeNull();
      expect(parsed.links[5].rejectionReason).toBe('INVALID_OR_DISALLOWED_PROTOCOL');

      // Mailto protocol
      expect(parsed.links[6].isEligibleForCrawl).toBe(false);
      expect(parsed.links[6].resolvedUrl).toBeNull();
      expect(parsed.links[6].rejectionReason).toBe('INVALID_OR_DISALLOWED_PROTOCOL');
    });
  });

  describe('Images & Responsive Sources', () => {
    it('extracts images with dimensions, alt text, loading, and lazy-load data attributes', () => {
      const html = `
        <body>
          <img src="/img/logo.png" alt="Company Logo" width="200" height="50" loading="lazy">
          <img data-src="/img/hero.webp" data-srcset="/img/hero-2x.webp 2x" alt="Hero">
          <img src="https://cdn.example.com/banner.jpg" srcset="banner-1x.jpg 1x, banner-2x.jpg 2x">
        </body>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.images).toHaveLength(3);
      expect(parsed.images[0]).toEqual({
        src: '/img/logo.png',
        srcset: null,
        dataSrc: null,
        dataSrcset: null,
        alt: 'Company Logo',
        width: '200',
        height: '50',
        loading: 'lazy',
      });
      expect(parsed.images[1]).toEqual({
        src: null,
        srcset: null,
        dataSrc: '/img/hero.webp',
        dataSrcset: '/img/hero-2x.webp 2x',
        alt: 'Hero',
        width: null,
        height: null,
        loading: null,
      });
      expect(parsed.images[2].srcset).toBe('banner-1x.jpg 1x, banner-2x.jpg 2x');
    });
  });

  describe('Media & Script/Stylesheet Resources', () => {
    it('extracts stylesheets, scripts, iframes, audio, and video elements', () => {
      const html = `
        <head>
          <link rel="stylesheet" href="/css/main.css" media="screen">
          <link rel="icon" href="/favicon.ico" sizes="32x32">
          <script src="/js/bundle.js" defer async type="module"></script>
        </head>
        <body>
          <iframe src="https://embedded.com/widget"></iframe>
          <audio src="/media/audio.mp3"></audio>
          <video src="/media/video.mp4" poster="/media/poster.jpg"></video>
        </body>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      const styles = parsed.resources.filter(r => r.type === 'stylesheet');
      expect(styles).toHaveLength(1);
      expect(styles[0].url).toBe('https://example.com/css/main.css');
      expect(styles[0].extra?.media).toBe('screen');

      const icons = parsed.resources.filter(r => r.type === 'icon');
      expect(icons).toHaveLength(1);
      expect(icons[0].url).toBe('https://example.com/favicon.ico');
      expect(icons[0].extra?.sizes).toBe('32x32');

      const scripts = parsed.resources.filter(r => r.type === 'script');
      expect(scripts).toHaveLength(1);
      expect(scripts[0].url).toBe('https://example.com/js/bundle.js');
      expect(scripts[0].extra?.async).toBe('true');
      expect(scripts[0].extra?.defer).toBe('true');

      const iframes = parsed.resources.filter(r => r.type === 'iframe');
      expect(iframes).toHaveLength(1);
      expect(iframes[0].url).toBe('https://embedded.com/widget');

      const videos = parsed.resources.filter(r => r.type === 'video');
      expect(videos).toHaveLength(1);
      expect(videos[0].extra?.poster).toBe('/media/poster.jpg');
    });
  });

  describe('Form Extraction & Security Protection', () => {
    it('extracts form structure and field metadata without capturing sensitive values', () => {
      const html = `
        <body>
          <form id="login-form" name="login" action="/login-handler" method="POST" enctype="multipart/form-data">
            <input type="text" name="username" id="user-field" required>
            <input type="password" name="password" value="SECRET_PASSWORD_DO_NOT_STORE" required>
            <textarea name="comment" disabled></textarea>
            <select name="country">
              <option value="us">United States</option>
            </select>
            <button type="submit">Sign In</button>
            <input type="reset" value="Clear">
          </form>
        </body>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.forms).toHaveLength(1);
      const form = parsed.forms[0];
      expect(form.id).toBe('login-form');
      expect(form.name).toBe('login');
      expect(form.action).toBe('https://example.com/login-handler');
      expect(form.method).toBe('post');
      expect(form.enctype).toBe('multipart/form-data');

      // 4 form fields
      expect(form.fields).toHaveLength(4);
      expect(form.fields[0]).toEqual({
        name: 'username',
        type: 'text',
        id: 'user-field',
        required: true,
        disabled: false,
      });
      // CRITICAL: password field must NOT contain any value property or value leak
      expect(form.fields[1]).toEqual({
        name: 'password',
        type: 'password',
        id: null,
        required: true,
        disabled: false,
      });
      expect((form.fields[1] as unknown as { value?: string }).value).toBeUndefined();

      expect(form.fields[2].type).toBe('textarea');
      expect(form.fields[2].disabled).toBe(true);

      expect(form.fields[3].type).toBe('select');

      // Buttons
      expect(form.buttons).toHaveLength(2);
      expect(form.buttons[0]).toEqual({
        type: 'submit',
        name: null,
        text: 'Sign In',
      });
      expect(form.buttons[1]).toEqual({
        type: 'reset',
        name: null,
        text: 'Clear',
      });
    });
  });

  describe('Security and Structure Analysis', () => {
    it('detects inline event handlers and collects all element IDs', () => {
      const html = `
        <body>
          <div id="wrapper">
            <button id="btn-1" onclick="doAction(event)">Click</button>
            <img id="img-1" src="/pic.png" onload="console.log('loaded')" onerror="handleError()">
          </div>
        </body>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.structure.elementIds).toContain('wrapper');
      expect(parsed.structure.elementIds).toContain('btn-1');
      expect(parsed.structure.elementIds).toContain('img-1');

      expect(parsed.structure.inlineEventHandlers).toHaveLength(3);
      expect(parsed.structure.inlineEventHandlers[0]).toEqual({
        tag: 'button',
        attribute: 'onclick',
        valueSnippet: 'doAction(event)',
      });
      expect(parsed.structure.inlineEventHandlers[1]).toEqual({
        tag: 'img',
        attribute: 'onload',
        valueSnippet: "console.log('loaded')",
      });
      expect(parsed.structure.inlineEventHandlers[2]).toEqual({
        tag: 'img',
        attribute: 'onerror',
        valueSnippet: 'handleError()',
      });
    });

    it('gracefully parses malformed, unclosed HTML and HTML entities', () => {
      const html = `
        <div>
          <h1>Unclosed Heading &amp; Title
          <p>Unclosed paragraph with <a href="/target">link &lt;test&gt;
        </div>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.headings).toHaveLength(1);
      expect(parsed.headings[0].text).toContain('Unclosed Heading & Title');
      expect(parsed.links).toHaveLength(1);
      expect(parsed.links[0].resolvedUrl).toBe('https://example.com/target');
      expect(parsed.metrics.totalNodes).toBeGreaterThan(0);
      expect(parsed.metrics.parseDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('enforces link and image collection limits', () => {
      let repeatedHtml = '<div>';
      for (let i = 0; i < 50; i++) {
        repeatedHtml += `<a href="/page-${i}">Link ${i}</a><img src="/img-${i}.jpg">`;
      }
      repeatedHtml += '</div>';

      const parsed = engine.parse(repeatedHtml, pageUrl, authorizedOrigin, {
        maxLinks: 5,
        maxImages: 3,
      });

      expect(parsed.links).toHaveLength(5);
      expect(parsed.images).toHaveLength(3);
    });
  });

  describe('Parser Tolerance & Real-World Malformed Markup Boundaries', () => {
    it('handles overlapping/misnested inline formatting tags gracefully', () => {
      // Demonstrates htmlparser2's tolerant AST vs full WHATWG Adoption Agency Algorithm:
      // In htmlparser2, closing </b> closes the enclosing branch, extracting declared <a> without AAA reopening.
      const html = '<div><b><a href="/nested-link">Link <i>Text</b> Extended</i></a></div>';
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.links).toHaveLength(1);
      expect(parsed.links[0].resolvedUrl).toBe('https://example.com/nested-link');
      expect(parsed.links[0].text).toBe('Link Text');
    });

    it('extracts unquoted and single-quoted attribute values correctly', () => {
      const html = `
        <div>
          <a href=/unquoted-path rel='author'>Unquoted Link</a>
          <img src='single-quoted.jpg' alt=UnquotedAlt>
        </div>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.links).toHaveLength(1);
      expect(parsed.links[0].resolvedUrl).toBe('https://example.com/unquoted-path');
      expect(parsed.links[0].rel).toBe('author');

      expect(parsed.images).toHaveLength(1);
      expect(parsed.images[0].src).toBe('single-quoted.jpg');
      expect(parsed.images[0].alt).toBe('UnquotedAlt');
    });

    it('does NOT extract links hidden inside HTML comments', () => {
      const html = `
        <div>
          <a href="/visible-link">Visible</a>
          <!-- <a href="/commented-out-secret">Secret</a> -->
        </div>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.links).toHaveLength(1);
      expect(parsed.links[0].resolvedUrl).toBe('https://example.com/visible-link');
      expect(parsed.links.some(l => l.originalValue.includes('secret'))).toBe(false);
    });

    it('extracts links embedded within inline SVG markup', () => {
      const html = `
        <div>
          <svg width="100" height="100">
            <a href="/svg-target">
              <text x="10" y="20">SVG Label</text>
            </a>
          </svg>
        </div>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);

      expect(parsed.links).toHaveLength(1);
      expect(parsed.links[0].resolvedUrl).toBe('https://example.com/svg-target');
      expect(parsed.links[0].text).toBe('SVG Label');
    });

    it('extracts metadata tags placed abnormally in body', () => {
      const html = `
        <html>
        <body>
          <meta name="description" content="Body placed description">
          <p>Content</p>
        </body>
        </html>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);
      expect(parsed.metadata.description).toBe('Body placed description');
    });

    it('counts visible words excluding head, script, style, and svg containers', () => {
      const html = `
        <html>
          <head><title>Five Words In Head Title</title><style>.hidden { color: red; }</style></head>
          <body>
            <h1>Main Heading</h1>
            <p>Body copy with <strong>important</strong> details.</p>
            <script>console.log('should not be counted at all');</script>
            <svg><text>SVG text ignored</text></svg>
          </body>
        </html>
      `;
      const parsed = engine.parse(html, pageUrl, authorizedOrigin);
      expect(parsed.visibleWordCount).toBe(7);
    });
  });
});
