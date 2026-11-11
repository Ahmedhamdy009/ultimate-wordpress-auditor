import { DatabaseConnection } from '../apps/desktop/out/main/chunks/runner-DTssZBP3.js';
import { ScanOrchestrator } from '../apps/desktop/out/main/index.js';
import { validateIPCResponse, validateIPCRequest, IPC_CHANNELS } from '@auditor/shared';
import path from 'node:path';

const dbPath = path.join(
  process.env.APPDATA || 'C:\\Users\\Ahmed Hamdy\\AppData\\Roaming',
  'ultimate-wordpress-and-website-auditor',
  'database',
  'auditor.db',
);

console.log('Connecting to database:', dbPath);
const connection = new DatabaseConnection(dbPath, { readonly: true });
const orchestrator = new ScanOrchestrator(connection);

const scanId = '6928623e-2769-4c6f-a974-53479f8af341';
console.log('Getting scan progress for scan:', scanId);
const progress = orchestrator.getScanProgress({ id: scanId });
console.log('Progress returned:', JSON.stringify(progress, null, 2));

try {
  const validated = validateIPCResponse(IPC_CHANNELS.SCAN_PROGRESS, progress);
  console.log('validateIPCResponse SUCCESS!');
} catch (err) {
  console.error('validateIPCResponse FAILED:', err);
}

connection.close();
