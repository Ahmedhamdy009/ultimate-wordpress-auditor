/**
 * Sensitive Data Redactor for Browser Runtime and Network Events.
 * Strictly redacts passwords, tokens, API keys, cookies, authorization headers,
 * and sensitive query parameters before data enters findings or persistence.
 */

export const SENSITIVE_QUERY_KEY_PATTERNS: readonly RegExp[] = [
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
  /private[_-]?key/i,
  /credential/i,
  /^sig(nature)?$/i,
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
      /("(?:password|pwd|secret|apiKey|api_key|clientSecret|client_secret|access_token|accessToken|refreshToken|refresh_token|token|privateKey|private_key|sessionId|session_id|sess_id)":\s*")[^"]+(")/gi,
    replacement: '$1[REDACTED]$2',
  },
  // Key-value password & secret patterns in forms / query strings
  {
    pattern:
      /((?:password|pwd|secret|apiKey|api_key|clientSecret|client_secret|access_token|accessToken|refreshToken|refresh_token|token|privateKey|private_key|sessionId|session_id|sess_id)\s*=\s*)[^\s&"'>]+/gi,
    replacement: '$1[REDACTED]',
  },
];

/**
 * Checks if a parameter name represents a sensitive credential, token, key, secret, or session identifier.
 * Automatically decodes URL-encoding, strips punctuation, and normalizes casing.
 */
export function isSensitiveQueryKey(rawKey: string): boolean {
  if (!rawKey || typeof rawKey !== 'string') return false;

  let decoded = rawKey;
  try {
    decoded = decodeURIComponent(rawKey);
  } catch {
    // If percent-decoding fails, use rawKey
  }

  const norm = decoded.toLowerCase().replace(/[-_]/g, '');

  // 1. Security tokens
  if (norm.includes('token')) return true;

  // 2. Secrets
  if (norm.includes('secret')) return true;

  // 3. Passwords and passphrases
  if (
    norm.includes('password') ||
    norm.includes('passwd') ||
    norm === 'pwd' ||
    norm.endsWith('pwd')
  ) {
    return true;
  }

  // 4. API keys, private keys, access keys
  if (
    norm.includes('apikey') ||
    norm.includes('secretkey') ||
    norm.includes('privatekey') ||
    norm.includes('accesskey') ||
    norm.includes('authkey') ||
    norm.includes('sessionkey') ||
    norm === 'key'
  ) {
    return true;
  }

  // 5. Auth and OAuth
  if (
    norm === 'auth' ||
    norm === 'oauth' ||
    norm.includes('authorization') ||
    norm.includes('authenticate') ||
    norm.startsWith('oauth')
  ) {
    return true;
  }

  // 6. Session identifiers
  if (
    norm.startsWith('session') ||
    norm.endsWith('session') ||
    norm.includes('sessid') ||
    norm === 'phpsessid' ||
    norm === 'jsessionid' ||
    norm === 'aspsessionid' ||
    norm === 'sid'
  ) {
    return true;
  }

  // 7. JWT & Bearer
  if (norm.includes('jwt') || norm.includes('bearer')) return true;

  // 8. Payment & credit cards
  if (
    norm.includes('cardnumber') ||
    norm.includes('creditcard') ||
    norm === 'card' ||
    norm === 'cvv' ||
    norm === 'cc'
  ) {
    return true;
  }

  // 9. Signatures & hashes used for authentication
  if (norm === 'sig' || norm.includes('signature')) return true;

  // 10. Credentials
  if (norm.includes('credential')) return true;

  return false;
}

/**
 * Sanitizes a parameter value to ensure embedded tokens or nested URLs are redacted.
 */
function sanitizeQueryParamValue(val: string): string {
  if (!val || typeof val !== 'string') return val;

  if (JWT_PATTERN.test(val)) return '[REDACTED_JWT]';
  if (/^(?:sk_live_|sk_test_|ghp_|AIzaSy|xox[baprs]-)/.test(val)) return '[REDACTED_API_KEY]';

  // Check if val contains a nested absolute or relative URL
  if (
    val.includes('http%3A') ||
    val.includes('https%3A') ||
    val.startsWith('http://') ||
    val.startsWith('https://') ||
    val.startsWith('//')
  ) {
    let decoded = val;
    let wasEncoded = false;
    try {
      decoded = decodeURIComponent(val);
      wasEncoded = decoded !== val;
    } catch {
      // Keep val if malformed
    }
    const redacted = redactUrl(decoded);
    if (redacted !== decoded) {
      const cleanRedacted = redacted.replace(/%5BREDACTED%5D/g, '[REDACTED]');
      return wasEncoded ? encodeURIComponent(cleanRedacted) : cleanRedacted;
    }
  }

  // Check if val has query parameters or fragments: e.g. /login?token=abc
  if (val.includes('?') || val.includes('#')) {
    const qIdx = val.indexOf('?');
    const hIdx = val.indexOf('#');
    const splitIdx = qIdx !== -1 ? qIdx : hIdx;
    const base = val.slice(0, splitIdx);
    const rest = val.slice(splitIdx);
    const redactedRest = redactUrlFallback(rest);
    if (redactedRest !== rest) {
      return `${base}${redactedRest}`;
    }
  }

  return val;
}

/**
 * Redacts sensitive key-value pairs in a query string.
 */
function redactQueryString(qs: string): { modified: boolean; result: string } {
  const parts = qs.split('&');
  let modified = false;

  const resultParts = parts.map(part => {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) {
      if (isSensitiveQueryKey(part)) {
        modified = true;
        return `${part}=[REDACTED]`;
      }
      return part;
    }

    const key = part.slice(0, eqIdx);
    const val = part.slice(eqIdx + 1);

    if (isSensitiveQueryKey(key)) {
      modified = true;
      return `${key}=[REDACTED]`;
    }

    const sanitizedVal = sanitizeQueryParamValue(val);
    if (sanitizedVal !== val) {
      modified = true;
      return `${key}=${sanitizedVal}`;
    }

    return part;
  });

  return { modified, result: resultParts.join('&') };
}

/**
 * Redacts sensitive credentials, tokens, or query strings inside URL fragments (hashes).
 */
function redactFragment(fragment: string): { modified: boolean; result: string } {
  if (!fragment || fragment === '#') return { modified: false, result: fragment };

  const rawContent = fragment.startsWith('#') ? fragment.slice(1) : fragment;

  if (JWT_PATTERN.test(rawContent)) return { modified: true, result: '#[REDACTED_JWT]' };
  if (/^(?:sk_live_|sk_test_|ghp_|AIzaSy|xox[baprs]-)/.test(rawContent)) {
    return { modified: true, result: '#[REDACTED_API_KEY]' };
  }

  const queryIndex = rawContent.indexOf('?');
  if (queryIndex !== -1) {
    const routePart = rawContent.slice(0, queryIndex);
    const queryPart = rawContent.slice(queryIndex + 1);
    const { modified, result } = redactQueryString(queryPart);
    if (modified) {
      return { modified: true, result: `#${routePart}?${result}` };
    }
  }

  if (rawContent.includes('=')) {
    const { modified, result } = redactQueryString(rawContent);
    if (modified) {
      return { modified: true, result: `#${result}` };
    }
  }

  return { modified: false, result: fragment };
}

/**
 * Fallback regex-based redactor for malformed URLs, relative paths, or non-standard inputs.
 */
export function redactUrlFallback(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;

  let result = rawUrl;

  // Redact credentials embedded in authority (e.g. http://user:pass@example.com)
  result = result.replace(/(https?:\/\/)([^/@\s]+):([^/@\s]+)@/gi, '$1$2:[REDACTED]@');

  // Redact query and fragment parameters matching sensitive keys
  if (
    result.includes('?') ||
    result.includes('&') ||
    result.includes('#') ||
    result.includes(';')
  ) {
    result = result.replace(/([?&#;])([^=&#;\s]+)=([^&#;\s]*)/g, (match, prefix, key, val) => {
      if (isSensitiveQueryKey(key)) {
        return `${prefix}${key}=[REDACTED]`;
      }
      const sanitizedVal = sanitizeQueryParamValue(val);
      if (sanitizedVal !== val) {
        return `${prefix}${key}=${sanitizedVal}`;
      }
      return match;
    });
  }

  // Redact standalone JWTs
  result = result.replace(
    /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]+\b/g,
    '[REDACTED_JWT]',
  );

  return result;
}

/**
 * Redacts sensitive credentials, query parameters, embedded path tokens, and URL fragments.
 * Preserves benign query parameters and keeps URL parsing safe and deterministic.
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

    // 2. Redact sensitive query parameters and nested URLs in query values
    for (const [key, val] of parsed.searchParams) {
      if (isSensitiveQueryKey(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
        modified = true;
      } else if (val) {
        const sanitizedVal = sanitizeQueryParamValue(val);
        if (sanitizedVal !== val) {
          parsed.searchParams.set(key, sanitizedVal);
          modified = true;
        }
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

    // 4. Redact sensitive credentials/tokens in URL hash / fragment
    if (parsed.hash) {
      const { modified: hashModified, result: redactedHash } = redactFragment(parsed.hash);
      if (hashModified) {
        parsed.hash = redactedHash;
        modified = true;
      }
    }

    return modified ? parsed.toString() : rawUrl;
  } catch {
    // If URL parsing fails, apply regex fallback for query parameters and fragments
    return redactUrlFallback(rawUrl);
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
