import fs from 'node:fs';
import path from 'node:path';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function removeRecursive(targetPath) {
  let bytesFreed = 0;
  let filesRemoved = 0;
  if (!fs.existsSync(targetPath)) return { bytesFreed, filesRemoved };
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    bytesFreed += stat.size;
    fs.unlinkSync(targetPath);
    filesRemoved++;
    return { bytesFreed, filesRemoved };
  }
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(targetPath, e.name);
    try {
      const res = removeRecursive(full);
      bytesFreed += res.bytesFreed;
      filesRemoved += res.filesRemoved;
    } catch (err) {
      console.error('Error removing:', full, err.message);
    }
  }
  try {
    fs.rmdirSync(targetPath);
  } catch {}
  return { bytesFreed, filesRemoved };
}

console.log('=== STARTING SAFE CLEANUP ===');

const oldInstallers = [
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.0.exe',
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.0.exe.blockmap',
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.1.exe',
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.1.exe.blockmap',
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.2.exe',
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.2.exe.blockmap',
  'D:\\ahmed\\apps\\desktop\\dist\\ultimate-wordpress-and-website-auditor Setup 0.1.0.exe',
  'D:\\ahmed\\apps\\desktop\\dist\\ultimate-wordpress-and-website-auditor Setup 0.1.0.exe.blockmap',
  'D:\\ahmed\\apps\\desktop\\dist\\ultimate-wordpress-and-website-auditor Setup 0.1.1.exe',
  'D:\\ahmed\\apps\\desktop\\dist\\ultimate-wordpress-and-website-auditor Setup 0.1.1.exe.blockmap',
];

let totalFreed = 0;
let totalFiles = 0;

for (const inst of oldInstallers) {
  if (fs.existsSync(inst)) {
    const s = fs.statSync(inst).size;
    fs.unlinkSync(inst);
    totalFreed += s;
    totalFiles++;
    console.log(`Removed old installer artifact: ${path.basename(inst)} (${formatBytes(s)})`);
  }
}

// Remove win-unpacked staging
const winUnpacked = 'D:\\ahmed\\apps\\desktop\\dist\\win-unpacked';
if (fs.existsSync(winUnpacked)) {
  console.log('Removing win-unpacked staging directory...');
  const res = removeRecursive(winUnpacked);
  totalFreed += res.bytesFreed;
  totalFiles += res.filesRemoved;
  console.log(
    `Removed win-unpacked: ${formatBytes(res.bytesFreed)} across ${res.filesRemoved} files`,
  );
}

// Remove ephemeral .tmp directory
const tmpDir = 'D:\\ahmed\\.tmp';
if (fs.existsSync(tmpDir)) {
  console.log('Removing .tmp test directory...');
  const res = removeRecursive(tmpDir);
  totalFreed += res.bytesFreed;
  totalFiles += res.filesRemoved;
  console.log(`Removed .tmp: ${formatBytes(res.bytesFreed)} across ${res.filesRemoved} files`);
}

// Remove root dist (4 declaration files)
const rootDist = 'D:\\ahmed\\dist';
if (fs.existsSync(rootDist)) {
  console.log('Removing root dist build folder...');
  const res = removeRecursive(rootDist);
  totalFreed += res.bytesFreed;
  totalFiles += res.filesRemoved;
  console.log(`Removed root dist: ${formatBytes(res.bytesFreed)} across ${res.filesRemoved} files`);
}

console.log('\n=== CLEANUP COMPLETE ===');
console.log(`Total Space Freed: ${formatBytes(totalFreed)} (${totalFreed} bytes)`);
console.log(`Total Files Removed: ${totalFiles}`);

// Verify preserved targets
console.log('\n=== VERIFYING PRESERVED TARGETS ===');
const preserved = [
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.3.exe',
  'D:\\ahmed\\apps\\desktop\\dist\\Ultimate WordPress & Website Auditor Setup 0.1.3.exe.blockmap',
  'D:\\ttt\\@auditordesktop\\Ultimate WordPress & Website Auditor.exe',
  path.join(
    process.env.APPDATA,
    'ultimate-wordpress-and-website-auditor',
    'database',
    'auditor.db',
  ),
  path.join(process.env.APPDATA, 'ultimate-wordpress-and-website-auditor', 'reports'),
  path.join(
    process.env.APPDATA,
    'ultimate-wordpress-and-website-auditor',
    'reports',
    'screenshots',
  ),
];

for (const p of preserved) {
  const exists = fs.existsSync(p);
  console.log(`[${exists ? 'OK' : 'MISSING'}] Preserved: ${p}`);
}
