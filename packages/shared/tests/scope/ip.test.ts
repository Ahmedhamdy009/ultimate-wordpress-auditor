import { describe, it, expect } from 'vitest';
import {
  parseIPv4ToUint32,
  uint32ToIPv4,
  parseIPv6ToBigInt,
  isIPv4InCidr,
  isIPv6InCidr,
  unwrapIPv4MappedIPv6,
  isIpAllowedForScan,
} from '../../src/scope/ip.js';

describe('IP Scope & SSRF Security Protection', () => {
  describe('IPv4 Parsing and Integer Conversion', () => {
    it('correctly converts canonical dotted-decimal IPv4 to uint32', () => {
      expect(parseIPv4ToUint32('0.0.0.0')).toBe(0);
      expect(parseIPv4ToUint32('255.255.255.255')).toBe(4294967295);
      expect(parseIPv4ToUint32('192.168.1.1')).toBe(3232235777);
      expect(parseIPv4ToUint32('127.0.0.1')).toBe(2130706433);
    });

    it('roundtrips uint32 back to dotted-decimal IPv4 string', () => {
      expect(uint32ToIPv4(0)).toBe('0.0.0.0');
      expect(uint32ToIPv4(4294967295)).toBe('255.255.255.255');
      expect(uint32ToIPv4(3232235777)).toBe('192.168.1.1');
    });

    it('rejects leading zeroes and octal representations fail-closed', () => {
      expect(parseIPv4ToUint32('01.02.03.04')).toBeNull();
      expect(parseIPv4ToUint32('192.168.01.1')).toBeNull();
      expect(parseIPv4ToUint32('0177.0.0.1')).toBeNull();
    });

    it('rejects malformed and out-of-range strings', () => {
      expect(parseIPv4ToUint32('256.0.0.1')).toBeNull();
      expect(parseIPv4ToUint32('1.2.3')).toBeNull();
      expect(parseIPv4ToUint32('1.2.3.4.5')).toBeNull();
      expect(parseIPv4ToUint32('not-an-ip')).toBeNull();
      expect(parseIPv4ToUint32('')).toBeNull();
    });
  });

  describe('IPv6 Parsing and BigInt Conversion', () => {
    it('correctly converts canonical IPv6 to 128-bit BigInt', () => {
      expect(parseIPv6ToBigInt('::')).toBe(0n);
      expect(parseIPv6ToBigInt('::1')).toBe(1n);
      expect(parseIPv6ToBigInt('2001:db8::1')).toBe((0x2001n << 112n) | (0x0db8n << 96n) | 1n);
    });

    it('rejects malformed IPv6 strings', () => {
      expect(parseIPv6ToBigInt(':::')).toBeNull();
      expect(parseIPv6ToBigInt('2001:xyz::1')).toBeNull();
      expect(parseIPv6ToBigInt('127.0.0.1')).toBeNull();
    });
  });

  describe('CIDR Matching Logic', () => {
    it('evaluates IPv4 CIDR boundaries accurately', () => {
      expect(isIPv4InCidr('192.168.1.5', '192.168.1.0/24')).toBe(true);
      expect(isIPv4InCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
      expect(isIPv4InCidr('10.254.12.3', '10.0.0.0/8')).toBe(true);
      expect(isIPv4InCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
      expect(isIPv4InCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
      expect(isIPv4InCidr('192.168.1.1', '192.168.1.1/32')).toBe(true);
      expect(isIPv4InCidr('192.168.1.2', '192.168.1.1/32')).toBe(false);
    });

    it('rejects invalid IPv4 CIDR strings fail-closed', () => {
      expect(isIPv4InCidr('192.168.1.1', '192.168.1.0/33')).toBe(false);
      expect(isIPv4InCidr('192.168.1.1', '192.168.1.0/-1')).toBe(false);
      expect(isIPv4InCidr('192.168.1.1', 'invalid-cidr')).toBe(false);
    });

    it('evaluates IPv6 CIDR boundaries accurately', () => {
      expect(isIPv6InCidr('2001:db8::1234', '2001:db8::/32')).toBe(true);
      expect(isIPv6InCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
      expect(isIPv6InCidr('fe80::1', 'fe80::/10')).toBe(true);
      expect(isIPv6InCidr('2606:4700::1', '::/0')).toBe(true);
      expect(isIPv6InCidr('2001:db8::1', '2001:db8::1/128')).toBe(true);
      expect(isIPv6InCidr('2001:db8::2', '2001:db8::1/128')).toBe(false);
    });

    it('rejects invalid IPv6 CIDR strings fail-closed', () => {
      expect(isIPv6InCidr('2001:db8::1', '2001:db8::/129')).toBe(false);
      expect(isIPv6InCidr('2001:db8::1', '2001:db8::/-5')).toBe(false);
      expect(isIPv6InCidr('2001:db8::1', 'not-valid')).toBe(false);
    });
  });

  describe('IPv4-Mapped IPv6 Unwrapping (RFC 4291)', () => {
    it('correctly unwraps ::ffff:0:0/96 to IPv4 string', () => {
      expect(unwrapIPv4MappedIPv6('::ffff:127.0.0.1')).toBe('127.0.0.1');
      expect(unwrapIPv4MappedIPv6('::ffff:192.168.1.1')).toBe('192.168.1.1');
      expect(unwrapIPv4MappedIPv6('0:0:0:0:0:ffff:10.0.0.1')).toBe('10.0.0.1');
      expect(unwrapIPv4MappedIPv6('::ffff:93.184.216.34')).toBe('93.184.216.34');
    });

    it('returns null for non-mapped IPv6 addresses', () => {
      expect(unwrapIPv4MappedIPv6('::1')).toBeNull();
      expect(unwrapIPv4MappedIPv6('2001:db8::1')).toBeNull();
      expect(unwrapIPv4MappedIPv6('fe80::1')).toBeNull();
      expect(unwrapIPv4MappedIPv6('not-an-ip')).toBeNull();
    });
  });

  describe('Strict isIpAllowedForScan Security Policy', () => {
    describe('Rejects all IPv4 SSRF and special-purpose vectors', () => {
      const prohibitedIPv4 = [
        ['127.0.0.1', 'Loopback'],
        ['127.0.0.2', 'Loopback block'],
        ['127.255.255.255', 'Loopback end'],
        ['10.0.0.1', 'Private RFC 1918 10/8'],
        ['10.255.255.255', 'Private RFC 1918 10/8 end'],
        ['172.16.0.1', 'Private RFC 1918 172.16/12'],
        ['172.31.255.255', 'Private RFC 1918 172.16/12 end'],
        ['192.168.0.1', 'Private RFC 1918 192.168/16'],
        ['192.168.255.255', 'Private RFC 1918 192.168/16 end'],
        ['169.254.169.254', 'AWS/GCP/Azure Cloud Metadata (Link-Local)'],
        ['169.254.1.1', 'Link-Local 169.254/16'],
        ['100.64.0.1', 'Carrier-Grade NAT (CGNAT) RFC 6598'],
        ['100.127.255.255', 'Carrier-Grade NAT end'],
        ['192.0.2.1', 'TEST-NET-1 (RFC 5737)'],
        ['198.51.100.1', 'TEST-NET-2 (RFC 5737)'],
        ['203.0.113.1', 'TEST-NET-3 (RFC 5737)'],
        ['198.18.0.1', 'Benchmarking (RFC 2544)'],
        ['224.0.0.1', 'Multicast (224/4)'],
        ['239.255.255.255', 'Multicast end'],
        ['240.0.0.1', 'Class E Reserved (240/4)'],
        ['255.255.255.255', 'Limited Broadcast'],
        ['0.0.0.0', 'This host on this network (RFC 1122)'],
        ['0.0.0.1', '0.0.0.0/8 block'],
        ['192.0.0.1', 'IETF Protocol Assignments (RFC 6890)'],
        ['192.88.99.1', '6to4 Relay Anycast (RFC 7526)'],
      ];

      for (const [ip, label] of prohibitedIPv4) {
        it(`rejects prohibited IPv4 address: ${ip} (${label})`, () => {
          const res = isIpAllowedForScan(ip);
          expect(res.allowed).toBe(false);
          expect(res.reason).toBeDefined();
          expect(res.ip).toBe(ip);
        });
      }
    });

    describe('Rejects all IPv6 SSRF and special-purpose vectors', () => {
      const prohibitedIPv6 = [
        ['::1', 'IPv6 Loopback'],
        ['::', 'IPv6 Unspecified'],
        ['fe80::1', 'IPv6 Link-Local Unicast (fe80::/10)'],
        ['fe80::dead:beef', 'IPv6 Link-Local Unicast'],
        ['fc00::1', 'IPv6 Unique Local Address (ULA fc00::/7)'],
        ['fd00::1', 'IPv6 Unique Local Address (ULA fd00::/8)'],
        ['ff02::1', 'IPv6 Link-Local Multicast (ff00::/8)'],
        ['ff05::2', 'IPv6 Site-Local Multicast'],
        ['2001:db8::1', 'IPv6 Documentation prefix (2001:db8::/32)'],
        ['2002::1', '6to4 prefix (2002::/16)'],
        ['64:ff9b::1', 'IPv4-IPv6 Translation (64:ff9b::/96)'],
        ['100::1', 'Discard-Only Address Block (RFC 6666)'],
        ['2001::1', 'TEREDO prefix (RFC 4380)'],
      ];

      for (const [ip, label] of prohibitedIPv6) {
        it(`rejects prohibited IPv6 address: ${ip} (${label})`, () => {
          const res = isIpAllowedForScan(ip);
          expect(res.allowed).toBe(false);
          expect(res.reason).toBeDefined();
          expect(res.ip).toBe(ip);
        });
      }
    });

    describe('Rejects IPv6 Scoped Zone Literals (RFC 4007)', () => {
      it('rejects scoped literals with zone identifiers fail-closed', () => {
        const res = isIpAllowedForScan('fe80::1%eth0');
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain('zone identifiers');
      });
    });

    describe('Unwraps and strictly evaluates IPv4-mapped IPv6', () => {
      it('rejects ::ffff:127.0.0.1 (embedded loopback)', () => {
        const res = isIpAllowedForScan('::ffff:127.0.0.1');
        expect(res.allowed).toBe(false);
        expect(res.unwrappedFromIpv6).toBe(true);
        expect(res.reason).toContain('127.0.0.1');
      });

      it('rejects ::ffff:169.254.169.254 (embedded cloud metadata)', () => {
        const res = isIpAllowedForScan('::ffff:169.254.169.254');
        expect(res.allowed).toBe(false);
        expect(res.unwrappedFromIpv6).toBe(true);
        expect(res.reason).toContain('169.254.169.254');
      });

      it('allows ::ffff:93.184.216.34 (embedded public IP)', () => {
        const res = isIpAllowedForScan('::ffff:93.184.216.34');
        expect(res.allowed).toBe(true);
        expect(res.unwrappedFromIpv6).toBe(true);
        expect(res.family).toBe(6);
      });
    });

    describe('Allows valid Globally Routable Public Unicast destinations', () => {
      const publicIPs = [
        ['93.184.216.34', 4, 'example.com IPv4'],
        ['1.1.1.1', 4, 'Cloudflare DNS'],
        ['8.8.8.8', 4, 'Google DNS'],
        ['104.16.132.229', 4, 'Cloudflare CDN'],
        ['2606:2800:220:1:248:1893:25c8:1946', 6, 'example.com IPv6 (2000::/3)'],
        ['2001:4860:4860::8888', 6, 'Google DNS IPv6 (2000::/3)'],
        ['2606:4700:4700::1111', 6, 'Cloudflare DNS IPv6 (2000::/3)'],
      ];

      for (const [ip, family, label] of publicIPs) {
        it(`allows public destination: ${ip} (${label})`, () => {
          const res = isIpAllowedForScan(ip as string);
          expect(res.allowed).toBe(true);
          expect(res.family).toBe(family);
        });
      }
    });

    describe('Handles bracketed IPv6 literals safely', () => {
      it('allows bracketed public IPv6 destination', () => {
        const res = isIpAllowedForScan('[2606:2800:220:1:248:1893:25c8:1946]');
        expect(res.allowed).toBe(true);
        expect(res.family).toBe(6);
      });

      it('rejects bracketed prohibited IPv6 destinations fail-closed', () => {
        expect(isIpAllowedForScan('[::1]').allowed).toBe(false);
        expect(isIpAllowedForScan('[fe80::1]').allowed).toBe(false);
        expect(isIpAllowedForScan('[fc00::1]').allowed).toBe(false);
      });
    });

    describe('Rejects invalid and unparseable inputs fail-closed', () => {
      it('rejects malformed and non-IP inputs', () => {
        expect(isIpAllowedForScan('').allowed).toBe(false);
        expect(isIpAllowedForScan('   ').allowed).toBe(false);
        expect(isIpAllowedForScan('localhost').allowed).toBe(false);
        expect(isIpAllowedForScan('example.com').allowed).toBe(false);
        expect(isIpAllowedForScan('300.300.300.300').allowed).toBe(false);
        // @ts-expect-error Testing invalid runtime input
        expect(isIpAllowedForScan(null).allowed).toBe(false);
        // @ts-expect-error Testing invalid runtime input
        expect(isIpAllowedForScan(undefined).allowed).toBe(false);
      });
    });
  });
});
