import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  SAFE_IPC_ERROR_MESSAGES,
  FALLBACK_INTERNAL_ERROR_DTO,
  MAX_IPC_ERROR_DETAILS,
  MAX_IPC_ERROR_PATH_LENGTH,
  SAFE_ZOD_CODE_MAP,
  FALLBACK_ZOD_DETAIL,
  isAllowedIPCCode,
  type IPCResult,
  type IPCSerializedError,
  type IPCErrorDetail,
  type AppPingResponse,
  type AppSystemInfoResponse,
  type AuditValidateTargetRequest,
  type AuditValidateTargetResponse,
} from '@auditor/shared';
import type { ElectronAPI } from '../common/ipc/contracts.js';

export type { ElectronAPI };

/**
 * Canonical fallback error returned when transport-level IPC failure or envelope corruption occurs.
 * Strictly guarantees that no stack traces, paths, or raw exceptions cross into the renderer.
 */
export const FALLBACK_TRANSPORT_ERROR: Readonly<IPCSerializedError> = FALLBACK_INTERNAL_ERROR_DTO;

/**
 * Regex validating canonical dotted error detail paths (1..8 segments, alphanumeric/underscore/hyphen).
 */
const SAFE_DOTTED_PATH_REGEX = /^[a-zA-Z0-9_-]{1,64}(?:\.[a-zA-Z0-9_-]{1,64}){0,7}$/;

/**
 * Lookup map of approved detail codes to their fixed safe messages from @auditor/shared.
 */
const ALLOWED_DETAIL_MESSAGES: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const entry of Object.values(SAFE_ZOD_CODE_MAP)) {
    map.set(entry.code, entry.message);
  }
  map.set(FALLBACK_ZOD_DETAIL.code, FALLBACK_ZOD_DETAIL.message);
  return map;
})();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  return Object.getOwnPropertySymbols(value).length === 0;
}

function getOwnDataProperty(
  target: object,
  key: string,
): { readonly valid: true; readonly value: unknown } | { readonly valid: false } {
  if (!Object.hasOwn(target, key)) {
    return { valid: false };
  }
  const desc = Object.getOwnPropertyDescriptor(target, key);
  if (!desc || desc.get !== undefined || desc.set !== undefined || !('value' in desc)) {
    return { valid: false };
  }
  return { valid: true, value: desc.value };
}

function isValidErrorDetail(item: unknown): item is IPCErrorDetail {
  if (!isPlainRecord(item)) {
    return false;
  }
  const ownKeys = Object.getOwnPropertyNames(item);
  if (ownKeys.length !== 3) {
    return false;
  }

  const pathProp = getOwnDataProperty(item, 'path');
  const codeProp = getOwnDataProperty(item, 'code');
  const messageProp = getOwnDataProperty(item, 'message');

  if (!pathProp.valid || !codeProp.valid || !messageProp.valid) {
    return false;
  }

  if (
    typeof pathProp.value !== 'string' ||
    pathProp.value.length === 0 ||
    pathProp.value.length > MAX_IPC_ERROR_PATH_LENGTH ||
    !SAFE_DOTTED_PATH_REGEX.test(pathProp.value)
  ) {
    return false;
  }

  if (typeof codeProp.value !== 'string' || typeof messageProp.value !== 'string') {
    return false;
  }

  const expectedMessage = ALLOWED_DETAIL_MESSAGES.get(codeProp.value);
  return expectedMessage !== undefined && messageProp.value === expectedMessage;
}

function isValidErrorDetailsArray(details: unknown): details is readonly IPCErrorDetail[] {
  if (!Array.isArray(details) || Object.getPrototypeOf(details) !== Array.prototype) {
    return false;
  }
  if (Object.getOwnPropertySymbols(details).length > 0) {
    return false;
  }

  const lenProp = getOwnDataProperty(details, 'length');
  if (
    !lenProp.valid ||
    typeof lenProp.value !== 'number' ||
    !Number.isInteger(lenProp.value) ||
    lenProp.value < 0 ||
    lenProp.value > MAX_IPC_ERROR_DETAILS
  ) {
    return false;
  }

  const ownKeys = Object.getOwnPropertyNames(details);
  if (ownKeys.length !== lenProp.value + 1) {
    return false;
  }

  for (let i = 0; i < lenProp.value; i++) {
    const elemProp = getOwnDataProperty(details, String(i));
    if (!elemProp.valid || !isValidErrorDetail(elemProp.value)) {
      return false;
    }
  }

  return true;
}

function isValidIPCSerializedError(error: unknown): error is IPCSerializedError {
  if (!isPlainRecord(error)) {
    return false;
  }

  const ownKeys = Object.getOwnPropertyNames(error);
  if (ownKeys.length < 2 || ownKeys.length > 3) {
    return false;
  }
  for (const key of ownKeys) {
    if (key !== 'code' && key !== 'message' && key !== 'details') {
      return false;
    }
  }

  const codeProp = getOwnDataProperty(error, 'code');
  const messageProp = getOwnDataProperty(error, 'message');
  if (!codeProp.valid || !messageProp.valid) {
    return false;
  }

  if (!isAllowedIPCCode(codeProp.value)) {
    return false;
  }

  if (
    typeof messageProp.value !== 'string' ||
    messageProp.value !== SAFE_IPC_ERROR_MESSAGES[codeProp.value]
  ) {
    return false;
  }

  if (Object.hasOwn(error, 'details')) {
    const detailsProp = getOwnDataProperty(error, 'details');
    if (!detailsProp.valid) {
      return false;
    }
    if (detailsProp.value !== undefined && !isValidErrorDetailsArray(detailsProp.value)) {
      return false;
    }
  }

  return true;
}

/**
 * Strictly validates that an untrusted IPC response conforms to the complete IPCResult<T> contract:
 * - Success: `{ success: true, data: <non-null plain DTO object> }`
 * - Failure: `{ success: false, error: <validated IPCSerializedError> }`
 * Never invokes getters or accessors; fails closed on any malformed structure.
 */
export function isValidIPCResultEnvelope<T>(response: unknown): response is IPCResult<T> {
  try {
    if (!isPlainRecord(response)) {
      return false;
    }

    const ownKeys = Object.getOwnPropertyNames(response);
    if (ownKeys.length !== 2) {
      return false;
    }

    const successProp = getOwnDataProperty(response, 'success');
    if (!successProp.valid || typeof successProp.value !== 'boolean') {
      return false;
    }

    if (successProp.value === true) {
      const dataProp = getOwnDataProperty(response, 'data');
      if (!dataProp.valid || !isPlainRecord(dataProp.value)) {
        return false;
      }
      return true;
    }

    const errorProp = getOwnDataProperty(response, 'error');
    if (!errorProp.valid || !isValidIPCSerializedError(errorProp.value)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Safely invokes an IPC channel via ipcRenderer.invoke with complete envelope validation
 * and fail-closed exception containment.
 * Guaranteed to return a valid IPCResult<T> envelope without throwing.
 */
export async function safeInvoke<T>(
  invoker: (channel: string, payload: unknown) => Promise<unknown>,
  channel: string,
  payload: unknown,
): Promise<IPCResult<T>> {
  try {
    const response = await invoker(channel, payload);
    if (!isValidIPCResultEnvelope<T>(response)) {
      return {
        success: false,
        error: FALLBACK_TRANSPORT_ERROR,
      };
    }
    return response;
  } catch {
    // Fail-closed: transport-level rejections return a safe, sanitized IPCResult failure
    return {
      success: false,
      error: FALLBACK_TRANSPORT_ERROR,
    };
  }
}

/**
 * Factory creating the frozen, strongly typed ElectronAPI object.
 * Allows dependency injection of invoker for isolated unit testing.
 */
export function createElectronAPI(
  invoker: (channel: string, payload: unknown) => Promise<unknown> = (channel, payload) =>
    ipcRenderer.invoke(channel, payload),
): ElectronAPI {
  return Object.freeze({
    ping: () => safeInvoke<AppPingResponse>(invoker, IPC_CHANNELS.APP_PING, {}),
    getSystemInfo: () =>
      safeInvoke<AppSystemInfoResponse>(invoker, IPC_CHANNELS.APP_GET_SYSTEM_INFO, {}),
    validateTarget: (request: AuditValidateTargetRequest) =>
      safeInvoke<AuditValidateTargetResponse>(invoker, IPC_CHANNELS.AUDIT_VALIDATE_TARGET, request),
  });
}

/**
 * Production ElectronAPI instance.
 */
export const electronAPI: ElectronAPI = createElectronAPI();

/**
 * Non-configurable symbol key used to track initialized contextBridge instances
 * and prevent duplicate main-world exposure across module evaluations.
 */
const EXPOSED_BRIDGES_KEY = Symbol.for('auditor.desktop.preload.exposedBridges');

function getExposedBridgeRegistry(): WeakSet<object> {
  const globalRecord = globalThis as Record<symbol, unknown>;
  const existing = globalRecord[EXPOSED_BRIDGES_KEY];
  if (existing instanceof WeakSet) {
    return existing;
  }
  const registry = new WeakSet<object>();
  Object.defineProperty(globalThis, EXPOSED_BRIDGES_KEY, {
    value: registry,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  return registry;
}

/**
 * Authoritatively exposes window.electronAPI in the main world exactly once.
 * Fails closed (throws) if contextBridge is missing, invalid, or already initialized.
 */
function initializePreloadBridge(): void {
  if (
    typeof contextBridge !== 'object' ||
    contextBridge === null ||
    typeof contextBridge.exposeInMainWorld !== 'function'
  ) {
    throw new Error(
      'Preload initialization failed: Electron contextBridge.exposeInMainWorld is unavailable.',
    );
  }

  const registry = getExposedBridgeRegistry();
  if (registry.has(contextBridge)) {
    throw new Error(
      'Preload initialization failed: electronAPI has already been exposed on this contextBridge.',
    );
  }

  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  registry.add(contextBridge);
}

initializePreloadBridge();
