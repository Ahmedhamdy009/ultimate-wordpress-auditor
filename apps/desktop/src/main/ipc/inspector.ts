import {
  PAYLOAD_BOUNDS_POLICY,
  IPCPayloadBoundsError,
  IPC_ERROR_CODES,
  type IPCChannel,
} from '@auditor/shared';
import { CHANNEL_LIMITS } from './limiter.js';

interface TraversalNode {
  readonly value: unknown;
  readonly depth: number;
  readonly ancestors: Set<object>;
}

export const MAX_GENERAL_STRING_LENGTH = 4096;

/**
 * Bounded iterative payload inspector for Electron Main Process.
 *
 * Security & Architectural Guarantees:
 * - Bounded iterative traversal (no recursive calls, zero stack-overflow risk).
 * - Path-specific ancestor tracking (Set<object> per branch) to reliably detect circular
 *   references without falsely rejecting valid shared sub-objects in directed acyclic graphs (DAGs).
 * - Strict UTF-8 byte budget counting using Buffer.byteLength.
 * - Enforces per-channel byte ceilings (1 KB for ping/system-info, 8 KB for validate-target)
 *   capped at the global 1 MB maxTotalBytes boundary.
 * - Rejects unsupported types (functions, symbols, BigInt, Map, Set, Promises).
 * - Rejects non-plain prototypes, accessor properties (getters/setters), symbols, and sparse arrays.
 *
 * Note on Chromium IPC:
 * This inspector runs inside the Main Process memory space. It does NOT prevent the initial
 * Chromium IPC serialization cost that occurs before the payload is delivered to Main.
 */
export class PayloadInspector {
  public static inspect(payload: unknown, channel?: IPCChannel): void {
    const channelLimit = channel ? CHANNEL_LIMITS[channel]?.maxPayloadBytes : undefined;
    const maxBytes = Math.min(
      channelLimit ?? PAYLOAD_BOUNDS_POLICY.maxTotalBytes,
      PAYLOAD_BOUNDS_POLICY.maxTotalBytes,
    );

    let totalBytes = 0;

    const stack: TraversalNode[] = [
      {
        value: payload,
        depth: 0,
        ancestors: new Set<object>(),
      },
    ];

    while (stack.length > 0) {
      const { value, depth, ancestors } = stack.pop()!;

      // 1. Nesting depth check
      if (depth > PAYLOAD_BOUNDS_POLICY.maxDepth) {
        throw new IPCPayloadBoundsError(
          'Object nesting depth exceeds maximum allowed limit',
          IPC_ERROR_CODES.PAYLOAD_DEPTH_EXCEEDED,
        );
      }

      // 2. Null and Undefined
      if (value === null) {
        totalBytes += 4;
        if (totalBytes > maxBytes) {
          throw new IPCPayloadBoundsError(
            'Payload size exceeds maximum allowed boundary',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }
        continue;
      }

      if (value === undefined) {
        // Standalone undefined payload is permitted (e.g. void requests)
        totalBytes += 2;
        if (totalBytes > maxBytes) {
          throw new IPCPayloadBoundsError(
            'Payload size exceeds maximum allowed boundary',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }
        continue;
      }

      // 3. Primitive Types
      const valType = typeof value;

      if (valType === 'string') {
        const strVal = value as string;
        if (strVal.length > MAX_GENERAL_STRING_LENGTH) {
          throw new IPCPayloadBoundsError(
            'String length exceeds maximum allowed limit',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }
        totalBytes += Buffer.byteLength(strVal, 'utf8');
        if (totalBytes > maxBytes) {
          throw new IPCPayloadBoundsError(
            'Payload size exceeds maximum allowed boundary',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }
        continue;
      }

      if (valType === 'number') {
        if (!Number.isFinite(value)) {
          throw new IPCPayloadBoundsError(
            'Non-finite numbers are not supported',
            IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
          );
        }
        totalBytes += 8;
        if (totalBytes > maxBytes) {
          throw new IPCPayloadBoundsError(
            'Payload size exceeds maximum allowed boundary',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }
        continue;
      }

      if (valType === 'boolean') {
        totalBytes += 4;
        if (totalBytes > maxBytes) {
          throw new IPCPayloadBoundsError(
            'Payload size exceeds maximum allowed boundary',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }
        continue;
      }

      // 4. Unsupported Primitive Types
      if (valType === 'bigint' || valType === 'symbol' || valType === 'function') {
        throw new IPCPayloadBoundsError(
          `Payload contains unsupported type '${valType}'`,
          IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
        );
      }

      // 5. Objects & Arrays
      if (valType !== 'object') {
        throw new IPCPayloadBoundsError(
          'Payload contains unsupported data type',
          IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
        );
      }

      const objVal = value as object;

      // 6. Path-Specific Circular Reference Detection
      if (ancestors.has(objVal)) {
        throw new IPCPayloadBoundsError(
          'Circular reference detected in payload',
          IPC_ERROR_CODES.PAYLOAD_CIRCULAR_REFERENCE,
        );
      }

      const branchAncestors = new Set<object>(ancestors);
      branchAncestors.add(objVal);

      // 7. Array Inspection
      if (Array.isArray(objVal)) {
        let arrayProto: object | null;
        try {
          arrayProto = Object.getPrototypeOf(objVal);
        } catch {
          throw new IPCPayloadBoundsError(
            'Failed to inspect array prototype',
            IPC_ERROR_CODES.PAYLOAD_INVALID_PROTOTYPE,
          );
        }
        if (arrayProto !== Array.prototype) {
          throw new IPCPayloadBoundsError(
            'Array subclasses or unexpected prototypes are not allowed',
            IPC_ERROR_CODES.PAYLOAD_INVALID_PROTOTYPE,
          );
        }

        let len: unknown;
        try {
          len = objVal.length;
        } catch {
          throw new IPCPayloadBoundsError(
            'Failed to inspect array length',
            IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
          );
        }
        if (
          typeof len !== 'number' ||
          !Number.isInteger(len) ||
          len < 0 ||
          len > PAYLOAD_BOUNDS_POLICY.maxArrayLength
        ) {
          throw new IPCPayloadBoundsError(
            'Array length exceeds maximum allowed limit',
            IPC_ERROR_CODES.PAYLOAD_ARRAY_TOO_LARGE,
          );
        }

        // Sparse array rejection
        let keys: string[];
        try {
          keys = Object.keys(objVal);
        } catch {
          throw new IPCPayloadBoundsError(
            'Failed to inspect array keys',
            IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
          );
        }
        if (keys.length !== len) {
          throw new IPCPayloadBoundsError(
            'Sparse arrays with missing elements are not supported',
            IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
          );
        }

        // Structural array overhead: brackets
        totalBytes += 2;
        if (totalBytes > maxBytes) {
          throw new IPCPayloadBoundsError(
            'Payload size exceeds maximum allowed boundary',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }

        // Enqueue array elements in reverse order
        for (let i = len - 1; i >= 0; i--) {
          const key = String(i);
          let desc: PropertyDescriptor | undefined;
          try {
            desc = Object.getOwnPropertyDescriptor(objVal, key);
          } catch {
            throw new IPCPayloadBoundsError(
              'Failed to inspect array property descriptor',
              IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
            );
          }
          if (!desc || desc.get !== undefined || desc.set !== undefined || !('value' in desc)) {
            throw new IPCPayloadBoundsError(
              'Accessor properties in array elements are not allowed',
              IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
            );
          }

          stack.push({
            value: desc.value,
            depth: depth + 1,
            ancestors: branchAncestors,
          });
        }
        continue;
      }

      // 8. Plain Object Inspection
      let proto: object | null;
      try {
        proto = Object.getPrototypeOf(objVal);
      } catch {
        throw new IPCPayloadBoundsError(
          'Failed to inspect object prototype',
          IPC_ERROR_CODES.PAYLOAD_INVALID_PROTOTYPE,
        );
      }
      if (proto !== Object.prototype && proto !== null) {
        throw new IPCPayloadBoundsError(
          'Object prototype is not allowed',
          IPC_ERROR_CODES.PAYLOAD_INVALID_PROTOTYPE,
        );
      }

      let symbols: symbol[];
      try {
        symbols = Object.getOwnPropertySymbols(objVal);
      } catch {
        throw new IPCPayloadBoundsError(
          'Failed to inspect object symbols',
          IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
        );
      }
      if (symbols.length > 0) {
        throw new IPCPayloadBoundsError(
          'Symbol properties on objects are not allowed',
          IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
        );
      }

      let ownNames: string[];
      try {
        ownNames = Object.getOwnPropertyNames(objVal);
      } catch {
        throw new IPCPayloadBoundsError(
          'Failed to inspect object property names',
          IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
        );
      }
      if (ownNames.length > PAYLOAD_BOUNDS_POLICY.maxKeysPerObject) {
        throw new IPCPayloadBoundsError(
          'Object key count exceeds maximum allowed limit',
          IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
        );
      }

      // Structural object overhead: braces
      totalBytes += 2;
      if (totalBytes > maxBytes) {
        throw new IPCPayloadBoundsError(
          'Payload size exceeds maximum allowed boundary',
          IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
        );
      }

      // Enqueue properties in reverse order
      for (let i = ownNames.length - 1; i >= 0; i--) {
        const propName = ownNames[i];
        totalBytes += Buffer.byteLength(propName, 'utf8') + 3; // key + quotes + colon
        if (totalBytes > maxBytes) {
          throw new IPCPayloadBoundsError(
            'Payload size exceeds maximum allowed boundary',
            IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
          );
        }

        let desc: PropertyDescriptor | undefined;
        try {
          desc = Object.getOwnPropertyDescriptor(objVal, propName);
        } catch {
          throw new IPCPayloadBoundsError(
            'Failed to inspect property descriptor',
            IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
          );
        }
        if (!desc || desc.get !== undefined || desc.set !== undefined || !('value' in desc)) {
          throw new IPCPayloadBoundsError(
            'Accessor properties on objects are not allowed',
            IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE,
          );
        }

        stack.push({
          value: desc.value,
          depth: depth + 1,
          ancestors: branchAncestors,
        });
      }
    }
  }
}
