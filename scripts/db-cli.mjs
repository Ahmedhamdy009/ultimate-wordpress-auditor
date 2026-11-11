#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';

const projectRoot = 'D:\\ahmed';
const cliBundle = path.join(projectRoot, 'apps', 'desktop', 'out', 'main', 'cli.js');

if (!fs.existsSync(cliBundle)) {
  console.error(`Error: CLI bundle not found at ${cliBundle}. Run 'pnpm build' first.`);
  process.exit(1);
}

const child = spawn(process.execPath, [cliBundle, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
