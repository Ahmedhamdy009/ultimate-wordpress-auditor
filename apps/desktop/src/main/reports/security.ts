/**
 * Security and sanitization utilities for report generation.
 * Protects against XSS, HTML injection, URL hijacking, formula injection, and secret leakage.
 */

const SENSITIVE_KEY_REGEX =
  /(authorization|auth|cookie|set-cookie|token|secret|password|passwd|api[-_]?key|private[-_]?key|bearer|access[-_]?token|refresh[-_]?token|session|credential)/i;

const SENSITIVE_STRING_PATTERNS = [
  { regex: /Bearer\s+[a-zA-Z0-9_\-.]+/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { regex: /eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]+/gi, replacement: '[REDACTED_JWT]' },
  { regex: /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/gi, replacement: '[REDACTED_PRIVATE_KEY]' },
  { regex: /([?&](?:password|passwd|token|secret|api[-_]?key|apikey)=)[^&]+/gi, replacement: '$1[REDACTED]' },
  { regex: /[C-Z]:\\Users\\[^\\]+/gi, replacement: 'C:\\Users\\[REDACTED_USER]' },
];

/**
 * Context-aware HTML escaping.
 * Converts characters that have special meaning in HTML into safe entity representations.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = typeof value === 'string' ? value : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * Sanitizes URLs to ensure only safe http: and https: protocols are rendered in href attributes.
 * Disallows dangerous schemes like javascript:, data:, vbscript:, file:.
 */
export function sanitizeUrl(rawUrl: unknown): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '#';
  }

  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return escapeHtml(trimmed);
    }
    return '#';
  } catch {
    // Relative paths beginning with / or ./ are acceptable only if safe
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
      return escapeHtml(trimmed);
    }
    return '#';
  }
}

/**
 * Deeply recurses through objects and arrays to redact secrets, tokens, credentials, and sensitive paths.
 */
export function redactSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    let result = data;
    for (const pattern of SENSITIVE_STRING_PATTERNS) {
      result = result.replace(pattern.regex, pattern.replacement);
    }
    return result;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }

  if (typeof data === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        cleaned[key] = '[REDACTED_SECRET]';
      } else {
        cleaned[key] = redactSensitiveData(val);
      }
    }
    return cleaned;
  }

  return String(data);
}

/**
 * Escapes a field for safe CSV output compliant with RFC 4180.
 * Neutralizes spreadsheet formula injection (e.g. =, +, -, @, Tab, CR).
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }

  let str = typeof value === 'string' ? value : String(value);

  // Redact any secrets in string before export
  str = redactSensitiveData(str) as string;

  // Formula Injection Guard:
  // If the cell begins with =, +, -, @, \t, or \r, prepend a single quote (')
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // If the string contains double quotes, commas, newlines, or begins with an apostrophe, wrap in quotes
  const needsQuotes = str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r') || str.startsWith("'");

  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return `"${str}"`;
}
