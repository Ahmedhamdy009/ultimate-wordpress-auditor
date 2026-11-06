/// <reference types="vite/client" />

import type { ElectronAPI } from '../../common/ipc/contracts.js';

export type { ElectronAPI };

declare global {
  interface Window {
    readonly electronAPI: ElectronAPI;
  }
}
