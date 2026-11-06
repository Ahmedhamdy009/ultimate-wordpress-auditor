import { app } from 'electron';
import { ALLOWED_IPC_CHANNELS } from '../common/ipc/channels.js';

// Phase 1.2.1 Main Process entry stub.
// Full WindowSecurityRegistry, CSP Manager, and NavigationGuard will be implemented in Phase 1.2.2.

app.whenReady().then(() => {
  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[Main] Desktop shell ready. Channels registered: ${Object.keys(ALLOWED_IPC_CHANNELS).length}`,
    );
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
