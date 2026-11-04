/**
 * Scope Guard configuration and URL validation boundaries.
 * Strictly enforces passive / read-only auditing boundaries per SECURITY_POLICY.md.
 * 100% Isomorphic: Zero Node.js built-ins. Safe for Node.js, Browser, and React Renderer.
 */

export interface ScopePolicyOptions {
  /**
   * Explicit list of allowed ports. If specified, target URL port must match one of these ports
   * for hosts that do not declare an explicit port.
   */
  readonly allowedPorts?: readonly number[];

  /**
   * If true, allows any port on the matching host.
   * Default is false (strict port matching: only standard protocol ports or explicit host port).
   */
  readonly allowAnyPort?: boolean;
}

export interface ScopeConfig extends ScopePolicyOptions {
  initialUrl: string;
  allowedHosts: readonly string[];
  maxPages: number;
  maxDepth: number;
  rateLimitPerSecond: number;
  timeoutMs: number;
}

/**
 * Pure TypeScript isomorphic validator for IPv4 addresses (dotted-decimal notation).
 * Validates that there are exactly 4 octets between 0 and 255 without leading zeros.
 */
export function isValidIPv4(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = Number(part);
    if (num < 0 || num > 255) return false;
  }
  return true;
}

/**
 * Pure TypeScript isomorphic validator for IPv6 addresses (RFC 4291 / RFC 5952).
 * Handles:
 * - Full 8-group addresses
 * - Compressed addresses with '::' (e.g. '::1', '::', '2001:db8::1')
 * - IPv4-mapped IPv6 addresses (e.g. '::ffff:192.168.1.1')
 * - Strictly rejects multiple '::', triple colons, invalid hex groups, or out-of-range counts.
 * Zero Node.js built-ins.
 */
export function isValidIPv6(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;

  const trimmed = ip.trim();
  if (trimmed.length < 2 || trimmed.length > 45) return false;

  // Reject triple colons
  if (trimmed.includes(':::')) {
    return false;
  }

  // Reject multiple double colons '::'
  const firstDoubleColon = trimmed.indexOf('::');
  if (firstDoubleColon !== -1 && trimmed.indexOf('::', firstDoubleColon + 2) !== -1) {
    return false;
  }

  let ipv6Part = trimmed;
  let expectedGroups = 8;

  // Check for IPv4-mapped trailing address (e.g. ::ffff:192.0.2.128 or 2001:db8::192.0.2.1)
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon !== -1 && trimmed.includes('.', lastColon)) {
    const ipv4Candidate = trimmed.slice(lastColon + 1);
    if (!isValidIPv4(ipv4Candidate)) {
      return false;
    }
    expectedGroups = 6;
    if (lastColon > 0 && trimmed[lastColon - 1] === ':') {
      // Preceded by '::', e.g. '2001:db8::192.0.2.1' -> retain '::'
      ipv6Part = trimmed.slice(0, lastColon + 1);
    } else {
      // Preceded by single ':', e.g. '::ffff:192.0.2.1'
      ipv6Part = trimmed.slice(0, lastColon);
      if (ipv6Part.endsWith(':') && !ipv6Part.endsWith('::')) {
        return false;
      }
    }
  }

  const hasDoubleColon = ipv6Part.includes('::');

  if (hasDoubleColon) {
    const [left, right] = ipv6Part.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];

    for (const g of leftGroups) {
      if (!g || !/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
    }
    for (const g of rightGroups) {
      if (!g || !/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
    }

    const totalGroups = leftGroups.length + rightGroups.length;
    return totalGroups < expectedGroups;
  } else {
    const groups = ipv6Part.split(':');
    if (groups.length !== expectedGroups) {
      return false;
    }
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
    }
    return true;
  }
}

/**
 * Pure TypeScript canonicalizer for IPv6 addresses.
 * Unifies all equivalent IPv6 representations (compressed '::', leading zeros, full 8 groups,
 * and IPv4-mapped/embedded addresses) into an invariant, 8-group, 16-bit hex format (each group 4 hex digits).
 *
 * Examples of identical canonical representations:
 * - '::1' and '0:0:0:0:0:0:0:1' -> '0000:0000:0000:0000:0000:0000:0000:0001'
 * - '2001:db8::1' and '2001:0db8:0:0:0:0:0:1' -> '2001:0db8:0000:0000:0000:0000:0000:0001'
 * - '::ffff:192.168.1.1' and '0:0:0:0:0:ffff:c0a8:0101' -> '0000:0000:0000:0000:0000:ffff:c0a8:0101'
 *
 * Zero Node.js built-ins.
 */
export function canonicalizeIPv6(ip: string): string {
  if (!isValidIPv6(ip)) {
    throw new Error(`Cannot canonicalize invalid IPv6 address: "${ip}".`);
  }

  const trimmed = ip.trim().toLowerCase();

  // 1. Process IPv4-embedded/mapped tail (e.g. ::ffff:192.168.1.1 or 2001:db8::192.0.2.1)
  let ipv6Prefix = trimmed;
  let embeddedIPv4Pieces: number[] = [];

  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon !== -1 && trimmed.includes('.', lastColon)) {
    const ipv4Candidate = trimmed.slice(lastColon + 1);
    const octets = ipv4Candidate.split('.').map(Number);
    const high = (octets[0] << 8) | octets[1];
    const low = (octets[2] << 8) | octets[3];
    embeddedIPv4Pieces = [high, low];

    if (lastColon > 0 && trimmed[lastColon - 1] === ':') {
      ipv6Prefix = trimmed.slice(0, lastColon + 1);
    } else {
      ipv6Prefix = trimmed.slice(0, lastColon);
    }
  }

  // 2. Expand groups and replace '::' with explicit zero groups
  const hasDoubleColon = ipv6Prefix.includes('::');
  let groups: number[];

  if (hasDoubleColon) {
    const [leftStr, rightStr] = ipv6Prefix.split('::');
    const leftPieces = leftStr
      ? leftStr
          .split(':')
          .filter(Boolean)
          .map(h => parseInt(h, 16))
      : [];
    const rightPieces = rightStr
      ? rightStr
          .split(':')
          .filter(Boolean)
          .map(h => parseInt(h, 16))
      : [];

    const totalExplicitPieces = leftPieces.length + rightPieces.length + embeddedIPv4Pieces.length;
    const missingZerosCount = 8 - totalExplicitPieces;
    const zeros = new Array(missingZerosCount).fill(0);

    groups = [...leftPieces, ...zeros, ...rightPieces, ...embeddedIPv4Pieces];
  } else {
    const hexPieces = ipv6Prefix ? ipv6Prefix.split(':').map(h => parseInt(h, 16)) : [];
    groups = [...hexPieces, ...embeddedIPv4Pieces];
  }

  if (groups.length !== 8) {
    throw new Error(`IPv6 address "${ip}" could not be resolved to 8 groups.`);
  }

  return groups.map(g => g.toString(16).padStart(4, '0')).join(':');
}

/**
 * Parses and validates host strings, supporting IPv4, bracketed/bare IPv6, domain names,
 * and optional port specifications.
 *
 * Strict behavior: Throws an Error if the host format or port is invalid.
 * Always canonicalizes IPv6 hosts to ensure invariant representations.
 * Never performs silent fallback on malformed inputs.
 */
export function parseHostAndPort(hostOrUrl: string): { host: string; port?: number } {
  const trimmed = hostOrUrl.trim();
  if (!trimmed) {
    throw new Error('Host specification cannot be empty.');
  }

  // 1. Bare IPv6 address (e.g. ::1 or 2001:db8::1 without brackets)
  if (isValidIPv6(trimmed)) {
    return { host: `[${canonicalizeIPv6(trimmed)}]` };
  }

  // 2. Bracketed IPv6 address (e.g. [::1] or [2001:db8::1]:8443)
  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']');
    if (closingBracket === -1) {
      throw new Error(
        `Malformed bracketed IPv6 address in "${hostOrUrl}". Missing closing bracket.`,
      );
    }
    const rawIp = trimmed.slice(1, closingBracket);
    if (!isValidIPv6(rawIp)) {
      throw new Error(`Invalid IPv6 address inside brackets in "${hostOrUrl}".`);
    }

    const canonicalIp = canonicalizeIPv6(rawIp);
    const remainder = trimmed.slice(closingBracket + 1);

    if (remainder.startsWith(':')) {
      const portCandidate = remainder.slice(1).split('/')[0];
      if (!/^\d+$/.test(portCandidate)) {
        throw new Error(`Invalid non-numeric port for IPv6 in "${hostOrUrl}".`);
      }
      const portNum = Number(portCandidate);
      if (portNum === 0 || portNum > 65535) {
        throw new Error(`Port number out of range (1-65535) in "${hostOrUrl}".`);
      }
      return { host: `[${canonicalIp}]`, port: portNum };
    } else if (remainder.length > 0 && remainder !== '/') {
      throw new Error(`Unexpected characters after bracketed IPv6 in "${hostOrUrl}".`);
    }

    return { host: `[${canonicalIp}]` };
  }

  // 3. Domain names, IPv4, and URLs
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);

  // Validate port if input is without scheme and has a colon (e.g. "example.com:invalid" or "example.com:99999")
  if (!hasScheme && trimmed.includes(':')) {
    const lastColon = trimmed.lastIndexOf(':');
    const portCandidate = trimmed.slice(lastColon + 1).split('/')[0];
    if (!/^\d+$/.test(portCandidate)) {
      throw new Error(`Invalid non-numeric port specification in "${hostOrUrl}".`);
    }
    const portNum = Number(portCandidate);
    if (portNum === 0 || portNum > 65535) {
      throw new Error(`Port number out of range (1-65535) in "${hostOrUrl}".`);
    }
  }

  const urlToParse = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(urlToParse);
  } catch {
    throw new Error(`Invalid host or URL format: "${hostOrUrl}".`);
  }

  let hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname.length === 0) {
    throw new Error(`Target host specification has no valid hostname: "${hostOrUrl}".`);
  }

  // Canonicalize IPv6 hostname if parsed from URL
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const innerIp = hostname.slice(1, -1);
    if (isValidIPv6(innerIp)) {
      hostname = `[${canonicalizeIPv6(innerIp)}]`;
    }
  }

  const port = parsed.port && parsed.port.length > 0 ? Number(parsed.port) : undefined;
  return { host: hostname, port };
}

/**
 * Normalizes host strings to canonical format (lowercase domain, IPv4, or canonical bracketed IPv6).
 *
 * Strict validation: Rejects malformed hosts and invalid ports instead of falling back to partial strings.
 */
export function normalizeHost(hostOrUrl: string): string {
  return parseHostAndPort(hostOrUrl).host;
}

/**
 * Returns the effective network port for a parsed URL (defaulting to 80 for http, 443 for https).
 */
export function getEffectivePort(url: URL): number {
  if (url.port && url.port.length > 0) {
    return Number(url.port);
  }
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * Validates whether a target URL conforms to basic HTTP/HTTPS security requirements.
 *
 * Security enforcement:
 * - Accepts only http: and https: protocols.
 * - Rejects any URL containing embedded credentials (username/password) to prevent credential leakage.
 */
export function validateScanTarget(targetUrl: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(targetUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        reason: `Unsupported protocol: ${parsed.protocol}. Only http and https are permitted.`,
      };
    }
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return { valid: false, reason: 'Target URL has no hostname.' };
    }

    // Strict credential rejection per SECURITY_POLICY.md
    if (parsed.username !== '' || parsed.password !== '') {
      return {
        valid: false,
        reason:
          'Target URL contains embedded credentials (username/password), which is strictly forbidden.',
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }
}

/**
 * Strictly verifies whether a target URL falls within the permitted scope hosts and ports.
 * Protects against scope creep and unauthorized external crawling.
 *
 * Port Scope Policy & Precedence:
 * 1. allowAnyPort: true explicitly permits any port on matching hosts.
 * 2. If allowedHosts entry specified an explicit port, it is matched exclusively.
 * 3. If allowedHosts entry did not specify a port, allowedPorts is applied if provided.
 * 4. If no explicit port and no allowedPorts, only the standard protocol port (80 for http, 443 for https) is permitted.
 * Note: allowedPorts never overrides or cancels an explicit port declared on an allowed host.
 */
export function isUrlInScope(
  targetUrl: string,
  allowedHosts: readonly string[],
  options?: ScopePolicyOptions,
): boolean {
  const targetValidation = validateScanTarget(targetUrl);
  if (!targetValidation.valid) {
    return false;
  }

  const parsed = new URL(targetUrl.trim());
  const targetHost = normalizeHost(parsed.hostname);
  const targetPort = getEffectivePort(parsed);

  const allowAnyPort = options?.allowAnyPort === true;
  const allowedPorts = options?.allowedPorts;

  for (const entry of allowedHosts) {
    let parsedEntry: { host: string; port?: number };
    try {
      parsedEntry = parseHostAndPort(entry);
    } catch {
      continue;
    }

    const hostMatches =
      targetHost === parsedEntry.host || targetHost.endsWith(`.${parsedEntry.host}`);

    if (!hostMatches) {
      continue;
    }

    // Rule 1: allowAnyPort explicitly permits any port on matching hosts
    if (allowAnyPort) {
      return true;
    }

    // Rule 2: If allowedHosts entry specified an explicit port, match it exclusively
    if (parsedEntry.port !== undefined) {
      if (targetPort === parsedEntry.port) {
        return true;
      }
      // Explicit port on this host entry did not match; check remaining entries
      continue;
    }

    // Rule 3: Entry did not specify a port. Check allowedPorts if provided
    if (allowedPorts && allowedPorts.length > 0) {
      if (allowedPorts.includes(targetPort)) {
        return true;
      }
      // Target port is not in allowedPorts; check remaining entries
      continue;
    }

    // Rule 4: No explicit port on entry and no allowedPorts. Only standard protocol port is permitted
    const defaultStandardPort = parsed.protocol === 'https:' ? 443 : 80;
    if (targetPort === defaultStandardPort) {
      return true;
    }
  }

  return false;
}
