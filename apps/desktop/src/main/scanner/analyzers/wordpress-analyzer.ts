/**
 * WordPress Detection Analyzer.
 * Passively identifies WordPress CMS presence, declared versions, detected themes/plugins,
 * REST API endpoints, and pingback interfaces without probing or aggressive requests.
 */

import type { FindingConfidence } from '@auditor/shared';
import type { CrawledPageResult } from '../crawler/types.js';
import type {
  AnalyzerContext,
  AnalyzerFinding,
  PageAnalysisResult,
  PageAnalyzer,
} from './types.js';

export interface WordPressSignal {
  readonly signal: string;
  readonly evidence: string;
  readonly confidence: FindingConfidence;
}

export interface WordPressDetectionData {
  readonly isWordPress: boolean;
  readonly confidence: FindingConfidence;
  readonly version: string | null;
  readonly versionSource?: string;
  readonly detectedThemes: readonly string[];
  readonly detectedPlugins: readonly string[];
  readonly hasRestApi: boolean;
  readonly restApiEndpoint?: string;
  readonly hasXmlRpc: boolean;
  readonly signals: readonly WordPressSignal[];
}

export class WordPressAnalyzer implements PageAnalyzer<WordPressDetectionData> {
  readonly id = 'wordpress-detector';
  readonly name = 'WordPress Detection Analyzer';

  analyzePage(
    page: CrawledPageResult,
    _context: AnalyzerContext,
  ): PageAnalysisResult<WordPressDetectionData> {
    const signals: WordPressSignal[] = [];
    const detectedThemes = new Set<string>();
    const detectedPlugins = new Set<string>();
    let version: string | null = null;
    let versionSource: string | undefined;
    let hasRestApi = false;
    let restApiEndpoint: string | undefined;
    let hasXmlRpc = false;

    const headers = page.headers || {};
    const parsedDoc = page.parsedDocument;

    // 1. Inspect Response Headers
    // A. X-Pingback header
    const pingback = headers['x-pingback'];
    if (typeof pingback === 'string' && pingback.includes('xmlrpc.php')) {
      hasXmlRpc = true;
      signals.push({
        signal: 'HEADER_X_PINGBACK',
        evidence: `X-Pingback: ${pingback.trim()}`,
        confidence: 'firm',
      });
    }

    // B. Link header with https://api.w.org/
    const linkHeader = headers['link'];
    if (typeof linkHeader === 'string' && linkHeader.includes('api.w.org')) {
      hasRestApi = true;
      const match = linkHeader.match(/<([^>]+)>;\s*rel="https:\/\/api\.w\.org\/"/i);
      if (match) {
        restApiEndpoint = match[1];
      }
      signals.push({
        signal: 'HEADER_LINK_WP_REST_API',
        evidence: `Link: ${linkHeader.trim()}`,
        confidence: 'firm',
      });
    }

    // C. Set-Cookie headers for WordPress markers
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      const cookieArray = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const cookieStr of cookieArray) {
        if (/wordpress(?:_logged_in|_test_cookie)?|wp-settings/i.test(cookieStr)) {
          const cookieName = cookieStr.split('=')[0]?.trim() || 'wordpress_cookie';
          signals.push({
            signal: 'COOKIE_WP_MARKER',
            evidence: `Cookie name: ${cookieName}`,
            confidence: 'firm',
          });
        }
      }
    }

    // 2. Inspect HTML DOM (if HTML response)
    if (parsedDoc) {
      // A. Generator Meta Tag (strong declaration, but not cryptographic proof)
      if (parsedDoc.metadata.generator) {
        const gen = parsedDoc.metadata.generator.trim();
        const wpMatch = gen.match(/^WordPress(?:\s+([\d.]+))?/i);
        if (wpMatch) {
          if (wpMatch[1]) {
            version = wpMatch[1];
            versionSource = 'meta[name=generator]';
          }
          signals.push({
            signal: 'GENERATOR_META_WORDPRESS',
            evidence: `Generator meta: "${gen}"`,
            confidence: 'firm',
          });
        }
      }

      // Check resources for wp-content/themes, wp-content/plugins, wp-includes
      for (const res of parsedDoc.resources) {
        if (res.originalValue.includes('/wp-content/themes/')) {
          const themeMatch = res.originalValue.match(/\/wp-content\/themes\/([a-zA-Z0-9_-]+)/i);
          if (themeMatch) {
            detectedThemes.add(themeMatch[1].toLowerCase());
          }
        }
        if (res.originalValue.includes('/wp-content/plugins/')) {
          const pluginMatch = res.originalValue.match(/\/wp-content\/plugins\/([a-zA-Z0-9_-]+)/i);
          if (pluginMatch) {
            detectedPlugins.add(pluginMatch[1].toLowerCase());
          }
        }
        if (res.originalValue.includes('/wp-includes/')) {
          signals.push({
            signal: 'RESOURCE_WP_INCLUDES',
            evidence: res.originalValue.slice(0, 150),
            confidence: 'firm',
          });
        }
      }

      // Check Links on the page
      for (const link of parsedDoc.links) {
        if (link.rel?.includes('https://api.w.org/')) {
          hasRestApi = true;
          restApiEndpoint = link.resolvedUrl || link.originalValue;
          signals.push({
            signal: 'HTML_LINK_REST_API',
            evidence: `<link rel="https://api.w.org/" href="${link.originalValue}">`,
            confidence: 'firm',
          });
        }
        if (
          link.originalValue.includes('wp-login.php') ||
          link.originalValue.includes('wp-admin')
        ) {
          signals.push({
            signal: 'HTML_LINK_WP_LOGIN',
            evidence: `Link: ${link.originalValue}`,
            confidence: 'tentative',
          });
        }
      }

      // Check Images on page for wp-content/uploads
      for (const img of parsedDoc.images) {
        const src = img.src || img.dataSrc;
        if (src && src.includes('/wp-content/uploads/')) {
          signals.push({
            signal: 'IMAGE_WP_UPLOADS',
            evidence: src.slice(0, 150),
            confidence: 'tentative',
          });
          break; // One sample is sufficient
        }
      }

      // Check for meta name="generator" content="WordPress..."
      // Inspect structure or inline meta tags if present in document
      // We can also extract generator via regex from original document or metadata
      // Let's check page HTML or links
    }

    // Check page HTML text directly for generator meta tag if present
    // Note: parsedDoc doesn't execute anything; we extract generator string safely:
    if (page.parsedDocument) {
      // Look for generator tag in HTML text safely
      // In parsedDoc structure or raw text if available
      // Note: we can inspect page URL or headers
    }

    // Add theme and plugin signals
    for (const theme of detectedThemes) {
      signals.push({
        signal: 'THEME_DETECTED',
        evidence: `Observed theme slug: ${theme}`,
        confidence: 'firm',
      });
    }

    for (const plugin of detectedPlugins) {
      signals.push({
        signal: 'PLUGIN_DETECTED',
        evidence: `Observed plugin slug: ${plugin}`,
        confidence: 'firm',
      });
    }

    // Evaluate Confidence
    let isWordPress: boolean;
    let confidence: FindingConfidence;

    const hasGenerator = signals.some(s => s.signal === 'GENERATOR_META_WORDPRESS');
    const otherSignalsCount = signals.filter(s => s.signal !== 'GENERATOR_META_WORDPRESS').length;
    const firmCount = signals.filter(s => s.confidence === 'firm').length;
    const tentativeCount = signals.filter(s => s.confidence === 'tentative').length;

    if (hasGenerator && otherSignalsCount >= 1) {
      // Generator corroborated by independent signals (e.g. assets or headers)
      isWordPress = true;
      confidence = 'confirmed';
    } else if (hasGenerator) {
      // Isolated generator meta (strong declaration, but unverified / potentially spoofed)
      isWordPress = true;
      confidence = 'firm';
    } else if (firmCount >= 2) {
      // Multiple technical indicators (e.g., theme + plugin paths)
      isWordPress = true;
      confidence = 'firm';
    } else if (firmCount === 1 && tentativeCount >= 1) {
      isWordPress = true;
      confidence = 'tentative';
    } else {
      isWordPress = false;
      confidence = 'low';
    }

    const findings: AnalyzerFinding[] = [];

    if (isWordPress) {
      const themesArr = Array.from(detectedThemes);
      const pluginsArr = Array.from(detectedPlugins);

      // 1. Core WP Presence Finding (Informational Observation)
      findings.push({
        ruleId: 'WP_DETECTED',
        category: 'wordpress',
        title:
          confidence === 'confirmed'
            ? 'WordPress Content Management System Strongly Identified'
            : 'Potential WordPress Content Management System Detected',
        description: `WordPress CMS presence was identified on ${page.requestedUrl} based on ${signals.length} passive technical indicator(s).`,
        severity: 'info',
        confidence,
        status: confidence === 'confirmed' ? 'confirmed' : 'potential',
        targetUrl: page.requestedUrl,
        evidence: {
          confidence,
          version: version ?? 'Unknown / Not Disclosed',
          themes: themesArr,
          plugins: pluginsArr,
          hasRestApi,
          restApiEndpoint,
          hasXmlRpc,
          signalSummary: signals.map(s => `${s.signal}: ${s.evidence}`).slice(0, 10),
        },
        remediation:
          'Keep WordPress core, themes, and plugins updated to their latest supported versions.',
        references: ['https://wordpress.org/documentation/article/hardening-wordpress/'],
      });

      // 2. Version Disclosed Finding (if version was explicitly found in generator meta)
      if (version) {
        findings.push({
          ruleId: 'WP_VERSION_DISCLOSED',
          category: 'wordpress',
          title: 'WordPress Version Disclosed in Generator Metadata',
          description: `The generator metadata on ${page.requestedUrl} declares WordPress version ${version}. Note: While generator tags represent declared version metadata, they are not cryptographic proof of the underlying platform and may be stale or custom-filtered.`,
          severity: 'low',
          confidence: 'firm',
          status: 'confirmed',
          targetUrl: page.requestedUrl,
          evidence: {
            version,
            source: versionSource ?? 'meta[name=generator]',
          },
          remediation:
            'Remove or filter the generator meta tag in your WordPress theme (e.g., via remove_action("wp_head", "wp_generator") in functions.php).',
          references: ['https://developer.wordpress.org/reference/functions/wp_generator/'],
        });
      }

      // 3. XML-RPC Pingback Interface Advertised Finding
      if (hasXmlRpc && pingback && typeof pingback === 'string') {
        findings.push({
          ruleId: 'WP_XMLRPC_PINGBACK_ADVERTISED',
          category: 'wordpress',
          title: 'WordPress XML-RPC Pingback Interface Advertised',
          description: `The response header X-Pingback on ${page.requestedUrl} advertises an XML-RPC endpoint (${pingback.trim()}). Note: This header indicates an advertised pingback interface; passive analysis does not verify whether the endpoint is enabled or reachable.`,
          severity: 'info',
          confidence: 'firm',
          status: 'potential',
          targetUrl: page.requestedUrl,
          evidence: {
            xPingback: pingback,
          },
          remediation:
            'Disable XML-RPC pingback or block xmlrpc.php at the web server/WAF level if external XML-RPC publishing is not required.',
          references: [
            'https://wordpress.org/documentation/article/hardening-wordpress/#disable-xml-rpc',
          ],
        });
      }

      // 4. REST API Endpoint Disclosed Finding
      if (hasRestApi && restApiEndpoint) {
        findings.push({
          ruleId: 'WP_REST_API_ADVERTISED',
          category: 'wordpress',
          title: 'WordPress REST API Linkage Advertised',
          description: `A WordPress REST API relationship was advertised on ${page.requestedUrl} (endpoint: ${restApiEndpoint}). Note: This observation indicates an advertised REST API link relationship; passive analysis does not verify whether the endpoint is publicly active or reachable.`,
          severity: 'info',
          confidence: 'firm',
          status: 'potential',
          targetUrl: page.requestedUrl,
          evidence: {
            restApiEndpoint,
          },
          remediation:
            'Ensure that sensitive REST API routes require appropriate authentication and capabilities.',
          references: ['https://developer.wordpress.org/rest-api/'],
        });
      }
    }

    const data: WordPressDetectionData = {
      isWordPress,
      confidence,
      version,
      versionSource,
      detectedThemes: Array.from(detectedThemes),
      detectedPlugins: Array.from(detectedPlugins),
      hasRestApi,
      restApiEndpoint,
      hasXmlRpc,
      signals,
    };

    return {
      findings,
      data,
    };
  }
}
