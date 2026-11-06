/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { PayloadInspector, MAX_GENERAL_STRING_LENGTH } from '../../src/main/ipc/inspector.js';
import { IPC_CHANNELS, IPCPayloadBoundsError } from '@auditor/shared';

describe('Bounded Iterative PayloadInspector', () => {
  describe('Depth Bounds Enforcement (maxDepth = 10)', () => {
    it('accepts payloads within depth <= 10', () => {
      // Build object of exact depth 10: root is depth 0, 10 levels of nesting
      let curr: any = { leaf: 'data' };
      for (let i = 0; i < 9; i++) {
        curr = { next: curr };
      }
      expect(() => PayloadInspector.inspect(curr)).not.toThrow();
    });

    it('rejects payloads exceeding depth > 10 with ERR_PAYLOAD_DEPTH_EXCEEDED', () => {
      let curr: any = { leaf: 'too_deep' };
      for (let i = 0; i < 11; i++) {
        curr = { next: curr };
      }
      expect(() => PayloadInspector.inspect(curr)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(curr);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_DEPTH_EXCEEDED');
      }
    });
  });

  describe('Array Bounds & Sparse Array Enforcement', () => {
    it('accepts arrays within maxArrayLength <= 5000', () => {
      const arr = new Array(100).fill(1);
      expect(() => PayloadInspector.inspect(arr)).not.toThrow();
    });

    it('rejects arrays exceeding maxArrayLength > 5000 with ERR_PAYLOAD_ARRAY_TOO_LARGE', () => {
      const hugeArr: unknown[] = [];
      hugeArr.length = 5001;
      expect(() => PayloadInspector.inspect(hugeArr)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(hugeArr);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_ARRAY_TOO_LARGE');
      }
    });

    it('rejects sparse arrays with missing index keys with ERR_PAYLOAD_UNSUPPORTED_TYPE', () => {
      const sparseArr: unknown[] = [];
      sparseArr[0] = 'a';
      sparseArr[5] = 'b'; // Missing 1, 2, 3, 4
      expect(() => PayloadInspector.inspect(sparseArr)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(sparseArr);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_UNSUPPORTED_TYPE');
      }
    });

    it('rejects Array subclasses with ERR_PAYLOAD_INVALID_PROTOTYPE', () => {
      class CustomArray extends Array {}
      const arr = new CustomArray();
      arr.push('test');
      expect(() => PayloadInspector.inspect(arr)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(arr);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_INVALID_PROTOTYPE');
      }
    });
  });

  describe('Byte Budget & String Length Enforcement', () => {
    it('enforces 1 KB ceiling on app:ping', () => {
      const safePing = { payload: 'a'.repeat(500) };
      expect(() => PayloadInspector.inspect(safePing, IPC_CHANNELS.APP_PING)).not.toThrow();

      const oversizedPing = { payload: 'a'.repeat(1100) };
      expect(() => PayloadInspector.inspect(oversizedPing, IPC_CHANNELS.APP_PING)).toThrowError(
        IPCPayloadBoundsError,
      );
      try {
        PayloadInspector.inspect(oversizedPing, IPC_CHANNELS.APP_PING);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_TOO_LARGE');
      }
    });

    it('enforces 8 KB ceiling on audit:validate-target', () => {
      const safeAudit = { targetUrl: 'https://example.com/' + 'a'.repeat(4000) };
      expect(() =>
        PayloadInspector.inspect(safeAudit, IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).not.toThrow();

      const oversizedAudit = { targetUrl: 'https://example.com/' + 'a'.repeat(9000) };
      expect(() =>
        PayloadInspector.inspect(oversizedAudit, IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toThrowError(IPCPayloadBoundsError);
    });

    it('enforces 4096 character general string limit', () => {
      const maxStr = 'a'.repeat(MAX_GENERAL_STRING_LENGTH);
      expect(() => PayloadInspector.inspect({ str: maxStr })).not.toThrow();

      const tooLongStr = 'a'.repeat(MAX_GENERAL_STRING_LENGTH + 1);
      expect(() => PayloadInspector.inspect({ str: tooLongStr })).toThrowError(
        IPCPayloadBoundsError,
      );
    });

    it('accurately counts multi-byte UTF-8 characters', () => {
      // Arabic characters take 2 bytes each in UTF-8
      const arabicStr = 'اختبار أمني'; // 11 characters, 21 UTF-8 bytes
      const byteLen = Buffer.byteLength(arabicStr, 'utf8');
      expect(byteLen).toBe(21);
      expect(() => PayloadInspector.inspect({ text: arabicStr })).not.toThrow();
    });
  });

  describe('Circular Reference Detection vs DAG Shared Object Reuse', () => {
    it('1. accepts the same object referenced by two sibling properties', () => {
      const shared = { key: 'sibling_shared' };
      const payload = {
        propA: shared,
        propB: shared,
      };
      expect(() => PayloadInspector.inspect(payload)).not.toThrow();
    });

    it('2. accepts the same nested object referenced through multiple array branches', () => {
      const shared = { id: 'nested_array_shared' };
      const payload = [[shared], [shared], { sub: shared }];
      expect(() => PayloadInspector.inspect(payload)).not.toThrow();
    });

    it('3. rejects direct self-reference with ERR_PAYLOAD_CIRCULAR_REFERENCE', () => {
      const selfRef: any = { tag: 'direct' };
      selfRef.loop = selfRef;
      expect(() => PayloadInspector.inspect(selfRef)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(selfRef);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_CIRCULAR_REFERENCE');
      }
    });

    it('4. rejects multi-object circular reference (A -> B -> C -> A) with ERR_PAYLOAD_CIRCULAR_REFERENCE', () => {
      const nodeA: any = { name: 'A' };
      const nodeB: any = { name: 'B' };
      const nodeC: any = { name: 'C' };
      nodeA.link = nodeB;
      nodeB.link = nodeC;
      nodeC.link = nodeA;
      expect(() => PayloadInspector.inspect(nodeA)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(nodeA);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_CIRCULAR_REFERENCE');
      }
    });

    it('5. accepts a valid diamond DAG containing shared nested objects and no cycles', () => {
      const leaf = { data: 'leaf' };
      const mid1 = { sharedLeaf: leaf, tag: 'mid1' };
      const mid2 = { sharedLeaf: leaf, tag: 'mid2' };
      const root = { branch1: mid1, branch2: mid2, direct: leaf };
      expect(() => PayloadInspector.inspect(root)).not.toThrow();
    });
  });

  describe('Proxy Trap Containment', () => {
    it('safely contains Proxy traps that throw in getPrototypeOf with ERR_PAYLOAD_INVALID_PROTOTYPE', () => {
      const throwingProxy = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('Malicious Proxy trap threw in getPrototypeOf');
          },
        },
      );
      expect(() => PayloadInspector.inspect(throwingProxy)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(throwingProxy);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_INVALID_PROTOTYPE');
      }
    });

    it('safely contains Proxy traps that throw in getOwnPropertyDescriptor with ERR_PAYLOAD_UNSUPPORTED_TYPE', () => {
      const throwingProxy = new Proxy(
        { prop: 'val' },
        {
          getOwnPropertyDescriptor() {
            throw new Error('Malicious Proxy trap threw in getOwnPropertyDescriptor');
          },
        },
      );
      expect(() => PayloadInspector.inspect(throwingProxy)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(throwingProxy);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_UNSUPPORTED_TYPE');
      }
    });

    it('safely contains Proxy traps that throw in ownKeys with ERR_PAYLOAD_UNSUPPORTED_TYPE', () => {
      const throwingProxy = new Proxy(
        { a: 1 },
        {
          ownKeys() {
            throw new Error('Malicious Proxy trap threw in ownKeys');
          },
        },
      );
      expect(() => PayloadInspector.inspect(throwingProxy)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(throwingProxy);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_UNSUPPORTED_TYPE');
      }
    });
  });

  describe('Type, Prototype, Symbol & Accessor Rejections', () => {
    it('rejects functions in payloads', () => {
      const withFn = { fn: () => {} };
      expect(() => PayloadInspector.inspect(withFn)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(withFn);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_UNSUPPORTED_TYPE');
      }
    });

    it('rejects BigInt values in payloads', () => {
      const withBigInt = { num: BigInt(42) };
      expect(() => PayloadInspector.inspect(withBigInt)).toThrowError(IPCPayloadBoundsError);
    });

    it('rejects getter accessors on objects', () => {
      const withGetter = {};
      Object.defineProperty(withGetter, 'evilProp', {
        get() {
          return 'getter_value';
        },
      });
      expect(() => PayloadInspector.inspect(withGetter)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(withGetter);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_UNSUPPORTED_TYPE');
      }
    });

    it('rejects getter accessors on array elements', () => {
      const arr = ['safe'];
      Object.defineProperty(arr, '1', {
        get() {
          return 'getter_elem';
        },
      });
      (arr as any).length = 2;
      expect(() => PayloadInspector.inspect(arr)).toThrowError(IPCPayloadBoundsError);
    });

    it('rejects symbols on objects', () => {
      const withSymbol = {
        [Symbol('evil')]: 'secret',
      };
      expect(() => PayloadInspector.inspect(withSymbol)).toThrowError(IPCPayloadBoundsError);
    });

    it('rejects non-plain object prototypes', () => {
      class CustomClass {
        public prop = 'hello';
      }
      const instance = new CustomClass();
      expect(() => PayloadInspector.inspect(instance)).toThrowError(IPCPayloadBoundsError);
      try {
        PayloadInspector.inspect(instance);
      } catch (e: any) {
        expect(e.code).toBe('ERR_PAYLOAD_INVALID_PROTOTYPE');
      }
    });
  });
});
