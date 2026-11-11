import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  IANA_SNAPSHOT_METADATA,
  IANA_IPV4_SPECIAL_RANGES,
  IANA_IPV6_SPECIAL_RANGES,
} from '../../src/scope/iana-registry.js';
import { isIpAllowedForScan } from '../../src/scope/ip.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const snapshotsDir = path.join(projectRoot, 'packages', 'shared', 'src', 'scope', 'iana-snapshots');

describe('IANA Special-Purpose Address Registry Snapshots & Invariants', () => {
  it('has verified archived CSV snapshot files and metadata matching SHA-256 hashes', () => {
    const metadataPath = path.join(snapshotsDir, 'snapshot-metadata.json');
    expect(fs.existsSync(metadataPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    expect(metadata.retrievalTimestamp).toBe(IANA_SNAPSHOT_METADATA.retrievalTimestamp);
    expect(metadata.snapshots.ipv4.sha256).toBe(IANA_SNAPSHOT_METADATA.ipv4.sha256);
    expect(metadata.snapshots.ipv6.sha256).toBe(IANA_SNAPSHOT_METADATA.ipv6.sha256);

    // Verify IPv4 file hash
    const ipv4Path = path.join(snapshotsDir, metadata.snapshots.ipv4.filename);
    expect(fs.existsSync(ipv4Path)).toBe(true);
    const ipv4Bytes = fs.readFileSync(ipv4Path);
    const ipv4Sha = crypto.createHash('sha256').update(ipv4Bytes).digest('hex');
    expect(ipv4Sha).toBe(metadata.snapshots.ipv4.sha256);

    // Verify IPv6 file hash
    const ipv6Path = path.join(snapshotsDir, metadata.snapshots.ipv6.filename);
    expect(fs.existsSync(ipv6Path)).toBe(true);
    const ipv6Bytes = fs.readFileSync(ipv6Path);
    const ipv6Sha = crypto.createHash('sha256').update(ipv6Bytes).digest('hex');
    expect(ipv6Sha).toBe(metadata.snapshots.ipv6.sha256);
  });

  it('dynamically verifies that every non-global CIDR in the IPv4 snapshot is classified as blocked', () => {
    const ipv4Path = path.join(snapshotsDir, 'iana-ipv4-special-registry.csv');
    const lines = fs
      .readFileSync(ipv4Path, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    // Skip header line
    const dataLines = lines.slice(1);
    expect(dataLines.length).toBeGreaterThanOrEqual(20);

    for (const entry of IANA_IPV4_SPECIAL_RANGES) {
      if (!entry.globallyReachable) {
        // Extract base IP from CIDR
        const baseIp = entry.cidr.split('/')[0].split(',')[0].trim().split(' ')[0];
        // Test base IP rejection
        const result = isIpAllowedForScan(baseIp);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Matched non-global IANA IPv4 special range');
      }
    }
  });

  it('dynamically verifies that every non-global CIDR in the IPv6 snapshot is classified as blocked', () => {
    const ipv6Path = path.join(snapshotsDir, 'iana-ipv6-special-registry.csv');
    const lines = fs
      .readFileSync(ipv6Path, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const dataLines = lines.slice(1);
    expect(dataLines.length).toBeGreaterThanOrEqual(15);

    for (const entry of IANA_IPV6_SPECIAL_RANGES) {
      if (!entry.globallyReachable) {
        const rawCidr = entry.cidr.split(',')[0].trim().split(' ')[0];
        const baseIp = rawCidr.split('/')[0].trim();
        // Skip ::ffff:0:0 which is handled as IPv4-mapped
        if (baseIp === '::ffff:0:0') continue;

        const result = isIpAllowedForScan(baseIp);
        expect(result.allowed).toBe(false);
      }
    }
  });
});
