/**
 * Standardized IPC error codes, constrained error DTOs, and serialization guards.
 * Ensures consistent, safe serialization across the IPC boundary without exposing
 * internal stack traces, filesystem paths, raw Error objects, or user input data.
 *
 * Security Limitation Note:
 * Arbitrary JavaScript Proxies cannot be guaranteed to be safely inspected in all
 * theoretical scenarios (e.g. traps that hang or construct recursive loops in V8).
 * Any thrown inspection trap is safely caught and converted into a safe rejection (null),
 * preventing crashes and ensuring untrusted data cannot cross the IPC boundary.
 */

export const IPC_ERROR_CODES = {
  UNAUTHORIZED_SENDER: 'ERR_UNAUTHORIZED_SENDER',
  CHANNEL_NOT_FOUND: 'ERR_CHANNEL_NOT_FOUND',
  PAYLOAD_TOO_LARGE: 'ERR_PAYLOAD_TOO_LARGE',
  PAYLOAD_ARRAY_TOO_LARGE: 'ERR_PAYLOAD_ARRAY_TOO_LARGE',
  PAYLOAD_DEPTH_EXCEEDED: 'ERR_PAYLOAD_DEPTH_EXCEEDED',
  PAYLOAD_CIRCULAR_REFERENCE: 'ERR_PAYLOAD_CIRCULAR_REFERENCE',
  PAYLOAD_INVALID_PROTOTYPE: 'ERR_PAYLOAD_INVALID_PROTOTYPE',
  PAYLOAD_VALIDATION_FAILED: 'ERR_PAYLOAD_VALIDATION_FAILED',
  PAYLOAD_UNSUPPORTED_TYPE: 'ERR_PAYLOAD_UNSUPPORTED_TYPE',
  INTERNAL_ERROR: 'ERR_INTERNAL_ERROR',
  PATH_TRAVERSAL: 'ERR_PATH_TRAVERSAL',
  TMP_JUNCTION_ESCAPE: 'ERR_TMP_JUNCTION_ESCAPE',
  INVALID_PROJECT_DRIVE: 'ERR_INVALID_PROJECT_DRIVE',
  TMP_CANNOT_RESOLVE: 'ERR_TMP_CANNOT_RESOLVE',
  TMP_IS_PROJECT_ROOT: 'ERR_TMP_IS_PROJECT_ROOT',
  TMP_CROSS_DRIVE: 'ERR_TMP_CROSS_DRIVE',
  TMP_OUTSIDE_PROJECT: 'ERR_TMP_OUTSIDE_PROJECT',
} as const;

export type IPCErrorCode = (typeof IPC_ERROR_CODES)[keyof typeof IPC_ERROR_CODES];

/** Canonical set of allowlisted IPC error codes */
const ALLOWED_IPC_CODES = new Set<string>(Object.values(IPC_ERROR_CODES));

/**
 * Fixed, safe, non-leaking messages for all allowlisted IPC error codes.
 * Arbitrary error messages supplied at instantiation are NEVER forwarded across IPC.
 */
export const SAFE_IPC_ERROR_MESSAGES: Readonly<Record<IPCErrorCode, string>> = Object.freeze({
  [IPC_ERROR_CODES.UNAUTHORIZED_SENDER]: 'Unauthorized sender frame or process',
  [IPC_ERROR_CODES.CHANNEL_NOT_FOUND]: 'Requested IPC channel does not exist',
  [IPC_ERROR_CODES.PAYLOAD_TOO_LARGE]: 'Payload size exceeds maximum allowed boundary',
  [IPC_ERROR_CODES.PAYLOAD_ARRAY_TOO_LARGE]: 'Array length exceeds maximum allowed limit',
  [IPC_ERROR_CODES.PAYLOAD_DEPTH_EXCEEDED]: 'Object nesting depth exceeds maximum allowed limit',
  [IPC_ERROR_CODES.PAYLOAD_CIRCULAR_REFERENCE]: 'Circular reference detected in payload',
  [IPC_ERROR_CODES.PAYLOAD_INVALID_PROTOTYPE]: 'Object prototype is not allowed',
  [IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED]: 'Payload validation failed',
  [IPC_ERROR_CODES.PAYLOAD_UNSUPPORTED_TYPE]: 'Payload contains unsupported data type',
  [IPC_ERROR_CODES.INTERNAL_ERROR]: 'An internal error occurred while processing the IPC request',
  [IPC_ERROR_CODES.PATH_TRAVERSAL]: 'Path traversal outside boundary was detected',
  [IPC_ERROR_CODES.TMP_JUNCTION_ESCAPE]: 'Storage junction or link outside boundary was detected',
  [IPC_ERROR_CODES.INVALID_PROJECT_DRIVE]: 'Target storage path is on an invalid drive',
  [IPC_ERROR_CODES.TMP_CANNOT_RESOLVE]: 'Storage directory could not be physically resolved',
  [IPC_ERROR_CODES.TMP_IS_PROJECT_ROOT]: 'Storage directory must not match project root',
  [IPC_ERROR_CODES.TMP_CROSS_DRIVE]: 'Storage directory cannot span across multiple drives',
  [IPC_ERROR_CODES.TMP_OUTSIDE_PROJECT]:
    'Storage directory must remain strictly within project root',
});

export function isAllowedIPCCode(code: unknown): code is IPCErrorCode {
  return (
    typeof code === 'string' &&
    Object.hasOwn(SAFE_IPC_ERROR_MESSAGES, code) &&
    ALLOWED_IPC_CODES.has(code)
  );
}

/** Maximum number of field-level validation error details returned to the Renderer */
export const MAX_IPC_ERROR_DETAILS = 10;

/** Maximum length of a combined dotted path string */
export const MAX_IPC_ERROR_PATH_LENGTH = 128;

/** Maximum depth of path segments */
export const MAX_IPC_ERROR_PATH_DEPTH = 8;

/** Regex pattern for safe path segments: alphanumeric, underscore, or hyphen */
const SAFE_PATH_SEGMENT_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Allowlisted Zod issue codes mapped to canonical IPC validation codes and fixed safe messages.
 * Never interpolates user input, received tokens, passwords, or raw Zod text.
 */
export const SAFE_ZOD_CODE_MAP: Readonly<
  Record<string, { readonly code: string; readonly message: string }>
> = Object.freeze({
  invalid_type: Object.freeze({
    code: 'invalid_type',
    message: 'Invalid data type provided',
  }),
  too_big: Object.freeze({
    code: 'too_big',
    message: 'Value exceeds maximum permitted boundary',
  }),
  too_small: Object.freeze({
    code: 'too_small',
    message: 'Value is below minimum required boundary',
  }),
  invalid_format: Object.freeze({
    code: 'invalid_format',
    message: 'String format does not match expected pattern',
  }),
  invalid_string: Object.freeze({
    code: 'invalid_format',
    message: 'String format does not match expected pattern',
  }),
  invalid_enum_value: Object.freeze({
    code: 'invalid_enum',
    message: 'Value is not an accepted enum option',
  }),
  invalid_union: Object.freeze({
    code: 'invalid_union',
    message: 'Input does not match any valid schema variant',
  }),
  unrecognized_keys: Object.freeze({
    code: 'unrecognized_keys',
    message: 'Unexpected property encountered in strict schema',
  }),
  custom: Object.freeze({
    code: 'validation_failed',
    message: 'Field validation check failed',
  }),
});

export const FALLBACK_ZOD_DETAIL: Readonly<{ readonly code: string; readonly message: string }> =
  Object.freeze({
    code: 'invalid_value',
    message: 'Field validation failed',
  });

export const FALLBACK_INTERNAL_ERROR_DTO: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
});

interface InternalIPCErrorState {
  readonly code: IPCErrorCode;
  readonly details?: readonly IPCErrorDetail[];
}

/**
 * Isolated WeakMap holding verified internal state for authentic IPCError instances.
 * Completely immune to instance tampering, getter attacks, or method overriding.
 */
const IPC_ERROR_STATE = new WeakMap<object, InternalIPCErrorState>();

function sanitizePathSegment(segment: unknown): string | null {
  if (typeof segment === 'number') {
    if (Number.isInteger(segment) && segment >= 0 && segment <= 100_000) {
      return String(segment);
    }
    return null;
  }
  if (typeof segment === 'string') {
    if (SAFE_PATH_SEGMENT_REGEX.test(segment)) {
      return segment;
    }
    return null;
  }
  return null;
}

/**
 * Safely sanitizes a path input (string or array of segments) into a bounded, canonical dotted path.
 *
 * Security Guarantees:
 * - Entire inspection is wrapped in try/catch to safely handle revoked Proxies or throwing traps.
 * - Does NOT invoke Symbol.iterator or custom array iterators.
 * - Does NOT read array elements directly via index access; uses own property descriptors.
 * - Rejects accessor-backed elements (getters/setters) and maps them safely to '_invalid'.
 * - Enforces bounds on path depth (MAX_IPC_ERROR_PATH_DEPTH) and total length (MAX_IPC_ERROR_PATH_LENGTH).
 * - Handles sparse arrays without prototype pollution or invoking prototype getters.
 * - If inspection fails or input cannot be safely inspected, returns the fixed safe fallback '_root'.
 */
export function sanitizePath(pathInput: unknown): string {
  if (typeof pathInput === 'string') {
    if (pathInput.length === 0 || pathInput.length > MAX_IPC_ERROR_PATH_LENGTH) {
      return '_root';
    }
    const rawSegments = pathInput.split('.');
    const boundedLen = Math.min(rawSegments.length, MAX_IPC_ERROR_PATH_DEPTH);
    const safeSegments: string[] = [];

    for (let i = 0; i < boundedLen; i++) {
      const safe = sanitizePathSegment(rawSegments[i]);
      safeSegments.push(safe !== null ? safe : '_invalid');
    }

    const joined = safeSegments.join('.');
    return joined.length > MAX_IPC_ERROR_PATH_LENGTH
      ? joined.slice(0, MAX_IPC_ERROR_PATH_LENGTH)
      : joined.length > 0
        ? joined
        : '_root';
  }

  if (!pathInput || typeof pathInput !== 'object') {
    return '_root';
  }

  try {
    // 1. Array check (safely catches revoked Proxy or throwing trap)
    if (!Array.isArray(pathInput)) {
      return '_root';
    }

    // 2. Reject array subclasses or tampered prototypes
    if (Object.getPrototypeOf(pathInput) !== Array.prototype) {
      return '_root';
    }

    // 3. Inspect 'length' property descriptor to ensure it is a safe data descriptor
    const lenDesc = Object.getOwnPropertyDescriptor(pathInput, 'length');
    if (
      !lenDesc ||
      lenDesc.get !== undefined ||
      lenDesc.set !== undefined ||
      typeof lenDesc.value !== 'number' ||
      !Number.isInteger(lenDesc.value) ||
      lenDesc.value <= 0
    ) {
      return '_root';
    }

    const boundedLen = Math.min(lenDesc.value, MAX_IPC_ERROR_PATH_DEPTH);
    if (boundedLen === 0) {
      return '_root';
    }

    const safeSegments: string[] = [];

    for (let i = 0; i < boundedLen; i++) {
      const indexKey = String(i);

      // Handle sparse arrays safely
      if (!Object.hasOwn(pathInput, indexKey)) {
        safeSegments.push('_invalid');
        continue;
      }

      // Inspect element descriptor (reject accessor-backed elements, never invoke getters)
      const elemDesc = Object.getOwnPropertyDescriptor(pathInput, indexKey);
      if (
        !elemDesc ||
        elemDesc.get !== undefined ||
        elemDesc.set !== undefined ||
        !('value' in elemDesc)
      ) {
        safeSegments.push('_invalid');
        continue;
      }

      const safe = sanitizePathSegment(elemDesc.value);
      safeSegments.push(safe !== null ? safe : '_invalid');
    }

    const joined = safeSegments.join('.');
    return joined.length > MAX_IPC_ERROR_PATH_LENGTH
      ? joined.slice(0, MAX_IPC_ERROR_PATH_LENGTH)
      : joined.length > 0
        ? joined
        : '_root';
  } catch {
    // Safely catch revoked Proxies, throwing Proxy traps, or inspection failures
    return '_root';
  }
}

/**
 * Constrained error detail item for field-level validation errors.
 * Strictly restricted to safe path, allowlisted error code, and fixed safe message.
 * NEVER contains raw input data, received payloads, internal file paths, or stack traces.
 */
export interface IPCErrorDetail {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Strictly constrained, cross-process serializable error DTO.
 * Guarantees that internal exception instances, stack traces, and unconstrained
 * payloads cannot cross the IPC boundary to the Renderer.
 */
export interface IPCSerializedError {
  readonly code: IPCErrorCode;
  readonly message: string;
  readonly details?: readonly IPCErrorDetail[];
}

/**
 * Safely extracts and canonicalizes a single error detail item without executing getters or accessors.
 * Rejects non-plain prototypes, unexpected symbols, unexpected own properties, and accessor descriptors.
 */
function safeExtractDetail(
  rawItem: unknown,
  allowExtraMessageProperty = true,
): IPCErrorDetail | null {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }

  try {
    // 1. Prototype check: must be plain object
    const proto = Object.getPrototypeOf(rawItem);
    if (proto !== Object.prototype && proto !== null) {
      return null;
    }

    // 2. Reject unexpected symbols
    if (Object.getOwnPropertySymbols(rawItem).length > 0) {
      return null;
    }

    // 3. Inspect own property names: allow only 'path', 'code', and optionally 'message'
    const ownKeys = Object.getOwnPropertyNames(rawItem);
    for (const key of ownKeys) {
      if (key !== 'path' && key !== 'code' && key !== 'message') {
        return null;
      }
      if (key === 'message' && !allowExtraMessageProperty) {
        return null;
      }
    }

    // 4. Inspect property descriptors for 'path' and 'code' (prevent getter execution)
    const pathDesc = Object.getOwnPropertyDescriptor(rawItem, 'path');
    if (
      !pathDesc ||
      pathDesc.get !== undefined ||
      pathDesc.set !== undefined ||
      !('value' in pathDesc)
    ) {
      return null;
    }

    const codeDesc = Object.getOwnPropertyDescriptor(rawItem, 'code');
    if (
      !codeDesc ||
      codeDesc.get !== undefined ||
      codeDesc.set !== undefined ||
      !('value' in codeDesc)
    ) {
      return null;
    }

    // 5. Inspect 'message' descriptor if present (must not be an accessor)
    if (Object.hasOwn(rawItem, 'message')) {
      const msgDesc = Object.getOwnPropertyDescriptor(rawItem, 'message');
      if (
        !msgDesc ||
        msgDesc.get !== undefined ||
        msgDesc.set !== undefined ||
        !('value' in msgDesc)
      ) {
        return null;
      }
    }

    // 6. Extract data values safely (guaranteed data descriptors; no getter can run)
    const path = sanitizePath(pathDesc.value);
    const rawCode = typeof codeDesc.value === 'string' ? codeDesc.value : '';
    const mapping = Object.hasOwn(SAFE_ZOD_CODE_MAP, rawCode)
      ? SAFE_ZOD_CODE_MAP[rawCode]
      : FALLBACK_ZOD_DETAIL;

    return Object.freeze({
      path,
      code: mapping.code,
      message: mapping.message,
    });
  } catch {
    // Catch any Proxy trap throwing or inspection failure safely
    return null;
  }
}

/**
 * Defensive and bounded copy strategy for error details.
 * - Entire inspection is wrapped in try/catch to safely handle revoked Proxies or throwing traps.
 * - Rejects any input that is not a standard Array with Object.getPrototypeOf(input) === Array.prototype.
 * - Rejects array subclasses and unexpected prototypes.
 * - Does NOT invoke Symbol.iterator or custom iterators.
 * - Enforces the maximum detail count (MAX_IPC_ERROR_DETAILS) before processing.
 * - Uses own property descriptors to inspect elements; rejects accessor-backed elements (getters/setters).
 * - Safe against sparse arrays and throwing Proxy traps.
 * - Returns newly created, frozen plain DTO objects without retaining original references.
 * - Returns undefined if inspection fails or input is invalid.
 */
function defensiveCopyDetails(input: unknown): readonly IPCErrorDetail[] | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  try {
    // 1. Array check (safely catches revoked Proxy or throwing trap)
    if (!Array.isArray(input)) {
      return undefined;
    }

    // 2. Reject array subclasses or tampered prototypes
    if (Object.getPrototypeOf(input) !== Array.prototype) {
      return undefined;
    }

    // 3. Inspect 'length' property descriptor to ensure it is a safe data descriptor
    const lenDesc = Object.getOwnPropertyDescriptor(input, 'length');
    if (
      !lenDesc ||
      lenDesc.get !== undefined ||
      lenDesc.set !== undefined ||
      typeof lenDesc.value !== 'number' ||
      !Number.isInteger(lenDesc.value) ||
      lenDesc.value <= 0
    ) {
      return undefined;
    }

    const boundedLen = Math.min(lenDesc.value, MAX_IPC_ERROR_DETAILS);
    const safeList: IPCErrorDetail[] = [];

    for (let i = 0; i < boundedLen; i++) {
      const indexKey = String(i);

      // Skip holes in sparse arrays without invoking prototype getters
      if (!Object.hasOwn(input, indexKey)) {
        continue;
      }

      // Inspect element descriptor (reject accessor-backed elements, never invoke getters)
      const elemDesc = Object.getOwnPropertyDescriptor(input, indexKey);
      if (
        !elemDesc ||
        elemDesc.get !== undefined ||
        elemDesc.set !== undefined ||
        !('value' in elemDesc)
      ) {
        continue;
      }

      const safeDetail = safeExtractDetail(elemDesc.value, true);
      if (safeDetail !== null) {
        safeList.push(safeDetail);
      }
    }

    return safeList.length > 0 ? Object.freeze(safeList) : undefined;
  } catch {
    // Safely catch revoked Proxies, throwing Proxy traps, or inspection failures
    return undefined;
  }
}

/**
 * Sanitizes Zod validation issues into constrained IPCErrorDetail items.
 * Completely ignores and discards issue.message, raw input values, received data,
 * and internal structures, enforcing an allowlist of codes and fixed safe messages.
 */
export function sanitizeZodIssues(
  issues: readonly {
    path?: readonly unknown[];
    code?: unknown;
    message?: unknown;
  }[],
): readonly IPCErrorDetail[] {
  if (!issues || typeof issues !== 'object') {
    return Object.freeze([]);
  }

  try {
    if (!Array.isArray(issues)) {
      return Object.freeze([]);
    }

    if (Object.getPrototypeOf(issues) !== Array.prototype) {
      return Object.freeze([]);
    }

    const lenDesc = Object.getOwnPropertyDescriptor(issues, 'length');
    if (
      !lenDesc ||
      lenDesc.get !== undefined ||
      lenDesc.set !== undefined ||
      typeof lenDesc.value !== 'number' ||
      !Number.isInteger(lenDesc.value) ||
      lenDesc.value <= 0
    ) {
      return Object.freeze([]);
    }

    const boundedLen = Math.min(lenDesc.value, MAX_IPC_ERROR_DETAILS);
    const sanitizedList: IPCErrorDetail[] = [];

    for (let i = 0; i < boundedLen; i++) {
      const indexKey = String(i);
      if (!Object.hasOwn(issues, indexKey)) {
        continue;
      }

      const issueDesc = Object.getOwnPropertyDescriptor(issues, indexKey);
      if (
        !issueDesc ||
        issueDesc.get !== undefined ||
        issueDesc.set !== undefined ||
        !('value' in issueDesc)
      ) {
        continue;
      }

      const issue = issueDesc.value;
      if (!issue || typeof issue !== 'object') {
        continue;
      }

      const proto = Object.getPrototypeOf(issue);
      if (proto !== Object.prototype && proto !== null) {
        continue;
      }

      if (Object.getOwnPropertySymbols(issue).length > 0) {
        continue;
      }

      // Check path descriptor
      const pathDesc = Object.getOwnPropertyDescriptor(issue, 'path');
      if (
        !pathDesc ||
        pathDesc.get !== undefined ||
        pathDesc.set !== undefined ||
        !('value' in pathDesc)
      ) {
        continue;
      }

      // Check code descriptor
      const codeDesc = Object.getOwnPropertyDescriptor(issue, 'code');
      if (
        !codeDesc ||
        codeDesc.get !== undefined ||
        codeDesc.set !== undefined ||
        !('value' in codeDesc)
      ) {
        continue;
      }

      const path = sanitizePath(pathDesc.value);
      const rawCode = typeof codeDesc.value === 'string' ? codeDesc.value : '';
      const mapping = Object.hasOwn(SAFE_ZOD_CODE_MAP, rawCode)
        ? SAFE_ZOD_CODE_MAP[rawCode]
        : FALLBACK_ZOD_DETAIL;

      sanitizedList.push(
        Object.freeze({
          path,
          code: mapping.code,
          message: mapping.message,
        }),
      );
    }

    return Object.freeze(sanitizedList);
  } catch {
    return Object.freeze([]);
  }
}

/**
 * Validates and re-sanitizes error details at the serialization boundary.
 * Guarantees no custom, accessor-backed, or malicious detail payload can bypass sanitization.
 */
function sanitizeErrorDetailsAtBoundary(details: unknown): readonly IPCErrorDetail[] | undefined {
  return defensiveCopyDetails(details);
}

export class IPCError extends Error {
  public readonly code: IPCErrorCode;
  public readonly details?: readonly IPCErrorDetail[];

  constructor(message: string, code: IPCErrorCode | string, details?: readonly unknown[]) {
    super(message);
    this.name = 'IPCError';

    const safeCode: IPCErrorCode = isAllowedIPCCode(code) ? code : IPC_ERROR_CODES.INTERNAL_ERROR;
    const safeDetails = defensiveCopyDetails(details);

    this.code = safeCode;
    this.details = safeDetails;

    try {
      IPC_ERROR_STATE.set(this, {
        code: safeCode,
        details: safeDetails,
      });
    } catch {
      // Non-fatal if WeakMap.set fails for any exotic host object
    }

    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serializes the error to a strictly constrained IPCSerializedError DTO.
   * Delegates directly to the safe internal serialization path.
   */
  public toJSON(): IPCSerializedError {
    return toSafeIPCError(this);
  }
}

export class IPCSecurityError extends IPCError {
  constructor(
    message: string,
    code: IPCErrorCode | string = IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
    details?: readonly unknown[],
  ) {
    super(message, code, details);
    this.name = 'IPCSecurityError';
  }
}

export class IPCPayloadBoundsError extends IPCError {
  constructor(
    message: string,
    code: IPCErrorCode | string = IPC_ERROR_CODES.PAYLOAD_TOO_LARGE,
    details?: readonly unknown[],
  ) {
    super(message, code, details);
    this.name = 'IPCPayloadBoundsError';
  }
}

export class IPCValidationError extends IPCError {
  constructor(message: string, details?: readonly unknown[]) {
    super(message, IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED, details);
    this.name = 'IPCValidationError';
  }
}

/**
 * Safely converts any error (including native Errors, raw exceptions, Proxies, or unknown objects)
 * into a safe, constrained IPCSerializedError DTO.
 *
 * Security Guarantees:
 * 1. Safe internal serialization: Authentic IPCError instances are recognized via an internal WeakMap;
 *    their internal validated state is used directly. Neither `error.toJSON()` nor any arbitrary method
 *    or getter on the error instance or its prototype is ever invoked.
 * 2. Revoked Proxies and throwing traps: Entire lookup is protected within a try/catch block; any
 *    revoked Proxy or thrown Proxy trap safely falls back to the canonical INTERNAL_ERROR DTO.
 * 3. Any unhandled or native exception (e.g. Error instances, strings, plain objects) is converted
 *    to the canonical INTERNAL_ERROR DTO, strictly concealing stack traces, file paths, and messages.
 * 4. The returned DTO contains ONLY approved fields (code, message, and optionally details).
 */
export function toSafeIPCError(error: unknown): IPCSerializedError {
  if (!error || typeof error !== 'object') {
    return FALLBACK_INTERNAL_ERROR_DTO;
  }

  try {
    const internalState = IPC_ERROR_STATE.get(error);
    if (internalState !== undefined) {
      const safeCode = isAllowedIPCCode(internalState.code)
        ? internalState.code
        : IPC_ERROR_CODES.INTERNAL_ERROR;

      const safeMessage = SAFE_IPC_ERROR_MESSAGES[safeCode];
      const safeDetails = sanitizeErrorDetailsAtBoundary(internalState.details);

      const dto: IPCSerializedError = {
        code: safeCode,
        message: safeMessage,
        ...(safeDetails ? { details: safeDetails } : {}),
      };

      return Object.freeze(dto);
    }
  } catch {
    return FALLBACK_INTERNAL_ERROR_DTO;
  }

  return FALLBACK_INTERNAL_ERROR_DTO;
}
