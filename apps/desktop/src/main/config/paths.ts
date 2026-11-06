/**
 * Main-process filesystem storage and boundary configuration.
 * Strictly confined to Desktop Main Process / Node.js environment.
 */

export const PROJECT_ROOT = 'D:\\ahmed';

export const DESKTOP_STORAGE_PATHS = {
  projectRoot: 'D:\\ahmed',
  tmpDir: 'D:\\ahmed\\.tmp',
  userDataDir: 'D:\\ahmed\\.tmp\\userData',
  sessionDataDir: 'D:\\ahmed\\.tmp\\sessionData',
} as const;
