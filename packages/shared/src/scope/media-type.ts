/**
 * RFC 7231 / RFC 2045 compliant zero-dependency media-type (Content-Type) parser.
 * 100% Isomorphic: Pure TypeScript with zero Node.js built-ins.
 */

// RFC 7230 Section 3.2.6 token character set (tchar)
// tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
//         "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
const TCHAR_REGEX = /^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/;

export interface ParsedMediaType {
  readonly type: string;
  readonly subtype: string;
  readonly essence: string;
  readonly parameters: Readonly<Record<string, string>>;
}

export interface MediaTypeValidationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly parsed?: ParsedMediaType;
}

/**
 * Strictly parses an HTTP Content-Type header string according to RFC 7231 grammar.
 * Returns null if the header is missing, malformed, or violates token/parameter syntax.
 */
export function parseMediaType(headerValue?: string | null): ParsedMediaType | null {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const semiColonIdx = trimmed.indexOf(';');
  const typePart = semiColonIdx === -1 ? trimmed : trimmed.slice(0, semiColonIdx).trim();
  const paramsPart = semiColonIdx === -1 ? '' : trimmed.slice(semiColonIdx + 1);

  // Validate type / subtype
  const slashIdx = typePart.indexOf('/');
  if (slashIdx <= 0 || slashIdx === typePart.length - 1) {
    return null;
  }

  const rawType = typePart.slice(0, slashIdx);
  const rawSubtype = typePart.slice(slashIdx + 1);

  if (!TCHAR_REGEX.test(rawType) || !TCHAR_REGEX.test(rawSubtype)) {
    return null;
  }

  const type = rawType.toLowerCase();
  const subtype = rawSubtype.toLowerCase();
  const essence = `${type}/${subtype}`;

  // Parse parameters if present
  const parameters: Record<string, string> = {};

  if (paramsPart.trim().length > 0) {
    let cursor = 0;
    const len = paramsPart.length;

    while (cursor < len) {
      // Skip OWS and semicolon separators
      while (
        cursor < len &&
        (paramsPart[cursor] === ' ' || paramsPart[cursor] === '\t' || paramsPart[cursor] === ';')
      ) {
        cursor++;
      }
      if (cursor >= len) break;

      // Read parameter attribute (token)
      const eqIdx = paramsPart.indexOf('=', cursor);
      if (eqIdx === -1) {
        // Missing '=' delimiter in parameter
        return null;
      }

      const paramNameRaw = paramsPart.slice(cursor, eqIdx).trim();
      if (!TCHAR_REGEX.test(paramNameRaw)) {
        return null;
      }
      const paramName = paramNameRaw.toLowerCase();

      cursor = eqIdx + 1;
      // Skip OWS after '='
      while (cursor < len && (paramsPart[cursor] === ' ' || paramsPart[cursor] === '\t')) {
        cursor++;
      }

      if (cursor >= len) {
        // Empty parameter value
        return null;
      }

      let paramValue = '';

      if (paramsPart[cursor] === '"') {
        // Quoted string (RFC 7230 Section 3.2.6)
        cursor++; // consume opening quote
        let closed = false;

        while (cursor < len) {
          const ch = paramsPart[cursor];
          if (ch === '\\' && cursor + 1 < len) {
            // Escaped character (quoted-pair)
            paramValue += paramsPart[cursor + 1];
            cursor += 2;
          } else if (ch === '"') {
            closed = true;
            cursor++; // consume closing quote
            break;
          } else {
            paramValue += ch;
            cursor++;
          }
        }

        if (!closed) {
          // Unterminated quoted string
          return null;
        }
      } else {
        // Token value
        let endIdx = cursor;
        while (
          endIdx < len &&
          paramsPart[endIdx] !== ';' &&
          paramsPart[endIdx] !== ' ' &&
          paramsPart[endIdx] !== '\t'
        ) {
          endIdx++;
        }
        paramValue = paramsPart.slice(cursor, endIdx);
        if (!TCHAR_REGEX.test(paramValue)) {
          return null;
        }
        cursor = endIdx;
      }

      // Check duplicate parameters: fail-closed if conflicting duplicate
      if (
        parameters[paramName] !== undefined &&
        parameters[paramName] !== paramValue.toLowerCase()
      ) {
        return null;
      }

      parameters[paramName] = paramValue;
    }
  }

  return {
    type,
    subtype,
    essence,
    parameters: Object.freeze(parameters),
  };
}

/**
 * Whitelist of acceptable HTML media essences for passive external web auditing.
 */
export const ALLOWED_HTML_MEDIA_ESSENCES = Object.freeze(['text/html', 'application/xhtml+xml']);

/**
 * Strictly validates whether an HTTP Content-Type header conforms to authorized HTML media types.
 * Enforces:
 * - Valid RFC 7231 syntax.
 * - Essence must be 'text/html' or 'application/xhtml+xml'.
 * - Missing, malformed, or non-HTML media types are rejected fail-closed.
 * - Zero response-body MIME sniffing.
 */
export function validateHtmlContentType(headerValue?: string | null): MediaTypeValidationResult {
  if (!headerValue || typeof headerValue !== 'string' || headerValue.trim().length === 0) {
    return {
      allowed: false,
      reason:
        'Missing or empty Content-Type response header. Untrusted bodies without explicit MIME type are rejected.',
    };
  }

  const parsed = parseMediaType(headerValue);
  if (!parsed) {
    return {
      allowed: false,
      reason: `Malformed or invalid Content-Type header format: "${headerValue}".`,
    };
  }

  if (!ALLOWED_HTML_MEDIA_ESSENCES.includes(parsed.essence)) {
    return {
      allowed: false,
      reason: `Non-HTML media type "${parsed.essence}". Only text/html and application/xhtml+xml are accepted for page auditing.`,
      parsed,
    };
  }

  return {
    allowed: true,
    parsed,
  };
}
