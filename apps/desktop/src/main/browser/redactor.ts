/**
 * Sensitive Data Redactor for Browser Runtime and Network Events.
 * Strictly redacts passwords, tokens, API keys, cookies, authorization headers,
 * and sensitive query parameters before data enters findings or persistence.
 */

const SENSITIVE_QUERY_KEY_PATTERNS: readonly RegExp[] = [
  /^pass(word|phrase)?$/i,
  /^pwd$/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /auth/i,
  /bearer/i,
  /^jwt$/i,
  /sess(ion)?([_-]?id)?/i,
  /^phpsessid$/i,
  /^jsessionid$/i,
  /card(number)?/i,
  /^cvv$/i,
  /^cc$/i,
  /^key$/i,
  /access[_-]?key/i,
  /secret[_-]?key/i,
];

const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'x-api-key',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
  'session-token',
  'private-key',
  'proxy-authenticate',
  'www-authenticate',
  'x-signature',
  'x-secret',
  'api-key',
  'apikey',
  'token',
  'auth-token',
  'x-user-token',
  'x-webhook-secret',
  'x-client-secret',
]);

const SENSITIVE_PATH_SEGMENT_KEYWORDS = new Set([
  'reset-password',
  'verify-token',
  'auth-token',
  'api-keys',
  'tokens',
  'token',
  'sessions',
  'session',
  'secrets',
]);

const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]+$/;

const INLINE_REDACTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // Bearer tokens
  { pattern: /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  // Basic Auth
  { pattern: /basic\s+[A-Za-z0-9+/=]+/gi, replacement: 'Basic [REDACTED]' },
  // JWT tokens inline
  {
    pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]+\b/g,
    replacement: '[REDACTED_JWT]',
  },
  // Known API key patterns (Stripe, GitHub, Google, Slack)
  {
    pattern:
      /\b(?:sk_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AIzaSy[A-Za-z0-9-_]{33}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  // Key-value password & secret patterns in JSON
  {
    pattern:
      /("(?:password|pwd|secret|apiKey|api_key|access_token|refreshToken|refresh_token|token|privateKey|private_key)":\s*")[^"]+(")/gi,
    replacement: '$1[REDACTED]$2',
  },
  // Key-value password & secret patterns in forms / query strings
  {
    pattern:
      /((?:password|pwd|secret|apiKey|api_key|access_token|refreshToken|refresh_token|token|privateKey|private_key)\s*=\s*)[^\s&"'>]+/gi,
    replacement: '$1[REDACTED]',
  },
];

/**
 * Redacts sensitive credentials, query parameters, and embedded path tokens from a URL string.
 */
export function redactUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    let modified = false;

    // 1. Redact credentials embedded in URL authority (e.g. https://user:pass@example.com)
    if (parsed.password) {
      parsed.password = '[REDACTED]';
      modified = true;
    }

    // 2. Redact sensitive query parameters
    for (const [key] of parsed.searchParams) {
      const isSensitive = SENSITIVE_QUERY_KEY_PATTERNS.some(pattern => pattern.test(key));
      if (isSensitive) {
        parsed.searchParams.set(key, '[REDACTED]');
        modified = true;
      }
    }

    // 3. Redact sensitive tokens embedded in path segments (e.g. /reset-password/TOKEN or /verify/JWT)
    const segments = parsed.pathname.split('/');
    let pathModified = false;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;

      if (JWT_PATTERN.test(segment)) {
        segments[i] = '[REDACTED_JWT]';
        pathModified = true;
      } else if (i > 0) {
        const prev = segments[i - 1].toLowerCase();
        if (
          SENSITIVE_PATH_SEGMENT_KEYWORDS.has(prev) &&
          (segment.length >= 16 || /^[a-f0-9]{16,}$/i.test(segment) || /^sk_/i.test(segment))
        ) {
          segments[i] = '[REDACTED]';
          pathModified = true;
        }
      }
    }

    if (pathModified) {
      parsed.pathname = segments.join('/');
      modified = true;
    }

    return modified ? parsed.toString() : rawUrl;
  } catch {
    // If URL parsing fails, apply regex fallback for query parameters
    let result = rawUrl;
    for (const pattern of SENSITIVE_QUERY_KEY_PATTERNS) {
      const regex = new RegExp(`([?&])(${pattern.source})=([^&\\s]+)`, 'gi');
      result = result.replace(regex, '$1$2=[REDACTED]');
    }
    return result;
  }
}

/**
 * Filters and redacts sensitive HTTP headers.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lowerKey)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactString(value, 500);
    }
  }

  return result;
}

/**
 * Redacts embedded credentials/tokens and truncates string to max characters.
 */
export function redactString(text: string, maxLength = 1000): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let redacted = text;
  for (const { pattern, replacement } of INLINE_REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }

  if (redacted.length > maxLength) {
    return `${redacted.slice(0, maxLength)}... [truncated ${redacted.length - maxLength} chars]`;
  }

  return redacted;
}

/**
 * Sanitizes an evidence object by redacting string values and bounding overall size.
 */
export function sanitizeEvidence(
  evidence: Record<string, unknown>,
  maxEvidenceBytes = 65536,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === 'string') {
      sanitized[key] = redactString(value, 2000);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeEvidence(value as Record<string, unknown>, maxEvidenceBytes);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'string' ? redactString(item, 1000) : item,
      );
    } else {
      sanitized[key] = value;
    }
  }

  // Ensure overall JSON payload does not exceed maxEvidenceBytes
  try {
    const serialized = JSON.stringify(sanitized);
    if (serialized.length > maxEvidenceBytes) {
      return {
        truncated: true,
        summary: `Evidence object truncated (exceeded ${maxEvidenceBytes} bytes limit).`,
        keys: Object.keys(sanitized),
      };
    }
  } catch {
    // Ignore serialization check errors
  }

  return sanitized;
}
