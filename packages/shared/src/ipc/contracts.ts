import { IPC_CHANNELS, type IPCChannel } from './channels.js';
import {
  AppPingRequestSchema,
  AppPingResponseSchema,
  type AppPingRequest,
  type AppPingResponse,
  AppSystemInfoRequestSchema,
  AppSystemInfoResponseSchema,
  type AppSystemInfoRequest,
  type AppSystemInfoResponse,
  AuditValidateTargetRequestSchema,
  AuditValidateTargetResponseSchema,
  type AuditValidateTargetRequest,
  type AuditValidateTargetResponse,
} from './schemas.js';
import {
  IPCError,
  IPCValidationError,
  IPC_ERROR_CODES,
  sanitizeZodIssues,
  type IPCSerializedError,
} from './errors.js';

export type IPCResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: IPCSerializedError };

export const IPC_CONTRACTS = {
  [IPC_CHANNELS.APP_PING]: {
    requestSchema: AppPingRequestSchema,
    responseSchema: AppPingResponseSchema,
  },
  [IPC_CHANNELS.APP_GET_SYSTEM_INFO]: {
    requestSchema: AppSystemInfoRequestSchema,
    responseSchema: AppSystemInfoResponseSchema,
  },
  [IPC_CHANNELS.AUDIT_VALIDATE_TARGET]: {
    requestSchema: AuditValidateTargetRequestSchema,
    responseSchema: AuditValidateTargetResponseSchema,
  },
} as const;

export type IPCContracts = typeof IPC_CONTRACTS;

export type IPCChannelRequest<C extends IPCChannel> = C extends typeof IPC_CHANNELS.APP_PING
  ? AppPingRequest
  : C extends typeof IPC_CHANNELS.APP_GET_SYSTEM_INFO
    ? AppSystemInfoRequest
    : C extends typeof IPC_CHANNELS.AUDIT_VALIDATE_TARGET
      ? AuditValidateTargetRequest
      : never;

export type IPCChannelResponse<C extends IPCChannel> = C extends typeof IPC_CHANNELS.APP_PING
  ? AppPingResponse
  : C extends typeof IPC_CHANNELS.APP_GET_SYSTEM_INFO
    ? AppSystemInfoResponse
    : C extends typeof IPC_CHANNELS.AUDIT_VALIDATE_TARGET
      ? AuditValidateTargetResponse
      : never;

export function validateIPCRequest<C extends IPCChannel>(
  channel: C,
  payload: unknown,
): IPCChannelRequest<C> {
  const contract = IPC_CONTRACTS[channel];
  if (!contract) {
    throw new IPCError(
      `Unknown IPC channel: '${String(channel)}'`,
      IPC_ERROR_CODES.CHANNEL_NOT_FOUND,
    );
  }
  const result = contract.requestSchema.safeParse(payload);
  if (!result.success) {
    const sanitizedDetails = sanitizeZodIssues(result.error.issues);
    throw new IPCValidationError(
      `Request validation failed for channel '${channel}'`,
      sanitizedDetails,
    );
  }
  return result.data as IPCChannelRequest<C>;
}

export function validateIPCResponse<C extends IPCChannel>(
  channel: C,
  payload: unknown,
): IPCChannelResponse<C> {
  const contract = IPC_CONTRACTS[channel];
  if (!contract) {
    throw new IPCError(
      `Unknown IPC channel: '${String(channel)}'`,
      IPC_ERROR_CODES.CHANNEL_NOT_FOUND,
    );
  }
  const result = contract.responseSchema.safeParse(payload);
  if (!result.success) {
    const sanitizedDetails = sanitizeZodIssues(result.error.issues);
    throw new IPCValidationError(
      `Response validation failed for channel '${channel}'`,
      sanitizedDetails,
    );
  }
  return result.data as IPCChannelResponse<C>;
}
