import { ipcMain as electronIpcMain, type IpcMainInvokeEvent } from 'electron';
import {
  isIPCChannel,
  validateIPCRequest,
  validateIPCResponse,
  toSafeIPCError,
  IPCError,
  IPC_ERROR_CODES,
  IPCRateLimitError,
  IPCConcurrencyError,
  type IPCChannel,
  type IPCChannelRequest,
  type IPCChannelResponse,
  type IPCResult,
} from '@auditor/shared';
import { SenderGuard, type SenderGuardOptions } from './guard.js';
import { ChannelRateLimiter } from './limiter.js';
import { PayloadInspector } from './inspector.js';
import { WebContentsLifecycleManager, type RequestLease } from './lifecycle.js';
import {
  CentralIpcRegistrationManager,
  type IpcMainLike,
  type IpcInvokeListener,
} from './manager.js';

export type { IpcMainLike, IpcInvokeListener };

export interface IpcHandlerContext {
  readonly event: IpcMainInvokeEvent;
  readonly signal: AbortSignal;
}

export type IpcChannelHandler<C extends IPCChannel> = (
  request: IPCChannelRequest<C>,
  context: IpcHandlerContext,
) => Promise<IPCChannelResponse<C>>;

export interface SecureIpcDispatcherOptions extends SenderGuardOptions {
  readonly ipcMain?: IpcMainLike;
}

/**
 * Sanitizes validated handler responses into a plain, detached DTO.
 * Guarantees no internal prototypes, class instances, or functions cross the boundary.
 */
function sanitizeResponseToDto<T>(data: T): T {
  if (data === undefined || data === null || typeof data !== 'object') {
    return data;
  }
  return JSON.parse(JSON.stringify(data)) as T;
}

/**
 * Central Secure IPC Dispatcher for Electron Main Process.
 *
 * Enforces a strict, defense-in-depth pipeline on all incoming IPC messages:
 * 1. Receive IPC request.
 * 2. Validate sender identity and origin (Hardened Sender Guard).
 * 3. Verify channel registration and policy.
 * 4. Apply rate limiting and concurrency limits.
 * 5. Inspect and validate incoming payload using bounded iterative inspector.
 * 6. Validate request data against channel schema.
 * 7. Execute registered handler with cooperative AbortSignal.
 * 8. Validate handler response against response schema.
 * 9. Sanitize response into safe plain DTO.
 * 10. Return IPCResult<T> envelope.
 */
export class SecureIpcDispatcher {
  private readonly dispatcherId: symbol = Symbol(`dispatcher_${Date.now()}`);
  private readonly ipcMain: IpcMainLike;
  private readonly options?: SenderGuardOptions;
  private readonly limiter = new ChannelRateLimiter();
  private readonly lifecycle = new WebContentsLifecycleManager();
  private readonly registeredHandlers = new Map<string, IpcChannelHandler<IPCChannel>>();
  private readonly registeredListeners = new Map<string, IpcInvokeListener>();
  private isTornDown = false;

  constructor(options?: SecureIpcDispatcherOptions) {
    this.ipcMain = options?.ipcMain ?? electronIpcMain;
    this.options = options;
  }

  /**
   * Registers a strongly-typed handler for an allowlisted IPC channel.
   * Rejects unknown channels, duplicate registrations, and registrations after teardown.
   */
  public registerHandler<C extends IPCChannel>(channel: C, handler: IpcChannelHandler<C>): void {
    if (this.isTornDown) {
      throw new IPCError(
        'Cannot register IPC handler after dispatcher teardown',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }

    if (!isIPCChannel(channel)) {
      throw new IPCError(
        `Channel '${String(channel)}' is not in ALLOWED_IPC_CHANNELS`,
        IPC_ERROR_CODES.CHANNEL_NOT_FOUND,
      );
    }

    if (this.registeredHandlers.has(channel)) {
      throw new IPCError(
        `Duplicate handler registration rejected for channel '${channel}'`,
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }

    const dispatcherListener: IpcInvokeListener = async (
      event: IpcMainInvokeEvent,
      rawPayload: unknown,
    ): Promise<IPCResult<unknown>> => {
      return this.processRequest(channel, event, rawPayload);
    };

    // Authoritative exclusive registration via CentralIpcRegistrationManager
    CentralIpcRegistrationManager.register(
      channel,
      dispatcherListener,
      this.dispatcherId,
      this.ipcMain,
    );

    // Record locally after successful central registration
    this.registeredHandlers.set(channel, handler);
    this.registeredListeners.set(channel, dispatcherListener);
  }

  /**
   * Internal request execution pipeline.
   * Ensures that all failures, regardless of origin, return a safe, sanitized IPCResult envelope.
   */
  public async processRequest<C extends IPCChannel>(
    channel: C,
    event: IpcMainInvokeEvent,
    rawPayload: unknown,
  ): Promise<IPCResult<IPCChannelResponse<C>>> {
    let concurrencyLease: { release: () => void } | undefined;
    let requestLease: RequestLease | undefined;

    try {
      // Dispatcher lifecycle check
      if (this.isTornDown) {
        throw new IPCError('Dispatcher is shutting down', IPC_ERROR_CODES.INTERNAL_ERROR);
      }

      // 1. Channel allowlist and registration verification
      if (!isIPCChannel(channel)) {
        throw new IPCError(
          `Channel '${String(channel)}' is not in ALLOWED_IPC_CHANNELS`,
          IPC_ERROR_CODES.CHANNEL_NOT_FOUND,
        );
      }
      const handler = this.registeredHandlers.get(channel);
      if (!handler) {
        throw new IPCError(
          `Requested IPC channel '${channel}' is not registered`,
          IPC_ERROR_CODES.CHANNEL_NOT_FOUND,
        );
      }

      // 2. Sender validation (Identity, Frame, Liveness, Registry, Origin)
      const senderCheck = SenderGuard.validateSender(event, this.options);
      if (!senderCheck.isValid) {
        throw senderCheck.error;
      }

      const { webContents } = senderCheck;
      const webContentsId = webContents.id;

      // 3. Lifecycle and concurrency acquisition
      requestLease = this.lifecycle.acquireSignal(webContents, () => {
        this.limiter.cleanup(webContentsId);
      });
      const lease = this.limiter.acquireConcurrency(webContentsId, channel);
      if (!lease.acquired) {
        throw new IPCConcurrencyError();
      }
      concurrencyLease = lease;

      // 4. Rate limiting check (1-second sliding window)
      const allowedByRateLimit = this.limiter.checkRateLimit(webContentsId, channel);
      if (!allowedByRateLimit) {
        throw new IPCRateLimitError();
      }

      // 5. Bounded iterative payload inspection (depth, budget, symbols, accessors, circular refs)
      PayloadInspector.inspect(rawPayload, channel);

      // 6. Request schema validation via Zod
      const validatedRequest = validateIPCRequest(channel, rawPayload);

      // 7. Handler execution with cooperative AbortSignal
      const rawResponse = await handler(validatedRequest, {
        event,
        signal: requestLease.signal,
      });

      // 8. Abort-state verification
      if (requestLease.signal.aborted) {
        throw new IPCError(
          'Request was aborted due to WebContents destruction',
          IPC_ERROR_CODES.INTERNAL_ERROR,
        );
      }

      // 9. Response schema validation via Zod
      const validatedResponse = validateIPCResponse(channel, rawResponse);

      // 10. Safe DTO serialization
      const sanitizedData = sanitizeResponseToDto(validatedResponse);

      return {
        success: true,
        data: sanitizedData,
      };
    } catch (err: unknown) {
      const safeError = toSafeIPCError(err);
      return {
        success: false,
        error: safeError,
      };
    } finally {
      // Guaranteed exactly-once release of concurrency slot and request lifecycle
      if (concurrencyLease) {
        concurrencyLease.release();
      }
      if (requestLease) {
        requestLease.complete();
      }
    }
  }

  /**
   * Safely tears down the dispatcher:
   * - Authoritatively unregisters owned IPC handlers via CentralIpcRegistrationManager.
   * - Aborts all in-flight requests.
   * - Releases all rate-limiter and concurrency state.
   * - Prevents duplicate cleanup (idempotent).
   * - Prevents new registrations after shutdown.
   */
  public teardown(): void {
    this.isTornDown = true;

    // Remove handlers from Electron ipcMain strictly through CentralIpcRegistrationManager
    CentralIpcRegistrationManager.unregisterAllForOwner(this.dispatcherId);

    this.registeredHandlers.clear();
    this.registeredListeners.clear();

    // Abort active requests and remove WebContents listeners
    this.lifecycle.teardown();

    // Reset rate limiter and concurrency tracking
    this.limiter.resetAll();
  }
}
