import { useState, useRef, useEffect, useCallback } from 'react';
import {
  IPC_ERROR_CODES,
  SAFE_IPC_ERROR_MESSAGES,
  type AuditValidateTargetRequest,
  type AuditValidateTargetResponse,
  type IPCSerializedError,
} from '@auditor/shared';

export interface UseTargetValidatorOptions {
  readonly debounceMs?: number;
}

export interface UseTargetValidatorReturn {
  readonly validating: boolean;
  readonly result: AuditValidateTargetResponse | null;
  readonly error: IPCSerializedError | null;
  readonly isValid: boolean | null;
  readonly isInScope: boolean | null;
  readonly normalizedUrl: string | null;
  readonly validationError: string | null;
  readonly validate: (
    targetUrl: string,
    allowedScope?: readonly string[],
    options?: AuditValidateTargetRequest['options'],
  ) => Promise<AuditValidateTargetResponse | null>;
  readonly reset: () => void;
}

const BRIDGE_UNAVAILABLE_ERROR: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: 'Electron IPC bridge (window.electronAPI) is not available',
});

const VALIDATION_DISPATCH_ERROR: Readonly<IPCSerializedError> = Object.freeze({
  code: IPC_ERROR_CODES.INTERNAL_ERROR,
  message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
});

/**
 * Documented cancellation response returned when a debounced validation call
 * is superseded by a newer request or settled on component unmount.
 */
export const DEBOUNCE_CANCELLED_RESULT: Readonly<AuditValidateTargetResponse> = Object.freeze({
  valid: false,
  error: 'ERR_VALIDATION_CANCELLED',
});

/**
 * Custom React hook for validating candidate scan targets via Main process IPC.
 *
 * CRITICAL SEMANTIC DISTINCTION:
 * - valid: Indicates syntactic, protocol (http/https), and port-policy validity.
 * - inScope: Indicates explicit authorization within the supplied allowedScope list.
 *
 * A URL can be valid but OUT OF SCOPE.
 * Never conflate valid = true with authorization to scan.
 * URL validation does NOT prove a website is safe, benign, or already audited.
 */
export function useTargetValidator(
  options: UseTargetValidatorOptions = {},
): UseTargetValidatorReturn {
  const { debounceMs = 0 } = options;

  const [validating, setValidating] = useState<boolean>(false);
  const [result, setResult] = useState<AuditValidateTargetResponse | null>(null);
  const [error, setError] = useState<IPCSerializedError | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDebounceResolverRef = useRef<((res: AuditValidateTargetResponse) => void) | null>(
    null,
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (pendingDebounceResolverRef.current) {
        pendingDebounceResolverRef.current(DEBOUNCE_CANCELLED_RESULT);
        pendingDebounceResolverRef.current = null;
      }
    };
  }, []);

  const reset = useCallback((): void => {
    requestIdRef.current += 1;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingDebounceResolverRef.current) {
      pendingDebounceResolverRef.current(DEBOUNCE_CANCELLED_RESULT);
      pendingDebounceResolverRef.current = null;
    }
    if (isMountedRef.current) {
      setValidating(false);
      setResult(null);
      setError(null);
    }
  }, []);

  const executeValidation = useCallback(
    async (
      targetUrl: string,
      allowedScope?: readonly string[],
      validationOptions?: AuditValidateTargetRequest['options'],
    ): Promise<AuditValidateTargetResponse | null> => {
      const trimmed = targetUrl.trim();

      // Empty input check: reset state without dispatching unnecessary IPC calls
      if (!trimmed) {
        reset();
        return null;
      }

      const currentId = (requestIdRef.current += 1);

      if (isMountedRef.current) {
        setValidating(true);
      }

      if (typeof window === 'undefined' || !window.electronAPI?.validateTarget) {
        if (isMountedRef.current && currentId === requestIdRef.current) {
          setResult(null);
          setError(BRIDGE_UNAVAILABLE_ERROR);
          setValidating(false);
        }
        return null;
      }

      const requestPayload: AuditValidateTargetRequest = {
        targetUrl: trimmed,
        ...(allowedScope && allowedScope.length > 0 ? { allowedScope: [...allowedScope] } : {}),
        ...(validationOptions ? { options: validationOptions } : {}),
      };

      try {
        const response = await window.electronAPI.validateTarget(requestPayload);

        // Stale response or unmounted protection
        if (!isMountedRef.current || currentId !== requestIdRef.current) {
          return null;
        }

        if (response.success) {
          setResult(response.data);
          setError(null);
          return response.data;
        } else {
          setResult(null);
          setError(response.error);
          return null;
        }
      } catch {
        if (!isMountedRef.current || currentId !== requestIdRef.current) {
          return null;
        }
        setResult(null);
        setError(VALIDATION_DISPATCH_ERROR);
        return null;
      } finally {
        if (isMountedRef.current && currentId === requestIdRef.current) {
          setValidating(false);
        }
      }
    },
    [reset],
  );

  const validate = useCallback(
    async (
      targetUrl: string,
      allowedScope?: readonly string[],
      validationOptions?: AuditValidateTargetRequest['options'],
    ): Promise<AuditValidateTargetResponse | null> => {
      // Settle any prior pending debounced invocation predictably with cancellation
      if (pendingDebounceResolverRef.current) {
        pendingDebounceResolverRef.current(DEBOUNCE_CANCELLED_RESULT);
        pendingDebounceResolverRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (debounceMs <= 0) {
        return executeValidation(targetUrl, allowedScope, validationOptions);
      }

      return new Promise<AuditValidateTargetResponse | null>(resolve => {
        pendingDebounceResolverRef.current = resolve;
        debounceTimerRef.current = setTimeout(async () => {
          pendingDebounceResolverRef.current = null;
          debounceTimerRef.current = null;
          const res = await executeValidation(targetUrl, allowedScope, validationOptions);
          resolve(res);
        }, debounceMs);
      });
    },
    [debounceMs, executeValidation],
  );

  return {
    validating,
    result,
    error,
    isValid: result?.valid ?? null,
    isInScope: result?.inScope ?? null,
    normalizedUrl: result?.normalizedUrl ?? null,
    validationError: result?.error ?? null,
    validate,
    reset,
  };
}
