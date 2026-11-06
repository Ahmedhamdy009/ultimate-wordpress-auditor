import { contextBridge } from 'electron';
import { ALLOWED_IPC_CHANNELS } from '../common/ipc/channels.js';

// Phase 1.2.1 Preload script stub.
// Full contextBridge domain API exposure will be implemented in Phase 1.2.3.

contextBridge.exposeInMainWorld('auditorBootstrap', {
  initialized: true,
  channels: Object.values(ALLOWED_IPC_CHANNELS),
});
