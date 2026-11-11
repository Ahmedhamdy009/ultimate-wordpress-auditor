import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('Batch 5.2 — Electron Builder & Windows Installer Packaging Verification', () => {
  const projectRoot = path.resolve(import.meta.dirname, '../../../../');
  const desktopRoot = path.join(projectRoot, 'apps', 'desktop');
  const builderConfigPath = path.join(projectRoot, 'electron-builder.yml');
  const distDir = path.join(desktopRoot, 'dist');
  const winUnpackedDir = path.join(distDir, 'win-unpacked');
  const asarPath = path.join(winUnpackedDir, 'resources', 'app.asar');
  const asarUnpackedDir = path.join(winUnpackedDir, 'resources', 'app.asar.unpacked');
  const desktopPkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  const appVersion = desktopPkg.version;
  const installerExePath = path.join(
    distDir,
    `Ultimate WordPress & Website Auditor Setup ${appVersion}.exe`,
  );

  describe('1. Electron Builder Configuration Validation', () => {
    it('verifies electron-builder.yml exists and defines correct application metadata', () => {
      expect(fs.existsSync(builderConfigPath)).toBe(true);
      const content = fs.readFileSync(builderConfigPath, 'utf8');

      expect(content).toContain('appId: com.auditor.desktop');
      expect(content).toContain('productName: Ultimate WordPress & Website Auditor');
      expect(content).toContain('electronVersion: 44.10.2');
      expect(content).toContain('output: apps/desktop/dist');
      expect(content).toContain('app: apps/desktop');
      expect(content).toContain('asar: true');
      expect(content).toContain('npmRebuild: false');
    });

    it('verifies asarUnpack includes native bindings and native directory patterns', () => {
      const content = fs.readFileSync(builderConfigPath, 'utf8');
      expect(content).toContain("'**/*.node'");
      expect(content).toContain("'**/native/**/*'");
    });

    it('verifies NSIS configuration enforces user-level, non-destructive installer policies', () => {
      const content = fs.readFileSync(builderConfigPath, 'utf8');
      expect(content).toContain('oneClick: false');
      expect(content).toContain('allowToChangeInstallationDirectory: true');
      expect(content).toContain('perMachine: false');
      expect(content).toContain('createDesktopShortcut: true');
      expect(content).toContain('createStartMenuShortcut: true');
      expect(content).toContain('deleteAppDataOnUninstall: false');
      expect(content).toContain('shortcutName: Ultimate WordPress & Website Auditor');
      expect(content).toContain('installerIcon: apps/desktop/resources/icon.ico');
      expect(content).toContain('uninstallerIcon: apps/desktop/resources/icon.ico');
    });
  });

  describe('2. Packaging Scripts & Package Metadata', () => {
    it('verifies root package.json defines package and dist scripts with author metadata', () => {
      const rootPkgPath = path.join(projectRoot, 'package.json');
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

      expect(rootPkg.scripts.package).toBe('pnpm build && electron-builder --dir --x64');
      expect(rootPkg.scripts.dist).toBe('pnpm build && electron-builder --win --x64');
      expect(rootPkg.scripts['build:installer']).toBe('pnpm dist');
      expect(rootPkg.author).toEqual({ name: 'Ultimate WordPress & Website Auditor Team' });
    });

    it('verifies apps/desktop package.json defines package and dist scripts with author metadata', () => {
      const desktopPkgPath = path.join(desktopRoot, 'package.json');
      const desktopPkg = JSON.parse(fs.readFileSync(desktopPkgPath, 'utf8'));

      expect(desktopPkg.scripts.package).toBe('electron-builder --dir --x64');
      expect(desktopPkg.scripts.dist).toBe('electron-builder --win --x64');
      expect(desktopPkg.author).toEqual({ name: 'Ultimate WordPress & Website Auditor Team' });
    });
  });

  describe('3. Unpacked Windows Package Structure', () => {
    it('verifies win-unpacked directory contains main executable and resources', () => {
      expect(fs.existsSync(winUnpackedDir)).toBe(true);

      const mainExePath = path.join(winUnpackedDir, 'Ultimate WordPress & Website Auditor.exe');
      expect(fs.existsSync(mainExePath)).toBe(true);

      const stat = fs.statSync(mainExePath);
      expect(stat.size).toBeGreaterThan(100_000_000); // Electron binary > 100MB
    });

    it('verifies app.asar archive exists and has production bundle size', () => {
      expect(fs.existsSync(asarPath)).toBe(true);
      const stat = fs.statSync(asarPath);
      expect(stat.size).toBeGreaterThan(30_000_000); // Packaged app + node_modules > 30MB
    });

    it('verifies native SQLite binary is unpacked to app.asar.unpacked with correct ABI', () => {
      const unpackedNativeBinary = path.join(
        asarUnpackedDir,
        'out',
        'main',
        'native',
        'electron-v149-win32-x64',
        'better_sqlite3.node',
      );

      expect(fs.existsSync(unpackedNativeBinary)).toBe(true);
      const stat = fs.statSync(unpackedNativeBinary);
      expect(stat.size).toBe(1_891_840); // Prebuilt Electron ABI 149 binary
    });
  });

  describe('4. ASAR Archive Internal Integrity', () => {
    it('verifies app.asar contains entry points, renderer bundle, and required dependencies without development junk', () => {
      const asarLibPath = path.resolve(
        projectRoot,
        'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar',
      );
      const asar = require(asarLibPath);
      const rawList: string[] = asar.listPackage(asarPath);
      const fileList = rawList.map(f => f.replace(/\\/g, '/'));

      // 1. Entry points and bundles
      expect(fileList).toContain('/package.json');
      expect(fileList).toContain('/out/main/index.js');
      expect(fileList).toContain('/out/preload/index.cjs');
      expect(fileList).toContain('/out/renderer/index.html');

      // 2. Production dependencies present in node_modules
      expect(fileList.some(f => f.startsWith('/node_modules/better-sqlite3/'))).toBe(true);
      expect(fileList.some(f => f.startsWith('/node_modules/playwright-core/'))).toBe(true);
      expect(fileList.some(f => f.startsWith('/node_modules/axe-core/'))).toBe(true);
      expect(fileList.some(f => f.startsWith('/node_modules/htmlparser2/'))).toBe(true);

      // 3. Sub-dependencies required at runtime
      expect(fileList.some(f => f.startsWith('/node_modules/bindings/'))).toBe(true);
      expect(fileList.some(f => f.startsWith('/node_modules/domhandler/'))).toBe(true);
      expect(fileList.some(f => f.startsWith('/node_modules/domutils/'))).toBe(true);
      expect(fileList.some(f => f.startsWith('/node_modules/entities/'))).toBe(true);

      // 4. Zero development artifacts, tests, TypeScript sources, or sourcemaps
      expect(fileList.some(f => f.includes('/tests/'))).toBe(false);
      expect(fileList.some(f => f.includes('/.git/'))).toBe(false);
      expect(fileList.some(f => f.endsWith('.ts'))).toBe(false);
      expect(fileList.some(f => f.endsWith('.map'))).toBe(false);
    });
  });

  describe('5. NSIS Standalone Installer Executable', () => {
    it('verifies NSIS installer executable exists and is non-empty', () => {
      expect(fs.existsSync(installerExePath)).toBe(true);
      const stat = fs.statSync(installerExePath);
      expect(stat.size).toBeGreaterThan(120_000_000); // Compressed installer > 120MB
    });

    it('verifies blockmap and updater metadata exist alongside installer', () => {
      const blockmapPath = `${installerExePath}.blockmap`;
      const latestYmlPath = path.join(distDir, 'latest.yml');

      expect(fs.existsSync(blockmapPath)).toBe(true);
      expect(fs.existsSync(latestYmlPath)).toBe(true);

      const latestContent = fs.readFileSync(latestYmlPath, 'utf8');
      expect(latestContent).toContain(`version: ${appVersion}`);
      expect(latestContent).toContain('sha512:');
      expect(latestContent).toMatch(
        new RegExp(
          `path:\\s*['"]?.*(setup-${appVersion}\\.exe|Ultimate WordPress & Website Auditor Setup ${appVersion}\\.exe)`,
          'i',
        ),
      );
    });
  });
});
