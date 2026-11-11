/* eslint-disable */
import { _electron } from 'playwright-core';
import path from 'node:path';

async function main() {
  const exePath = path.resolve(
    'apps/desktop/dist/win-unpacked/Ultimate WordPress & Website Auditor.exe',
  );
  console.log('Launching:', exePath);

  const app = await _electron.launch({
    executablePath: exePath,
    timeout: 30000,
  });

  try {
    const versionInfo = await app.evaluate(async ({ app }) => {
      return {
        versions: process.versions,
        arch: process.arch,
        platform: process.platform,
        isPackaged: app.isPackaged,
        userData: app.getPath('userData'),
        appData: app.getPath('appData'),
        execPath: process.execPath,
      };
    });

    console.log('\n--- PACKAGED ELECTRON RUNTIME VERSIONS ---');
    console.log(JSON.stringify(versionInfo, null, 2));

    const window = await app.firstWindow({ timeout: 15000 });
    const userAgent = await window.evaluate(() => navigator.userAgent);
    console.log('\nRenderer Navigator UserAgent:', userAgent);
  } finally {
    await app.close();
    console.log('\nPackaged app closed.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
