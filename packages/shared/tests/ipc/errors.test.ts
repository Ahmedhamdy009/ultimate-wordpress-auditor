import { describe, it, expect } from 'vitest';
import {
  IPC_ERROR_CODES,
  IPCError,
  IPCSecurityError,
  IPCPayloadBoundsError,
  IPCValidationError,
  IPCRateLimitError,
  IPCConcurrencyError,
  sanitizeZodIssues,
  sanitizePath,
  toSafeIPCError,
  MAX_IPC_ERROR_DETAILS,
  SAFE_IPC_ERROR_MESSAGES,
} from '../../src/ipc/errors.js';

describe('IPC Errors Specification & Hardened Serialization', () => {
  it('defines comprehensive standardized error codes', () => {
    expect(IPC_ERROR_CODES.UNAUTHORIZED_SENDER).toBe('ERR_UNAUTHORIZED_SENDER');
    expect(IPC_ERROR_CODES.CHANNEL_NOT_FOUND).toBe('ERR_CHANNEL_NOT_FOUND');
    expect(IPC_ERROR_CODES.PAYLOAD_TOO_LARGE).toBe('ERR_PAYLOAD_TOO_LARGE');
    expect(IPC_ERROR_CODES.PAYLOAD_ARRAY_TOO_LARGE).toBe('ERR_PAYLOAD_ARRAY_TOO_LARGE');
    expect(IPC_ERROR_CODES.PAYLOAD_DEPTH_EXCEEDED).toBe('ERR_PAYLOAD_DEPTH_EXCEEDED');
    expect(IPC_ERROR_CODES.PAYLOAD_CIRCULAR_REFERENCE).toBe('ERR_PAYLOAD_CIRCULAR_REFERENCE');
    expect(IPC_ERROR_CODES.PAYLOAD_INVALID_PROTOTYPE).toBe('ERR_PAYLOAD_INVALID_PROTOTYPE');
    expect(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED).toBe('ERR_PAYLOAD_VALIDATION_FAILED');
    expect(IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE).toBe('ERR_PAYLOAD_UNSUPPORTED_TYPE');
    expect(IPC_ERROR_CODES.RATE_LIMIT_EXCEEDED).toBe('ERR_RATE_LIMIT_EXCEEDED');
    expect(IPC_ERROR_CODES.CONCURRENCY_LIMIT_EXCEEDED).toBe('ERR_CONCURRENCY_LIMIT_EXCEEDED');
    expect(IPC_ERROR_CODES.INTERNAL_ERROR).toBe('ERR_INTERNAL_ERROR');
    expect(IPC_ERROR_CODES.PATH_TRAVERSAL).toBe('ERR_PATH_TRAVERSAL');
    expect(IPC_ERROR_CODES.TMP_JUNCTION_ESCAPE).toBe('ERR_TMP_JUNCTION_ESCAPE');
  });

  it('instantiates specialized error subclasses with correct hierarchy and code defaults', () => {
    const secErr = new IPCSecurityError('Frame spoofing detected');
    expect(secErr).toBeInstanceOf(IPCError);
    expect(secErr).toBeInstanceOf(Error);
    expect(secErr.name).toBe('IPCSecurityError');
    expect(secErr.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);

    const boundsErr = new IPCPayloadBoundsError(
      'Array too large',
      IPC_ERROR_CODES.PAYLOAD_ARRAY_TOO_LARGE,
    );
    expect(boundsErr).toBeInstanceOf(IPCError);
    expect(boundsErr.name).toBe('IPCPayloadBoundsError');
    expect(boundsErr.code).toBe(IPC_ERROR_CODES.PAYLOAD_ARRAY_TOO_LARGE);

    const valErr = new IPCValidationError('Field validation failed', [
      { path: 'targetUrl', code: 'invalid_type', message: 'Invalid data type provided' },
    ]);
    expect(valErr).toBeInstanceOf(IPCError);
    expect(valErr.name).toBe('IPCValidationError');
    expect(valErr.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);

    const rateErr = new IPCRateLimitError();
    expect(rateErr).toBeInstanceOf(IPCError);
    expect(rateErr.name).toBe('IPCRateLimitError');
    expect(rateErr.code).toBe(IPC_ERROR_CODES.RATE_LIMIT_EXCEEDED);

    const concErr = new IPCConcurrencyError();
    expect(concErr).toBeInstanceOf(IPCError);
    expect(concErr.name).toBe('IPCConcurrencyError');
    expect(concErr.code).toBe(IPC_ERROR_CODES.CONCURRENCY_LIMIT_EXCEEDED);
  });

  describe('Adversarial Zod Issue Sanitization (sanitizeZodIssues)', () => {
    it('completely ignores raw custom Zod messages containing sensitive credentials and paths', () => {
      const adversarialIssues = [
        {
          path: ['user', 'password'],
          code: 'custom',
          message: 'Password123! does not meet complexity rules',
          input: 'Password123!',
          received: 'Password123!',
        },
        {
          path: ['headers', 'authorization'],
          code: 'invalid_string',
          message: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret_payload is expired',
          token: 'secret_token_12345',
        },
        {
          path: ['config', 'filePath'],
          code: 'invalid_type',
          message: 'Cannot open physical file at D:\\secrets\\master.key',
          stack: 'Error: at /internal/core/auth.ts:99',
        },
      ];

      const sanitized = sanitizeZodIssues(adversarialIssues);
      const jsonOutput = JSON.stringify(sanitized);

      // Verify that NO sensitive substrings exist anywhere in the serialized details
      expect(jsonOutput).not.toContain('Password123!');
      expect(jsonOutput).not.toContain('Bearer');
      expect(jsonOutput).not.toContain('secret_payload');
      expect(jsonOutput).not.toContain('secret_token_12345');
      expect(jsonOutput).not.toContain('D:\\\\secrets');
      expect(jsonOutput).not.toContain('master.key');
      expect(jsonOutput).not.toContain('internal/core/auth.ts');

      // Verify that canonical safe messages and codes are used instead
      expect(sanitized[0]).toEqual({
        path: 'user.password',
        code: 'validation_failed',
        message: 'Field validation check failed',
      });
      expect(sanitized[1]).toEqual({
        path: 'headers.authorization',
        code: 'invalid_format',
        message: 'String format does not match expected pattern',
      });
      expect(sanitized[2]).toEqual({
        path: 'config.filePath',
        code: 'invalid_type',
        message: 'Invalid data type provided',
      });
    });

    it('maps unknown Zod issue codes to safe generic fallback code and message', () => {
      const issueWithUnknownCode = [
        {
          path: ['fieldName'],
          code: 'some_exotic_unrecognized_zod_code',
          message: 'Internal details of exotic failure',
        },
      ];

      const sanitized = sanitizeZodIssues(issueWithUnknownCode);
      expect(sanitized[0]).toEqual({
        path: 'fieldName',
        code: 'invalid_value',
        message: 'Field validation failed',
      });
    });

    it('maps inherited Object.prototype property names to safe fallback detail using Object.hasOwn', () => {
      const inheritedNames = [
        'constructor',
        'toString',
        'valueOf',
        '__proto__',
        'hasOwnProperty',
        'isPrototypeOf',
      ];
      const issues = inheritedNames.map(name => ({
        path: ['field'],
        code: name,
        message: 'Injected inherited name',
      }));

      const sanitized = sanitizeZodIssues(issues);
      expect(sanitized.length).toBe(inheritedNames.length);

      for (const item of sanitized) {
        expect(item.code).toBe('invalid_value');
        expect(item.message).toBe('Field validation failed');
      }
    });

    it('sanitizes unsafe path segments and replaces traversal / illegal characters with _invalid', () => {
      const issuesWithUnsafePaths = [
        {
          path: ['users', '../admin', 'secret;--'],
          code: 'invalid_type',
        },
        {
          path: ['items', -5, 0],
          code: 'too_small',
        },
        {
          path: [Symbol('evilSymbol'), 'safeProperty'],
          code: 'invalid_type',
        },
      ];

      const sanitized = sanitizeZodIssues(issuesWithUnsafePaths);
      expect(sanitized[0].path).toBe('users._invalid._invalid');
      expect(sanitized[1].path).toBe('items._invalid.0');
      expect(sanitized[2].path).toBe('_invalid.safeProperty');
    });

    it('enforces maximum path depth and maximum details count to prevent DoS', () => {
      const deepIssue = [
        {
          path: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
          code: 'invalid_type',
        },
      ];
      const sanitizedDeep = sanitizeZodIssues(deepIssue);
      expect(sanitizedDeep[0].path.split('.').length).toBe(8);

      const manyIssues = Array.from({ length: 50 }, (_, i) => ({
        path: ['field', i],
        code: 'invalid_type',
      }));
      const sanitizedMany = sanitizeZodIssues(manyIssues);
      expect(sanitizedMany.length).toBe(MAX_IPC_ERROR_DETAILS);
    });

    it('returns immutable frozen arrays and objects', () => {
      const sanitized = sanitizeZodIssues([{ path: ['field'], code: 'invalid_type' }]);
      expect(Object.isFrozen(sanitized)).toBe(true);
      expect(Object.isFrozen(sanitized[0])).toBe(true);
    });
  });

  describe('Hardened sanitizePath', () => {
    it('safely handles revoked Proxy path arrays by falling back to _root without throwing', () => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      expect(sanitizePath(proxy)).toBe('_root');
    });

    it('safely rejects getter-backed path elements without executing them', () => {
      let getterCalled = false;
      const arr: unknown[] = [];
      Object.defineProperty(arr, '0', {
        get() {
          getterCalled = true;
          throw new Error('Getter trap invoked');
        },
      });
      arr.length = 1;
      expect(sanitizePath(arr)).toBe('_invalid');
      expect(getterCalled).toBe(false);
    });

    it('does not invoke custom array iterators on path arrays', () => {
      let iteratorCalled = false;
      const arr = ['user', 'profile'];
      Object.defineProperty(arr, Symbol.iterator, {
        value() {
          iteratorCalled = true;
          throw new Error('Iterator trap invoked');
        },
      });
      expect(sanitizePath(arr)).toBe('user.profile');
      expect(iteratorCalled).toBe(false);
    });

    it('safely handles sparse path arrays without prototype leakage', () => {
      const arr: unknown[] = [];
      arr[0] = 'users';
      arr[3] = 'id';
      expect(sanitizePath(arr)).toBe('users._invalid._invalid.id');
    });

    it('safely catches Proxy traps that throw during path inspection and falls back to _root', () => {
      const throwingProxy = new Proxy([], {
        getOwnPropertyDescriptor() {
          throw new Error('Descriptor trap threw');
        },
      });
      expect(sanitizePath(throwingProxy)).toBe('_root');

      const throwingProtoProxy = new Proxy([], {
        getPrototypeOf() {
          throw new Error('getPrototypeOf trap threw');
        },
      });
      expect(sanitizePath(throwingProtoProxy)).toBe('_root');
    });

    it('returns _root for oversized path strings without calling split', () => {
      const oversizedString = 'a.'.repeat(70); // 140 chars > 128
      expect(oversizedString.length).toBeGreaterThan(128);
      expect(sanitizePath(oversizedString)).toBe('_root');

      const exactBoundaryExceeded = 'a'.repeat(129);
      expect(sanitizePath(exactBoundaryExceeded)).toBe('_root');
    });

    it('preserves existing behavior for normal valid string paths', () => {
      expect(sanitizePath('user.name')).toBe('user.name');
      expect(sanitizePath('config.timeout')).toBe('config.timeout');
      expect(sanitizePath('items.0.id')).toBe('items.0.id');
      expect(sanitizePath('')).toBe('_root');
    });
  });

  describe('Accessor & Descriptor Hardening in Constructor and Boundary', () => {
    it('rejects details with a throwing getter on path without executing it or crashing', () => {
      let getterInvoked = false;
      const evil = {};
      Object.defineProperty(evil, 'path', {
        get() {
          getterInvoked = true;
          throw new Error('Exploited path getter');
        },
      });
      Object.defineProperty(evil, 'code', { value: 'invalid_type' });

      const err = new IPCValidationError('Test', [evil]);
      expect(getterInvoked).toBe(false);
      expect(err.details).toBeUndefined();
      const serialized = err.toJSON();
      expect(serialized.details).toBeUndefined();
    });

    it('rejects details with a throwing getter on code without executing it or crashing', () => {
      let getterInvoked = false;
      const evil = { path: 'username' };
      Object.defineProperty(evil, 'code', {
        get() {
          getterInvoked = true;
          throw new Error('Exploited code getter');
        },
      });

      const err = new IPCValidationError('Test', [evil]);
      expect(getterInvoked).toBe(false);
      expect(err.details).toBeUndefined();
      const serialized = err.toJSON();
      expect(serialized.details).toBeUndefined();
    });

    it('does not invoke getters with side effects during sanitization or construction', () => {
      let sideEffectTriggered = false;
      const evil = {};
      Object.defineProperty(evil, 'path', {
        get() {
          sideEffectTriggered = true;
          return 'user.email';
        },
      });
      Object.defineProperty(evil, 'code', { value: 'invalid_type' });

      const err = new IPCValidationError('Test', [evil]);
      expect(sideEffectTriggered).toBe(false);
      expect(err.details).toBeUndefined();
    });

    it('rejects setter-only properties safely', () => {
      const evil = { code: 'invalid_type' };
      Object.defineProperty(evil, 'path', {
        set(_v) {},
        configurable: true,
      });

      const err = new IPCValidationError('Test', [evil]);
      expect(err.details).toBeUndefined();
    });

    it('rejects detail objects containing unexpected symbols', () => {
      const evil = {
        path: 'targetUrl',
        code: 'invalid_type',
        [Symbol('secretKey')]: 'leak_data',
      };

      const err = new IPCValidationError('Test', [evil]);
      expect(err.details).toBeUndefined();
    });

    it('rejects detail objects containing unexpected own properties', () => {
      const evil = {
        path: 'targetUrl',
        code: 'invalid_type',
        maliciousExtraField: 'leak_payload',
      };

      const err = new IPCValidationError('Test', [evil]);
      expect(err.details).toBeUndefined();
    });

    it('rejects Array subclasses and does not invoke Symbol.iterator during defensive copy', () => {
      class EvilArray extends Array {}
      const evilArr = new EvilArray();
      evilArr.push({ path: 'field', code: 'invalid_type' });

      const errFromSubclass = new IPCValidationError('Test', evilArr);
      expect(errFromSubclass.details).toBeUndefined();

      let iteratorCalled = false;
      const arrWithTrap = [{ path: 'field', code: 'invalid_type' }];
      Object.defineProperty(arrWithTrap, Symbol.iterator, {
        value() {
          iteratorCalled = true;
          throw new Error('Iterator trap invoked!');
        },
      });

      const errFromTrap = new IPCValidationError('Test', arrWithTrap);
      expect(iteratorCalled).toBe(false);
      expect(errFromTrap.details).toBeDefined();
      expect(errFromTrap.details?.length).toBe(1);
    });

    it('safely handles sparse arrays without infinite loops or prototype leakage', () => {
      const sparseArray: unknown[] = [];
      sparseArray[0] = { path: 'a', code: 'invalid_type' };
      sparseArray[100] = { path: 'b', code: 'invalid_type' };

      const err = new IPCValidationError('Test', sparseArray);
      expect(err.details).toBeDefined();
      expect(err.details?.length).toBe(1);
      expect(err.details?.[0].path).toBe('a');
    });

    it('catches throwing Proxy traps during descriptor inspection without crashing', () => {
      const evilProxy = new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error('Malicious Proxy trap');
          },
          getPrototypeOf() {
            throw new Error('Malicious Proxy getPrototypeOf trap');
          },
        },
      );

      const err = new IPCValidationError('Test', [evilProxy]);
      expect(err.details).toBeUndefined();
      const serialized = err.toJSON();
      expect(serialized.details).toBeUndefined();
      expect(serialized.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
    });

    it('safely handles a revoked Proxy passed as details array in constructor and serialization', () => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      const err = new IPCValidationError('Test', proxy as unknown as readonly unknown[]);
      expect(err.details).toBeUndefined();
      expect(err.toJSON().details).toBeUndefined();
    });

    it('catches throwing Proxy traps on details array length descriptor safely', () => {
      const throwingLenProxy = new Proxy([], {
        getOwnPropertyDescriptor(_target, prop) {
          if (prop === 'length') {
            throw new Error('Length descriptor trap threw');
          }
          return undefined;
        },
      });
      const err = new IPCValidationError('Test', throwingLenProxy as unknown as readonly unknown[]);
      expect(err.details).toBeUndefined();
    });

    it('does not retain references to original detail objects', () => {
      const original = { path: 'targetUrl', code: 'invalid_type' };
      const err = new IPCValidationError('Test', [original]);
      expect(err.details?.[0]).not.toBe(original);
      expect(Object.isFrozen(err.details?.[0])).toBe(true);
    });
  });

  describe('Hardened IPCError.toJSON() & toSafeIPCError', () => {
    it('forces fixed safe messages and discards custom messages in IPCError.toJSON()', () => {
      const customSecretMessage = 'Custom secret: JWT token is 99887766 and user is admin';
      const error = new IPCSecurityError(customSecretMessage);

      const serialized = error.toJSON();
      expect(serialized.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
      expect(serialized.message).toBe(SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.UNAUTHORIZED_SENDER]);
      expect(JSON.stringify(serialized)).not.toContain('99887766');
      expect(JSON.stringify(serialized)).not.toContain('JWT');
      expect('stack' in serialized).toBe(false);
    });

    it('maps unknown or injected error codes to ERR_INTERNAL_ERROR and ensures public property is validated', () => {
      const maliciousError = new IPCError('Arbitrary message', 'INJECTED_ATTACK_CODE');

      // Public property check: proves malicious runtime code cannot remain in IPCError.code
      expect(maliciousError.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
      expect(maliciousError.code).not.toBe('INJECTED_ATTACK_CODE');

      const serialized = maliciousError.toJSON();
      expect(serialized.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
      expect(serialized.message).toBe(SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR]);
      expect(JSON.stringify(serialized)).not.toContain('INJECTED_ATTACK_CODE');
    });

    it('rejects inherited Object.prototype property names as IPC error codes', () => {
      const inheritedCodes = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];
      for (const code of inheritedCodes) {
        const error = new IPCError('msg', code);
        expect(error.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
        const serialized = error.toJSON();
        expect(serialized.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
        expect(serialized.message).toBe(SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR]);
      }
    });

    it('produces plain, immutable DTOs with only approved fields and no prototype or custom property leakage', () => {
      const error = new IPCValidationError('Internal msg', [
        { path: 'user.name', code: 'invalid_type', message: 'Ignored message' },
      ]);

      (error as unknown as Record<string, unknown>).leakedSecretKey = 'super_secret_123';
      (error as unknown as Record<string, unknown>).internalDatabaseUrl =
        'postgres://admin:pwd@db/prod';

      const serialized = error.toJSON();

      expect(Object.keys(serialized).sort()).toEqual(['code', 'details', 'message']);
      expect(serialized).not.toHaveProperty('leakedSecretKey');
      expect(serialized).not.toHaveProperty('internalDatabaseUrl');
      expect(serialized).not.toHaveProperty('stack');
      expect(serialized).not.toHaveProperty('name');

      expect(Object.isFrozen(serialized)).toBe(true);
      expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype);

      if (serialized.details) {
        expect(Object.isFrozen(serialized.details)).toBe(true);
        expect(Object.isFrozen(serialized.details[0])).toBe(true);
        expect(Object.keys(serialized.details[0]).sort()).toEqual(['code', 'message', 'path']);
      }
    });

    it('safely converts native Errors with sensitive paths and stack traces in toSafeIPCError', () => {
      const sensitiveNativeError = new Error(
        "ENOENT: no such file, open 'D:\\secret\\database-credentials.json'",
      );
      const safe = toSafeIPCError(sensitiveNativeError);

      expect(safe).toEqual({
        code: 'ERR_INTERNAL_ERROR',
        message: 'An internal error occurred while processing the IPC request',
      });
      expect('stack' in safe).toBe(false);
      expect(JSON.stringify(safe)).not.toContain('secret');
      expect(JSON.stringify(safe)).not.toContain('database-credentials');
      expect(JSON.stringify(safe)).not.toContain('ENOENT');
    });

    it('converts non-error exceptions (strings, null, objects) to generic safe ERR_INTERNAL_ERROR', () => {
      expect(toSafeIPCError('raw string exception')).toEqual({
        code: 'ERR_INTERNAL_ERROR',
        message: 'An internal error occurred while processing the IPC request',
      });

      expect(toSafeIPCError(null)).toEqual({
        code: 'ERR_INTERNAL_ERROR',
        message: 'An internal error occurred while processing the IPC request',
      });

      expect(toSafeIPCError({ rawDump: 'credentials' })).toEqual({
        code: 'ERR_INTERNAL_ERROR',
        message: 'An internal error occurred while processing the IPC request',
      });
    });

    it('safely handles a revoked Proxy passed to toSafeIPCError without throwing', () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      const safe = toSafeIPCError(proxy);
      expect(safe).toEqual({
        code: 'ERR_INTERNAL_ERROR',
        message: 'An internal error occurred while processing the IPC request',
      });
    });

    it('does not invoke getPrototypeOf traps on proxies passed to toSafeIPCError', () => {
      let trapTriggered = false;
      const trapProxy = new Proxy(
        {},
        {
          getPrototypeOf() {
            trapTriggered = true;
            throw new Error('Malicious getPrototypeOf trap');
          },
        },
      );
      const safe = toSafeIPCError(trapProxy);
      expect(trapTriggered).toBe(false);
      expect(safe).toEqual({
        code: 'ERR_INTERNAL_ERROR',
        message: 'An internal error occurred while processing the IPC request',
      });
    });

    it('ignores and bypasses overridden toJSON method in IPCError subclasses', () => {
      let customToJSONCalled = false;
      class MaliciousSubclass extends IPCError {
        override toJSON(): never {
          customToJSONCalled = true;
          throw new Error('Subclass toJSON trap invoked');
        }
      }
      const subErr = new MaliciousSubclass('Secret', IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
      const safe = toSafeIPCError(subErr);
      expect(customToJSONCalled).toBe(false);
      expect(safe.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
      expect(safe.message).toBe(SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.UNAUTHORIZED_SENDER]);
    });

    it('ignores and bypasses modified toJSON property on IPCError instances', () => {
      let modifiedToJSONCalled = false;
      const instanceErr = new IPCSecurityError('Internal message');
      (instanceErr as unknown as { toJSON: () => void }).toJSON = () => {
        modifiedToJSONCalled = true;
        throw new Error('Modified toJSON trap invoked');
      };
      const safe = toSafeIPCError(instanceErr);
      expect(modifiedToJSONCalled).toBe(false);
      expect(safe.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
      expect(safe.message).toBe(SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.UNAUTHORIZED_SENDER]);
    });

    it('does not invoke throwing property accessors on untrusted error objects', () => {
      let getterCalled = false;
      const evilObj = {
        get code() {
          getterCalled = true;
          throw new Error('Code getter bomb');
        },
        get message() {
          getterCalled = true;
          throw new Error('Message getter bomb');
        },
        get details() {
          getterCalled = true;
          throw new Error('Details getter bomb');
        },
        get toJSON() {
          getterCalled = true;
          throw new Error('toJSON getter bomb');
        },
      };
      const safe = toSafeIPCError(evilObj);
      expect(getterCalled).toBe(false);
      expect(safe).toEqual({
        code: 'ERR_INTERNAL_ERROR',
        message: 'An internal error occurred while processing the IPC request',
      });
    });
  });
});
