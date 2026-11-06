import { describe, it, expect } from 'vitest';
import {
  IPC_CHANNELS,
  IPC_CONTRACTS,
  validateIPCRequest,
  validateIPCResponse,
} from '../../src/ipc/index.js';
import { IPCError, IPCValidationError, IPC_ERROR_CODES } from '../../src/ipc/errors.js';

describe('IPC Contracts & Dispatcher Validation', () => {
  it('has contracts registered for all defined channels', () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(channel in IPC_CONTRACTS).toBe(true);
      expect(IPC_CONTRACTS[channel].requestSchema).toBeDefined();
      expect(IPC_CONTRACTS[channel].responseSchema).toBeDefined();
    }
  });

  describe('validateIPCRequest', () => {
    it('validates and parses valid request payloads', () => {
      const pingReq = validateIPCRequest(IPC_CHANNELS.APP_PING, { timestamp: 12345 });
      expect(pingReq).toEqual({ timestamp: 12345 });

      const sysReq = validateIPCRequest(IPC_CHANNELS.APP_GET_SYSTEM_INFO, {});
      expect(sysReq).toEqual({});

      const auditReq = validateIPCRequest(IPC_CHANNELS.AUDIT_VALIDATE_TARGET, {
        targetUrl: 'https://example.com',
      });
      expect(auditReq.targetUrl).toBe('https://example.com');
    });

    it('throws IPCError with ERR_CHANNEL_NOT_FOUND for unregistered channels', () => {
      expect(() => {
        // @ts-expect-error Testing invalid channel string at runtime
        validateIPCRequest('nonexistent:channel', {});
      }).toThrowError(IPCError);

      try {
        // @ts-expect-error Testing invalid channel string at runtime
        validateIPCRequest('nonexistent:channel', {});
      } catch (err) {
        expect((err as IPCError).code).toBe(IPC_ERROR_CODES.CHANNEL_NOT_FOUND);
      }
    });

    it('throws IPCValidationError for malformed request payloads', () => {
      expect(() => {
        validateIPCRequest(IPC_CHANNELS.APP_PING, { timestamp: 'not-a-number' });
      }).toThrowError(IPCValidationError);

      try {
        validateIPCRequest(IPC_CHANNELS.APP_PING, { timestamp: 'not-a-number' });
      } catch (err) {
        expect(err).toBeInstanceOf(IPCValidationError);
        const valErr = err as IPCValidationError;
        expect(valErr.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
        expect(Array.isArray(valErr.details)).toBe(true);
        expect(valErr.details?.[0]).toEqual({
          path: 'timestamp',
          code: 'invalid_type',
          message: 'Invalid data type provided',
        });
        const serialized = valErr.toJSON();
        expect(serialized.code).toBe('ERR_PAYLOAD_VALIDATION_FAILED');
        expect(serialized.message).toBe('Payload validation failed');
        expect('stack' in serialized).toBe(false);
        expect(serialized.details?.[0]).not.toHaveProperty('input');
        expect(serialized.details?.[0]).not.toHaveProperty('received');
      }
    });
  });

  describe('validateIPCResponse', () => {
    it('validates and parses valid response payloads', () => {
      const pingRes = validateIPCResponse(IPC_CHANNELS.APP_PING, {
        pong: true,
        serverTimestamp: 99999,
      });
      expect(pingRes).toEqual({ pong: true, serverTimestamp: 99999 });
    });

    it('throws IPCValidationError when response violates contract schema', () => {
      expect(() => {
        validateIPCResponse(IPC_CHANNELS.APP_PING, {
          pong: false,
        });
      }).toThrowError(IPCValidationError);
    });
  });
});
