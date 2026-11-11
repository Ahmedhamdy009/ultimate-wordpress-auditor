/**
 * Security Headers, TLS Audit & Cookie Security Analyzer.
 * Passively evaluates HTTP security response headers, real TLS connection metadata,
 * and cookie security flags without destructive testing or sensitive data retention.
 */

import type { CrawledPageResult } from '../crawler/types.js';
import type {
  AnalyzerContext,
  AnalyzerFinding,
  PageAnalysisResult,
  PageAnalyzer,
} from './types.js';

export interface SecurityAuditData {
  readonly headersEvaluated: readonly string[];
  readonly missingHeaders: readonly string[];
  readonly tlsProtocol: string | null;
  readonly isTlsModern: boolean;
  readonly isCertValid: boolean;
  readonly daysUntilCertExpiry?: number;
  readonly cookiesInspected: number;
}

export class SecurityHeadersAnalyzer implements PageAnalyzer<SecurityAuditData> {
  readonly id = 'security-headers-analyzer';
  readonly name = 'Security Headers & TLS Audit Analyzer';

  analyzePage(
    page: CrawledPageResult,
    _context: AnalyzerContext,
  ): PageAnalysisResult<SecurityAuditData> {
    const findings: AnalyzerFinding[] = [];
    const headers = page.headers || {};
    const url = page.requestedUrl;
    const isHttps = url.startsWith('https:');

    const headersEvaluated: string[] = [];
    const missingHeaders: string[] = [];

    // ==========================================
    // 1. HTTP Security Headers Analysis
    // ==========================================

    // A. Strict-Transport-Security (HSTS)
    if (isHttps) {
      headersEvaluated.push('Strict-Transport-Security');
      const hsts = headers['strict-transport-security'];
      if (!hsts || typeof hsts !== 'string' || hsts.trim().length === 0) {
        missingHeaders.push('Strict-Transport-Security');
        findings.push({
          ruleId: 'SEC_HEADER_HSTS_MISSING',
          category: 'security',
          title: 'Missing Strict-Transport-Security (HSTS) Header',
          description: `The HTTPS response from ${url} does not declare a Strict-Transport-Security header, leaving connections vulnerable to SSL stripping and insecure downgrade attacks.`,
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { header: 'Strict-Transport-Security', observed: null },
          remediation:
            'Enable HSTS by sending "Strict-Transport-Security: max-age=31536000; includeSubDomains" on all HTTPS responses.',
          references: [
            'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
          ],
        });
      } else {
        interface ParsedHsts {
          isValid: boolean;
          maxAgeSeconds: number | null;
          hasIncludeSubDomains: boolean;
          hasPreload: boolean;
          errors: string[];
        }

        const parseHstsDirectives = (rawHeader: string): ParsedHsts => {
          const result: ParsedHsts = {
            isValid: true,
            maxAgeSeconds: null,
            hasIncludeSubDomains: false,
            hasPreload: false,
            errors: [],
          };

          const parts = rawHeader.split(';');
          const seenDirectives = new Map<string, number>();
          const TOKEN_REGEX = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

          for (const rawPart of parts) {
            const trimmed = rawPart.trim();
            if (trimmed.length === 0) {
              continue; // Allow empty slots from trailing or consecutive semicolons
            }

            const eqIndex = trimmed.indexOf('=');
            let name: string;
            let rawValue: string | null = null;

            if (eqIndex === -1) {
              name = trimmed.toLowerCase();
            } else {
              name = trimmed.substring(0, eqIndex).trim().toLowerCase();
              rawValue = trimmed.substring(eqIndex + 1).trim();
            }

            if (name.length === 0) {
              result.errors.push(
                `Invalid directive formatting: missing directive name in "${trimmed}".`,
              );
              result.isValid = false;
              continue;
            }

            if (!TOKEN_REGEX.test(name)) {
              result.errors.push(`Invalid directive name syntax: "${name}".`);
              result.isValid = false;
              continue;
            }

            // Track duplicate directives across ALL directives (case-insensitively)
            const count = (seenDirectives.get(name) || 0) + 1;
            seenDirectives.set(name, count);
            if (count > 1) {
              result.errors.push(`Duplicate "${name}" directive encountered.`);
              result.isValid = false;
            }

            // Parse directive values: token vs quoted-string
            let unquotedValue: string | null = null;
            if (rawValue !== null) {
              if (rawValue.length === 0) {
                result.errors.push(`Empty value specified for directive "${name}".`);
                result.isValid = false;
              } else if (rawValue.startsWith('"')) {
                // Quoted string validation (RFC 2616 / RFC 6797)
                if (!rawValue.endsWith('"') || rawValue.length < 2) {
                  result.errors.push(
                    `Malformed unclosed quoted string in directive "${name}": ${rawValue}`,
                  );
                  result.isValid = false;
                } else {
                  const interior = rawValue.slice(1, -1);
                  let unescaped = '';
                  let isEscaping = false;
                  let hasInnerQuoteError = false;

                  for (let i = 0; i < interior.length; i++) {
                    const char = interior[i];
                    if (isEscaping) {
                      unescaped += char;
                      isEscaping = false;
                    } else if (char === '\\') {
                      isEscaping = true;
                    } else if (char === '"') {
                      hasInnerQuoteError = true;
                      break;
                    } else {
                      unescaped += char;
                    }
                  }

                  if (isEscaping || hasInnerQuoteError) {
                    result.errors.push(
                      `Malformed quoted-pair or unescaped quote in directive "${name}": ${rawValue}`,
                    );
                    result.isValid = false;
                  } else {
                    unquotedValue = unescaped;
                  }
                }
              } else {
                // Token value: must not contain quotes or spaces
                if (rawValue.includes('"') || !TOKEN_REGEX.test(rawValue)) {
                  result.errors.push(
                    `Invalid token syntax or misplaced quote in directive "${name}": ${rawValue}`,
                  );
                  result.isValid = false;
                } else {
                  unquotedValue = rawValue;
                }
              }
            }

            // Semantic validation for known directives
            if (name === 'max-age') {
              if (rawValue === null) {
                result.errors.push(
                  'The "max-age" directive requires a numeric delta-seconds value.',
                );
                result.isValid = false;
              } else if (unquotedValue !== null) {
                if (!/^\d+$/.test(unquotedValue)) {
                  result.errors.push(
                    `Malformed "max-age" value: "${unquotedValue}". Expected non-negative integer delta-seconds.`,
                  );
                  result.isValid = false;
                } else {
                  const parsed = Number(unquotedValue);
                  if (!Number.isSafeInteger(parsed) || parsed < 0) {
                    result.errors.push(
                      `Value for "max-age" exceeds maximum safe integer or is negative: "${unquotedValue}".`,
                    );
                    result.isValid = false;
                  } else if (count === 1) {
                    result.maxAgeSeconds = parsed;
                  }
                }
              }
            } else if (name === 'includesubdomains') {
              if (rawValue !== null) {
                result.errors.push('The "includeSubDomains" directive must not specify a value.');
                result.isValid = false;
              } else if (count === 1) {
                result.hasIncludeSubDomains = true;
              }
            } else if (name === 'preload') {
              if (rawValue !== null) {
                result.errors.push('The "preload" directive must not specify a value.');
                result.isValid = false;
              } else if (count === 1) {
                result.hasPreload = true;
              }
            }
            // Unknown directives matching TOKEN_REGEX are syntactically valid extensions per RFC 6797 and are safely ignored.
          }

          if (!seenDirectives.has('max-age')) {
            result.errors.push('Missing required "max-age" directive.');
            result.isValid = false;
          }

          if (!result.isValid) {
            result.maxAgeSeconds = null; // Conservative invalidation on any structural error
          }

          return result;
        };

        const parsedHsts = parseHstsDirectives(hsts);

        if (!parsedHsts.isValid) {
          findings.push({
            ruleId: 'SEC_HEADER_HSTS_MALFORMED',
            category: 'security',
            title: 'Malformed Strict-Transport-Security Header',
            description: `The Strict-Transport-Security header is malformed: ${parsedHsts.errors.join(' ')}`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { rawHeader: hsts, errors: parsedHsts.errors },
            remediation:
              'Format the HSTS header according to RFC 6797, e.g., "Strict-Transport-Security: max-age=31536000; includeSubDomains".',
            references: [
              'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
              'https://datatracker.ietf.org/doc/html/rfc6797#section-6.1',
            ],
          });
        }

        const maxAgeSeconds = parsedHsts.maxAgeSeconds;
        const hasIncludeSubDomains = parsedHsts.hasIncludeSubDomains;
        const hasPreload = parsedHsts.hasPreload;

        if (maxAgeSeconds !== null) {
          if (maxAgeSeconds < 10368000) {
            // Under 120 days: internal analyzer heuristic for short duration
            findings.push({
              ruleId: 'SEC_HEADER_HSTS_WEAK',
              category: 'security',
              title: `HSTS max-age Directive Too Short (${Math.round(maxAgeSeconds / 86400)} days)`,
              description: `The HSTS max-age duration is ${maxAgeSeconds}s (~${Math.round(maxAgeSeconds / 86400)} days). The scanner flags max-age under 120 days (10,368,000s) as an internal heuristic for short HSTS protection. Note: While RFC 6797 does not dictate a minimum duration, standard production guidance recommends at least 1 year (31,536,000s) once HTTPS configuration is stable.`,
              severity: 'low',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: url,
              evidence: { rawHeader: hsts, maxAgeSeconds, thresholdSeconds: 10368000 },
              remediation:
                'Increase max-age to at least 31536000 (1 year) once HTTPS deployment is permanent.',
              references: [
                'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
              ],
            });
          }
        }

        if (!hasIncludeSubDomains) {
          findings.push({
            ruleId: 'SEC_HEADER_HSTS_NO_SUBDOMAINS',
            category: 'security',
            title: 'HSTS Header Missing includeSubDomains Directive',
            description: `The Strict-Transport-Security header does not specify the 'includeSubDomains' directive. Subdomains of ${url} are not automatically protected by this HSTS policy and must declare their own independent transport security configuration.`,
            severity: 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { rawHeader: hsts },
            remediation:
              'Evaluate whether all subdomains support HTTPS, and if so, append "; includeSubDomains" to the HSTS header.',
            references: [
              'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
            ],
          });
        }

        // Preload eligibility checks (per hstspreload.org criteria: max-age >= 31536000, includeSubDomains, preload)
        if (parsedHsts.isValid) {
          if (hasPreload) {
            if (maxAgeSeconds !== null && maxAgeSeconds < 31536000) {
              findings.push({
                ruleId: 'SEC_HEADER_HSTS_PRELOAD_INELIGIBLE',
                category: 'security',
                title: 'HSTS Preload Directive Present but max-age Below 1 Year',
                description: `The HSTS header specifies the 'preload' directive, but max-age is ${maxAgeSeconds}s, which is below the 31,536,000s (1 year) requirement for browser preload listing (hstspreload.org).`,
                severity: 'info',
                confidence: 'confirmed',
                status: 'confirmed',
                targetUrl: url,
                evidence: { rawHeader: hsts, maxAgeSeconds, requiredMinSeconds: 31536000 },
                remediation:
                  'Increase max-age to at least 31536000 (1 year) to satisfy hstspreload.org eligibility criteria.',
                references: ['https://hstspreload.org/'],
              });
            } else if (
              hasIncludeSubDomains &&
              maxAgeSeconds !== null &&
              maxAgeSeconds >= 31536000
            ) {
              findings.push({
                ruleId: 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE',
                category: 'security',
                title: 'HSTS Preload Eligibility Indicators Present',
                description: `The response header declares HSTS with max-age >= 31,536,000s (1 year), includeSubDomains, and preload. These indicators appear to satisfy the header prerequisites for HSTS preload list eligibility (hstspreload.org). Note: Header presence indicates eligibility; actual inclusion in browser preload lists requires explicit domain submission to hstspreload.org.`,
                severity: 'info',
                confidence: 'confirmed',
                status: 'confirmed',
                targetUrl: url,
                evidence: { maxAgeSeconds, hasIncludeSubDomains: true, hasPreload: true },
                remediation:
                  'If hardcoded browser preloading is desired and not yet submitted, submit the domain at hstspreload.org.',
                references: ['https://hstspreload.org/'],
              });
            }
          } else if (hasIncludeSubDomains && maxAgeSeconds !== null && maxAgeSeconds >= 31536000) {
            findings.push({
              ruleId: 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED',
              category: 'security',
              title: 'HSTS Preload Directive Not Declared',
              description: `The HSTS policy specifies max-age >= 1 year and includeSubDomains, but does not include the 'preload' directive. If hardcoded browser preload listing is desired, the 'preload' directive can be added prior to submitting the domain to hstspreload.org.`,
              severity: 'info',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: url,
              evidence: { rawHeader: hsts },
              remediation:
                'If browser preloading is desired, add "; preload" and submit the domain to hstspreload.org.',
              references: ['https://hstspreload.org/'],
            });
          }
        }
      }
    }

    // Helper to parse CSP directives into directive name -> tokens map
    const parseCspDirectives = (csp: string): Map<string, string[]> => {
      const map = new Map<string, string[]>();
      for (const part of csp.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const tokens = trimmed.split(/\s+/);
        const name = tokens[0]?.toLowerCase();
        if (name) {
          map.set(
            name,
            tokens.slice(1).map(t => t.toLowerCase()),
          );
        }
      }
      return map;
    };

    // B. Content-Security-Policy (CSP)
    headersEvaluated.push('Content-Security-Policy');
    const enforcedCsp = headers['content-security-policy'];
    const reportOnlyCsp = headers['content-security-policy-report-only'];

    const enforcedDirectives =
      typeof enforcedCsp === 'string' ? parseCspDirectives(enforcedCsp) : null;
    const reportOnlyDirectives =
      typeof reportOnlyCsp === 'string' ? parseCspDirectives(reportOnlyCsp) : null;

    if (!enforcedCsp && !reportOnlyCsp) {
      missingHeaders.push('Content-Security-Policy');
      findings.push({
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'Missing Content-Security-Policy Header',
        description: `The response from ${url} does not declare a Content-Security-Policy (CSP) header, increasing the impact of potential Cross-Site Scripting (XSS) and code injection vulnerabilities.`,
        severity: 'low',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: url,
        evidence: { header: 'Content-Security-Policy', observed: null },
        remediation:
          'Implement a Content-Security-Policy header defining trusted sources for scripts, styles, and other resources.',
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
      });
    } else {
      if (typeof reportOnlyCsp === 'string' && !enforcedCsp) {
        findings.push({
          ruleId: 'SEC_HEADER_CSP_REPORT_ONLY',
          category: 'security',
          title: 'Content-Security-Policy in Report-Only Mode',
          description: `The CSP on ${url} is delivered via Content-Security-Policy-Report-Only. Policies are monitored but not actively enforced by browsers.`,
          severity: 'info',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { header: 'Content-Security-Policy-Report-Only' },
          remediation:
            'Once policy testing is complete, transition CSP to an enforced Content-Security-Policy header.',
          references: [
            'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only',
          ],
        });
      }

      // Check active policy directives (preferring enforced over report-only)
      const activeDirectives = enforcedDirectives ?? reportOnlyDirectives;
      if (activeDirectives) {
        const scriptSources =
          activeDirectives.get('script-src') ?? activeDirectives.get('default-src') ?? [];
        const hasUnsafeInline = scriptSources.includes("'unsafe-inline'");
        const hasNonceOrHash = scriptSources.some(
          s =>
            s.startsWith("'nonce-") ||
            s.startsWith("'sha256-") ||
            s.startsWith("'sha384-") ||
            s.startsWith("'sha512-"),
        );

        // Under CSP Level 3: 'unsafe-inline' is ignored by modern browsers when nonces or hashes are present
        if (hasUnsafeInline && !hasNonceOrHash) {
          findings.push({
            ruleId: 'SEC_HEADER_CSP_UNSAFE_INLINE',
            category: 'security',
            title: "CSP Directive Contains 'unsafe-inline' Without Nonces/Hashes",
            description: `The Content-Security-Policy on ${url} includes 'unsafe-inline' in script-src without nonces or hashes, permitting execution of arbitrary inline scripts.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { snippet: "'unsafe-inline' active in script-src" },
            remediation:
              "Remove 'unsafe-inline' and adopt cryptographic nonces or hashes for legitimate inline scripts.",
            references: ['https://content-security-policy.com/'],
          });
        }

        if (scriptSources.includes("'unsafe-eval'")) {
          findings.push({
            ruleId: 'SEC_HEADER_CSP_UNSAFE_EVAL',
            category: 'security',
            title: "CSP Directive Contains 'unsafe-eval'",
            description: `The Content-Security-Policy on ${url} includes 'unsafe-eval', allowing string-to-code execution mechanisms such as eval().`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { snippet: "'unsafe-eval' detected in policy" },
            remediation:
              "Eliminate dynamic eval() and new Function() calls from scripts and remove 'unsafe-eval'.",
            references: ['https://content-security-policy.com/'],
          });
        }
      }
    }

    // C. X-Content-Type-Options
    headersEvaluated.push('X-Content-Type-Options');
    const xcto = headers['x-content-type-options'];
    if (!xcto || typeof xcto !== 'string' || xcto.trim().toLowerCase() !== 'nosniff') {
      missingHeaders.push('X-Content-Type-Options');
      findings.push({
        ruleId: 'SEC_HEADER_X_CONTENT_TYPE_OPTIONS_MISSING',
        category: 'security',
        title: 'Missing or Invalid X-Content-Type-Options Header',
        description: `The response from ${url} is missing "X-Content-Type-Options: nosniff", allowing older or non-standard user agents to MIME-sniff responses away from the declared Content-Type.`,
        severity: 'low',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: url,
        evidence: { header: 'X-Content-Type-Options', observed: xcto ?? null },
        remediation: 'Set "X-Content-Type-Options: nosniff" on all HTTP responses.',
        references: [
          'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options',
        ],
      });
    }

    // D. Anti-Clickjacking: X-Frame-Options & CSP frame-ancestors
    headersEvaluated.push('X-Frame-Options');
    const xfo = headers['x-frame-options'];
    const enforcedFrameAncestors = enforcedDirectives?.get('frame-ancestors');
    const hasEffectiveCspFraming =
      enforcedFrameAncestors &&
      enforcedFrameAncestors.length > 0 &&
      !enforcedFrameAncestors.includes('*');

    if (!xfo && !hasEffectiveCspFraming) {
      missingHeaders.push('X-Frame-Options');
      findings.push({
        ruleId: 'SEC_HEADER_X_FRAME_OPTIONS_MISSING',
        category: 'security',
        title: 'Missing Anti-Clickjacking Framing Protection',
        description: `The response from ${url} does not declare X-Frame-Options or an effective CSP frame-ancestors directive, enabling third-party sites to embed the page in transparent iframes for clickjacking attacks.`,
        severity: 'low',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: url,
        evidence: { xFrameOptions: null, cspFrameAncestors: false },
        remediation:
          'Configure "X-Frame-Options: SAMEORIGIN" or CSP "frame-ancestors \'self\'" to restrict unauthorized framing.',
        references: ['https://owasp.org/www-community/attacks/Clickjacking'],
      });
    }

    // E. Referrer-Policy
    headersEvaluated.push('Referrer-Policy');
    const refPolicy = headers['referrer-policy'];
    if (!refPolicy || typeof refPolicy !== 'string' || refPolicy.trim().length === 0) {
      missingHeaders.push('Referrer-Policy');
      findings.push({
        ruleId: 'SEC_HEADER_REFERRER_POLICY_MISSING',
        category: 'security',
        title: 'Missing Referrer-Policy Header',
        description: `The response from ${url} does not declare a Referrer-Policy header. Browsers may fall back to default behavior and leak path or query parameters in Referer headers across origins.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: url,
        evidence: { header: 'Referrer-Policy', observed: null },
        remediation:
          'Set "Referrer-Policy: strict-origin-when-cross-origin" to protect sensitive URL parameters in external requests.',
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy'],
      });
    } else {
      const lowerRef = refPolicy.toLowerCase().trim();
      if (lowerRef === 'unsafe-url' || lowerRef === 'no-referrer-when-downgrade') {
        findings.push({
          ruleId: 'SEC_HEADER_REFERRER_POLICY_UNSAFE',
          category: 'security',
          title: 'Overly Permissive Referrer-Policy Declared',
          description: `The Referrer-Policy is configured as "${refPolicy}". This policy exposes full URL paths and query strings to third-party destinations.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { referrerPolicy: refPolicy },
          remediation:
            'Change Referrer-Policy to "strict-origin-when-cross-origin" or "no-referrer".',
          references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy'],
        });
      }
    }

    // F. Permissions-Policy
    headersEvaluated.push('Permissions-Policy');
    const permPolicy = headers['permissions-policy'];
    if (!permPolicy || typeof permPolicy !== 'string' || permPolicy.trim().length === 0) {
      missingHeaders.push('Permissions-Policy');
      findings.push({
        ruleId: 'SEC_HEADER_PERMISSIONS_POLICY_MISSING',
        category: 'security',
        title: 'No Permissions-Policy Header Declared',
        description: `The response from ${url} does not declare a Permissions-Policy header. Browsers will apply default permission access models for device APIs (e.g., camera, microphone, geolocation). Defining an explicit policy is a recommended defense-in-depth practice.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: url,
        evidence: { header: 'Permissions-Policy', observed: null },
        remediation:
          'Configure a Permissions-Policy header disabling unnecessary device APIs (e.g. "geolocation=(), microphone=(), camera=()").',
        references: [
          'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy',
        ],
      });
    }

    // ==========================================
    // 2. Real TLS Connection Audit
    // ==========================================
    let tlsProtocol: string | null = null;
    let isTlsModern = false;
    let isCertValid = true;
    let daysUntilCertExpiry: number | undefined;

    if (page.tls) {
      tlsProtocol = page.tls.protocol;

      // Protocol version checks
      if (tlsProtocol === 'TLSv1' || tlsProtocol === 'TLSv1.1') {
        isTlsModern = false;
        findings.push({
          ruleId: 'SEC_TLS_DEPRECATED_PROTOCOL',
          category: 'security',
          title: `Deprecated TLS Protocol Negotiated (${tlsProtocol})`,
          description: `The server negotiated an obsolete and deprecated TLS version (${tlsProtocol}). TLS 1.0 and 1.1 contain cryptographic weaknesses and are deprecated by RFC 8996.`,
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: { protocol: tlsProtocol },
          remediation:
            'Disable TLS 1.0 and 1.1 on the server. Support TLS 1.2 and TLS 1.3 exclusively.',
          references: ['https://datatracker.ietf.org/doc/rfc8996/'],
        });
      } else if (tlsProtocol === 'TLSv1.2' || tlsProtocol === 'TLSv1.3') {
        isTlsModern = true;
      }

      // Weak cipher suite checks
      if (page.tls.cipher) {
        const cipherName = page.tls.cipher.name.toUpperCase();
        if (/\b(?:RC4|3DES|DES|MD5|NULL|EXPORT)\b/.test(cipherName)) {
          findings.push({
            ruleId: 'SEC_TLS_WEAK_CIPHER',
            category: 'security',
            title: `Insecure or Deprecated Cipher Suite (${cipherName})`,
            description: `The negotiated TLS cipher suite (${cipherName}) uses known weak or broken cryptographic algorithms.`,
            severity: 'high',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { cipher: page.tls.cipher },
            remediation:
              'Configure modern cipher suites using AES-GCM or CHACHA20-POLY1305 with Ephemeral Diffie-Hellman key exchange.',
            references: ['https://wiki.mozilla.org/Security/Server_Side_TLS'],
          });
        }
      }

      // Certificate authorization and expiration
      if (page.tls.authorized === false) {
        isCertValid = false;
        findings.push({
          ruleId: 'SEC_TLS_CERT_INVALID',
          category: 'security',
          title: 'TLS Certificate Verification Failed',
          description: `The server TLS certificate failed validation: ${page.tls.authorizationError || 'Unknown verification error'}.`,
          severity: 'critical',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: url,
          evidence: {
            authorized: false,
            authorizationError: page.tls.authorizationError,
          },
          remediation:
            'Install a valid, trusted TLS certificate issued by a recognized public certificate authority.',
          references: ['https://letsencrypt.org/'],
        });
      }

      if (page.tls.peerCertificate) {
        const cert = page.tls.peerCertificate;
        daysUntilCertExpiry = cert.daysUntilExpiration;

        if (daysUntilCertExpiry !== undefined) {
          if (daysUntilCertExpiry < 0) {
            isCertValid = false;
            findings.push({
              ruleId: 'SEC_TLS_CERT_EXPIRED',
              category: 'security',
              title: `TLS Certificate Expired (${Math.abs(daysUntilCertExpiry)} days ago)`,
              description: `The server TLS certificate expired on ${cert.validTo}. Browsers will display security warnings and refuse connections.`,
              severity: 'critical',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: url,
              evidence: {
                validFrom: cert.validFrom,
                validTo: cert.validTo,
                daysExpired: Math.abs(daysUntilCertExpiry),
              },
              remediation: 'Renew and deploy a current TLS certificate immediately.',
              references: ['https://letsencrypt.org/'],
            });
          } else if (daysUntilCertExpiry <= 30) {
            findings.push({
              ruleId: 'SEC_TLS_CERT_EXPIRING_SOON',
              category: 'security',
              title: `TLS Certificate Expiring Soon (${daysUntilCertExpiry} days remaining)`,
              description: `The server TLS certificate expires in ${daysUntilCertExpiry} days (${cert.validTo}).`,
              severity: 'low',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: url,
              evidence: { validTo: cert.validTo, daysUntilExpiration: daysUntilCertExpiry },
              remediation:
                'Ensure automated certificate renewal (e.g. ACME/Certbot) is scheduled and operational.',
              references: ['https://letsencrypt.org/'],
            });
          }
        }
      }
    }

    // ==========================================
    // 3. Cookie Security Analysis
    // ==========================================
    let cookiesInspected = 0;
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      const cookieArray = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const cookieHeader of cookieArray) {
        cookiesInspected++;
        const parts = cookieHeader.split(';').map(p => p.trim());
        const namePart = parts[0] || '';
        const cookieName = namePart.split('=')[0]?.trim();
        if (!cookieName) continue;

        const lowerParts = parts.slice(1).map(p => p.toLowerCase());
        const hasSecure = lowerParts.some(p => p === 'secure');
        const hasHttpOnly = lowerParts.some(p => p === 'httponly');
        const sameSitePart = lowerParts.find(p => p.startsWith('samesite='));

        // Note: NEVER record cookie value in findings or evidence! Only cookieName.
        if (isHttps && !hasSecure) {
          findings.push({
            ruleId: 'SEC_COOKIE_INSECURE',
            category: 'security',
            title: `Cookie Missing Secure Flag (${cookieName})`,
            description: `The cookie "${cookieName}" was set over HTTPS without the "Secure" flag, allowing transmission over plaintext HTTP.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { cookieName, hasSecure: false },
            remediation: 'Append the "; Secure" attribute to all cookies set over HTTPS.',
            references: [
              'https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies',
            ],
          });
        }

        const isSensitiveCookie =
          /session|auth|token|jwt|wp-settings|logged_in|sid|phpsessid|jsessionid/i.test(cookieName);
        if (isSensitiveCookie && !hasHttpOnly) {
          findings.push({
            ruleId: 'SEC_COOKIE_NO_HTTPONLY',
            category: 'security',
            title: `Potential Sensitive Session Cookie Missing HttpOnly (${cookieName})`,
            description: `The cookie name "${cookieName}" matches common session/authentication naming heuristics but is missing the "HttpOnly" attribute. If this cookie stores authentication credentials or session state, client-side scripts can access it via document.cookie.`,
            severity: 'medium',
            confidence: 'potential',
            status: 'potential',
            targetUrl: url,
            evidence: { cookieName, hasHttpOnly: false },
            remediation:
              'Append the "; HttpOnly" attribute to sensitive session cookies to prevent token theft via XSS.',
            references: ['https://owasp.org/www-community/HttpOnly'],
          });
        }

        const sameSiteValue = sameSitePart
          ? sameSitePart.split('=')[1]?.toLowerCase().trim()
          : null;

        if (sameSiteValue === 'none' && !hasSecure) {
          findings.push({
            ruleId: 'SEC_COOKIE_SAMESITE_NONE_INSECURE',
            category: 'security',
            title: `SameSite=None Cookie Declared Without Secure Flag (${cookieName})`,
            description: `The cookie "${cookieName}" specifies SameSite=None without the "Secure" attribute. Modern browsers reject SameSite=None cookies unless accompanied by Secure.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { cookieName, sameSite: 'none', hasSecure: false },
            remediation: 'Append "; Secure" to cookies using SameSite=None.',
            references: [
              'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite',
            ],
          });
        } else if (!sameSitePart) {
          findings.push({
            ruleId: 'SEC_COOKIE_SAMESITE_MISSING',
            category: 'security',
            title: `Cookie Missing SameSite Attribute (${cookieName})`,
            description: `The cookie "${cookieName}" does not specify a SameSite attribute, which protects against Cross-Site Request Forgery (CSRF).`,
            severity: 'low',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: url,
            evidence: { cookieName, sameSite: null },
            remediation: 'Specify "; SameSite=Lax" or "; SameSite=Strict" on cookies.',
            references: [
              'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite',
            ],
          });
        }
      }
    }

    const data: SecurityAuditData = {
      headersEvaluated,
      missingHeaders,
      tlsProtocol,
      isTlsModern,
      isCertValid,
      daysUntilCertExpiry,
      cookiesInspected,
    };

    return {
      findings,
      data,
    };
  }
}
