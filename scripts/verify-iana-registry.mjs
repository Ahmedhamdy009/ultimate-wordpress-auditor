import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import console from 'node:console';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const snapshotsDir = path.join(projectRoot, 'packages', 'shared', 'src', 'scope', 'iana-snapshots');

function verifyFile(filename, expectedSha256) {
  const filePath = path.join(snapshotsDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing expected snapshot file: ${filePath}`);
  }
  const content = fs.readFileSync(filePath);
  const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${filename}!\nExpected: ${expectedSha256}\nActual:   ${actualSha256}`,
    );
  }
  console.log(
    `[verify-iana-registry] Verified ${filename} (${content.length} bytes, SHA-256 match)`,
  );
}

function main() {
  const metadataPath = path.join(snapshotsDir, 'snapshot-metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Missing snapshot metadata file: ${metadataPath}`);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  console.log(
    `[verify-iana-registry] Verifying IANA snapshots retrieved at ${metadata.retrievalTimestamp}...`,
  );
  verifyFile(metadata.snapshots.ipv4.filename, metadata.snapshots.ipv4.sha256);
  verifyFile(metadata.snapshots.ipv6.filename, metadata.snapshots.ipv6.sha256);
  console.log('[verify-iana-registry] All IANA snapshots successfully verified!');
}

main();
