/**
 * RFC 6890 and IANA compliant pure TypeScript IPv4 and IPv6 classification and CIDR matcher.
 * 100% Isomorphic: Zero Node.js built-ins. Safe for Renderer, Preload, and Main.
 */

import {
  IANA_IPV4_SPECIAL_RANGES,
  IANA_IPV6_SPECIAL_RANGES,
  type IanaSpecialAddressEntry,
} from './iana-registry.js';
import { isValidIPv4, isValidIPv6, canonicalizeIPv6 } from './guard.js';

/**
 * Parses dotted-decimal IPv4 address into a 32-bit unsigned integer.
 * Rejects non-canonical octets (e.g. leading zeros, octals, hex, out-of-range).
 */
export function parseIPv4ToUint32(ip: string): number | null {
  if (!isValidIPv4(ip)) {
    return null;
  }
  const parts = ip.trim().split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Converts a 32-bit unsigned integer to dotted-decimal IPv4 string.
 */
export function uint32ToIPv4(uint32: number): string {
  const o0 = (uint32 >>> 24) & 255;
  const o1 = (uint32 >>> 16) & 255;
  const o2 = (uint32 >>> 8) & 255;
  const o3 = uint32 & 255;
  return `${o0}.${o1}.${o2}.${o3}`;
}

/**
 * Parses canonical 8-group IPv6 address into a 128-bit unsigned BigInt.
 */
export function parseIPv6ToBigInt(ip: string): bigint | null {
  if (!isValidIPv6(ip)) {
    return null;
  }
  try {
    const canonical = canonicalizeIPv6(ip);
    const groups = canonical.split(':').map(g => BigInt(parseInt(g, 16)));
    let result = 0n;
    for (const group of groups) {
      result = (result << 16n) | group;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Evaluates whether an IPv4 address falls within an IPv4 CIDR block.
 */
export function isIPv4InCidr(ip: string, cidr: string): boolean {
  const ipNum = parseIPv4ToUint32(ip);
  if (ipNum === null) return false;

  const [baseIp, prefixStr] = cidr.split('/');
  if (!baseIp || prefixStr === undefined) return false;

  const prefixLen = Number(prefixStr);
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;

  const baseNum = parseIPv4ToUint32(baseIp);
  if (baseNum === null) return false;

  if (prefixLen === 0) return true;
  const mask = ((0xffffffff << (32 - prefixLen)) & 0xffffffff) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

/**
 * Evaluates whether an IPv6 address falls within an IPv6 CIDR block.
 */
export function isIPv6InCidr(ip: string, cidr: string): boolean {
  const ipBig = parseIPv6ToBigInt(ip);
  if (ipBig === null) return false;

  const [baseIp, prefixStr] = cidr.split('/');
  if (!baseIp || prefixStr === undefined) return false;

  const prefixLen = Number(prefixStr);
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) return false;

  const baseBig = parseIPv6ToBigInt(baseIp);
  if (baseBig === null) return false;

  if (prefixLen === 0) return true;
  const totalBits = 128n;
  const prefixBits = BigInt(prefixLen);
  const shift = totalBits - prefixBits;
  const mask = ((1n << totalBits) - 1n) ^ ((1n << shift) - 1n);

  return (ipBig & mask) === (baseBig & mask);
}

/**
 * Unwraps an IPv4-mapped IPv6 address (RFC 4291, ::ffff:0:0/96) to native IPv4 string.
 * Example: '::ffff:127.0.0.1' -> '127.0.0.1'
 * Returns null if the address is not an IPv4-mapped IPv6 address.
 */
export function unwrapIPv4MappedIPv6(ip: string): string | null {
  if (!isValidIPv6(ip)) return null;

  try {
    const canonical = canonicalizeIPv6(ip);
    // Canonical format: 0000:0000:0000:0000:0000:ffff:XXXX:XXXX
    if (canonical.startsWith('0000:0000:0000:0000:0000:ffff:')) {
      const groups = canonical.split(':');
      const g6 = parseInt(groups[6], 16);
      const g7 = parseInt(groups[7], 16);
      const o0 = (g6 >>> 8) & 255;
      const o1 = g6 & 255;
      const o2 = (g7 >>> 8) & 255;
      const o3 = g7 & 255;
      return `${o0}.${o1}.${o2}.${o3}`;
    }
  } catch {
    return null;
  }

  return null;
}

export interface IpValidationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly ip: string;
  readonly family?: 4 | 6;
  readonly unwrappedFromIpv6?: boolean;
  readonly matchedEntry?: IanaSpecialAddressEntry;
}

/**
 * Strictly verifies whether an IP address is permitted for outgoing external scanning.
 * Fail-closed policy:
 * - Unwraps IPv4-mapped IPv6 addresses and evaluates embedded octets against IPv4 registry.
 * - Rejects any IPv4 or IPv6 address matching a non-globally reachable IANA special range.
 * - Rejects IPv6 scoped literals with interface zone identifiers (RFC 4007).
 * - Enforces that IPv6 addresses fall within Globally Routable Unicast space (2000::/3),
 *   blocking non-global unicast, link-local, ULA, multicast, and unspecified blocks.
 * - Returns allowed: true ONLY for confirmed Globally Routable Public Unicast destinations.
 */
export function isIpAllowedForScan(ipInput: string): IpValidationResult {
  if (!ipInput || typeof ipInput !== 'string') {
    return {
      allowed: false,
      reason: 'Empty or invalid IP address specification.',
      ip: String(ipInput),
    };
  }

  let trimmed = ipInput.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Reject IPv6 scoped zone identifiers (RFC 4007, e.g. fe80::1%eth0)
  if (trimmed.includes('%')) {
    return {
      allowed: false,
      reason: 'IPv6 scoped literals with zone identifiers (e.g. %eth0) are strictly forbidden.',
      ip: trimmed,
    };
  }

  // Check IPv4-mapped IPv6 first (::ffff:0:0/96)
  if (isValidIPv6(trimmed)) {
    const unwrappedIPv4 = unwrapIPv4MappedIPv6(trimmed);
    if (unwrappedIPv4 !== null) {
      // Evaluate embedded IPv4 address against IPv4 rules
      const v4Result = isIpAllowedForScan(unwrappedIPv4);
      if (!v4Result.allowed) {
        return {
          allowed: false,
          reason: `IPv4-mapped IPv6 address unwrapped to prohibited destination '${unwrappedIPv4}': ${v4Result.reason}`,
          ip: trimmed,
          family: 6,
          unwrappedFromIpv6: true,
          matchedEntry: v4Result.matchedEntry,
        };
      }
      return {
        allowed: true,
        ip: trimmed,
        family: 6,
        unwrappedFromIpv6: true,
      };
    }

    // Native IPv6 validation against IANA registry
    for (const entry of IANA_IPV6_SPECIAL_RANGES) {
      // Split multiple CIDRs in single entry (e.g. comma-separated)
      const cidrBlocks = entry.cidr.split(',').map(c => c.trim().split(' ')[0]);
      for (const cidr of cidrBlocks) {
        if (isIPv6InCidr(trimmed, cidr)) {
          if (!entry.globallyReachable) {
            return {
              allowed: false,
              reason: `Matched non-global IANA IPv6 special range: '${entry.name}' (${entry.cidr}, ${entry.rfc}).`,
              ip: trimmed,
              family: 6,
              matchedEntry: entry,
            };
          }
        }
      }
    }

    // Multicast check (ff00::/8)
    if (isIPv6InCidr(trimmed, 'ff00::/8')) {
      return {
        allowed: false,
        reason: 'IPv6 Multicast addresses (ff00::/8) are strictly forbidden.',
        ip: trimmed,
        family: 6,
      };
    }

    // Global Unicast validation (RFC 4291: 2000::/3)
    // Permitted IPv6 scanning targets must fall within 2000::/3 global unicast space
    if (!isIPv6InCidr(trimmed, '2000::/3')) {
      return {
        allowed: false,
        reason: 'IPv6 address does not fall within the Globally Routable Unicast block (2000::/3).',
        ip: trimmed,
        family: 6,
      };
    }

    return { allowed: true, ip: trimmed, family: 6 };
  }

  // IPv4 validation
  if (isValidIPv4(trimmed)) {
    for (const entry of IANA_IPV4_SPECIAL_RANGES) {
      const cidrBlocks = entry.cidr.split(',').map(c => c.trim().split(' ')[0]);
      for (const cidr of cidrBlocks) {
        if (isIPv4InCidr(trimmed, cidr)) {
          if (!entry.globallyReachable) {
            return {
              allowed: false,
              reason: `Matched non-global IANA IPv4 special range: '${entry.name}' (${entry.cidr}, ${entry.rfc}).`,
              ip: trimmed,
              family: 4,
              matchedEntry: entry,
            };
          }
        }
      }
    }

    // Multicast check (224.0.0.0/4)
    if (isIPv4InCidr(trimmed, '224.0.0.0/4')) {
      return {
        allowed: false,
        reason: 'IPv4 Multicast addresses (224.0.0.0/4) are strictly forbidden.',
        ip: trimmed,
        family: 4,
      };
    }

    // Class E Reserved check (240.0.0.0/4)
    if (isIPv4InCidr(trimmed, '240.0.0.0/4')) {
      return {
        allowed: false,
        reason: 'IPv4 Class E Reserved addresses (240.0.0.0/4) are strictly forbidden.',
        ip: trimmed,
        family: 4,
      };
    }

    // Limited Broadcast check (255.255.255.255)
    if (trimmed === '255.255.255.255') {
      return {
        allowed: false,
        reason: 'IPv4 Limited Broadcast address (255.255.255.255) is strictly forbidden.',
        ip: trimmed,
        family: 4,
      };
    }

    return { allowed: true, ip: trimmed, family: 4 };
  }

  return {
    allowed: false,
    reason: `Invalid or unparseable IP address format: "${trimmed}".`,
    ip: trimmed,
  };
}
