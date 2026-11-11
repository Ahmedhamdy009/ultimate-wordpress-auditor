import fs from 'node:fs';
import path from 'node:path';

const appData = process.env.APPDATA || 'C:\\Users\\Ahmed Hamdy\\AppData\\Roaming';
const screenshotsBase = path.join(
  appData,
  'ultimate-wordpress-and-website-auditor',
  'reports',
  'screenshots',
);

if (fs.existsSync(screenshotsBase)) {
  const dirs = fs.readdirSync(screenshotsBase);
  console.log('Screenshot scan dirs:', dirs);
  for (const d of dirs) {
    const scanPath = path.join(screenshotsBase, d);
    if (fs.statSync(scanPath).isDirectory()) {
      const files = fs
        .readdirSync(scanPath)
        .map(f => {
          const s = fs.statSync(path.join(scanPath, f));
          return { name: f, mtime: s.mtimeMs, iso: s.mtime.toISOString(), size: s.size };
        })
        .sort((a, b) => a.mtime - b.mtime);
      console.log(`\nScan ${d}: ${files.length} screenshots`);
      if (files.length > 0) {
        console.log(`  First shot: ${files[0].iso} (${files[0].name})`);
        console.log(
          `  Last shot:  ${files[files.length - 1].iso} (${files[files.length - 1].name})`,
        );
        console.log(
          `  Duration between first and last: ${((files[files.length - 1].mtime - files[0].mtime) / 1000).toFixed(2)}s`,
        );
        // Group by URL or page if possible
        for (let i = 0; i < Math.min(5, files.length); i++) {
          console.log(`   [${i}] ${files[i].iso} - ${files[i].name} (${files[i].size} bytes)`);
        }
        for (let i = Math.max(0, files.length - 3); i < files.length; i++) {
          console.log(`   [${i}] ${files[i].iso} - ${files[i].name} (${files[i].size} bytes)`);
        }
      }
    }
  }
}
