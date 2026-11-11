import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const appData = process.env.APPDATA || 'C:\\Users\\Ahmed Hamdy\\AppData\\Roaming';
const dbPath = path.join(
  appData,
  'ultimate-wordpress-and-website-auditor',
  'database',
  'auditor.db',
);
const db = new DatabaseSync(dbPath, { readOnly: true });

// Check findings timestamps for a scan to see duration of browser audits
const scans = db
  .prepare(
    `SELECT id, status, started_at, completed_at, duration_ms, summary_json, error_json FROM scan_runs ORDER BY created_at DESC LIMIT 5`,
  )
  .all();

for (const s of scans) {
  console.log(`\nScan ${s.id} (${s.status}, duration: ${s.duration_ms}ms)`);
  const err = s.error_json ? JSON.parse(s.error_json) : null;
  console.log('Error details:', err?.details);

  // Look at screenshot directory for this scan
  const shotDir = path.join(
    appData,
    'ultimate-wordpress-and-website-auditor',
    'reports',
    'screenshots',
    s.id,
  );
  if (fs.existsSync(shotDir)) {
    const files = fs
      .readdirSync(shotDir)
      .map(f => {
        const stat = fs.statSync(path.join(shotDir, f));
        return { file: f, mtime: stat.mtimeMs, iso: stat.mtime.toISOString() };
      })
      .sort((a, b) => a.mtime - b.mtime);

    console.log(`Found ${files.length} screenshots in ${shotDir}:`);
    if (files.length > 0) {
      const first = files[0];
      const last = files[files.length - 1];
      console.log(`  First shot: ${first.iso}`);
      console.log(`  Last shot:  ${last.iso}`);
      console.log(`  Screenshot span: ${((last.mtime - first.mtime) / 1000).toFixed(2)}s`);
    }
  }
}
