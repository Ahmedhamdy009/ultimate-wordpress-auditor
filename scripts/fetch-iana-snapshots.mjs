import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const IANA_IPV4_URL =
  'https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv';
const IANA_IPV6_URL =
  'https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv';

const targetDir = path.join(projectRoot, 'packages', 'shared', 'src', 'scope', 'iana-snapshots');

async function downloadAndHash(url, destinationFilename) {
  const fetchFn = globalThis.fetch;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const buffer = Buffer.from(text, 'utf8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const destPath = path.join(targetDir, destinationFilename);
  fs.writeFileSync(destPath, buffer);

  return {
    filename: destinationFilename,
    byteLength: buffer.length,
    sha256,
  };
}

async function main() {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const retrievalTimestamp = new Date().toISOString();
  console.log(
    `[fetch-iana-snapshots] Fetching official IANA snapshots at ${retrievalTimestamp}...`,
  );

  const ipv4Result = await downloadAndHash(IANA_IPV4_URL, 'iana-ipv4-special-registry.csv');
  console.log(
    `[fetch-iana-snapshots] IPv4: ${ipv4Result.byteLength} bytes, SHA-256: ${ipv4Result.sha256}`,
  );

  const ipv6Result = await downloadAndHash(IANA_IPV6_URL, 'iana-ipv6-special-registry.csv');
  console.log(
    `[fetch-iana-snapshots] IPv6: ${ipv6Result.byteLength} bytes, SHA-256: ${ipv6Result.sha256}`,
  );

  const metadata = {
    retrievalTimestamp,
    generatorVersion: '1.0.0',
    registryParsingVersion: '1.0.0',
    snapshots: {
      ipv4: {
        canonicalSourceUrl: IANA_IPV4_URL,
        filename: ipv4Result.filename,
        byteLength: ipv4Result.byteLength,
        sha256: ipv4Result.sha256,
      },
      ipv6: {
        canonicalSourceUrl: IANA_IPV6_URL,
        filename: ipv6Result.filename,
        byteLength: ipv6Result.byteLength,
        sha256: ipv6Result.sha256,
      },
    },
  };

  const metadataPath = path.join(targetDir, 'snapshot-metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  console.log(`[fetch-iana-snapshots] Metadata written to ${metadataPath}`);
}

main().catch(err => {
  console.error('[fetch-iana-snapshots] Error:', err);
  process.exit(1);
});
