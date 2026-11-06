import { ipcMain as electronIpcMain, type IpcMainInvokeEvent } from 'electron';
import { IPCError, IPC_ERROR_CODES } from '@auditor/shared';

/**
 * Standard Electron IPC invoke listener signature.
 */
export type IpcInvokeListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

/**
 * Minimal Electron ipcMain interface adhering strictly to Electron's official, documented API.
 * Electron documents ONLY `handle(channel, listener)` and `removeHandler(channel)`.
 * It does NOT provide `getHandler()`, `_invokeHandlers`, or query methods.
 */
export interface IpcMainLike {
  handle(channel: string, listener: IpcInvokeListener): void;
  removeHandler(channel: string): void;
}

/**
 * Lifecycle status of an IPC channel registration.
 */
export type ChannelRegistrationStatus = 'registered' | 'removal_failed';

/**
 * Authoritative record of an actively registered IPC channel handler.
 */
export interface ChannelRegistrationRecord {
  readonly ownerToken: symbol;
  readonly listener: IpcInvokeListener;
  readonly ipcMain: IpcMainLike;
  readonly status: ChannelRegistrationStatus;
}

/**
 * Authoritative Central IPC Registration Manager.
 *
 * Guarantees exclusive ownership and lifecycle tracking of all IPC channels registered on ipcMain.
 * Adheres strictly to Electron's documented public API (`handle` and `removeHandler`).
 * Prevents unauthorized replacement, unregistering of foreign channels, and race conditions.
 *
 * State Consistency Guarantees:
 * 1. Preserves ownership records until `ipcMain.removeHandler(channel)` completes successfully.
 * 2. If native removal throws, retains the ownership record and marks status as 'removal_failed'.
 * 3. Never leaks raw native errors across the boundary.
 * 4. Rejects new registrations for that channel while old registration remains unresolved.
 * 5. Allows controlled removal retries by the rightful owner.
 * 6. Never allows another owner to remove or replace a registration whose removal has failed.
 */
export class CentralIpcRegistrationManager {
  private static readonly activeRegistrations = new Map<string, ChannelRegistrationRecord>();

  /**
   * Authoritatively registers a handler on ipcMain for an exclusive channel.
   *
   * @param channel The IPC channel name
   * @param listener The invoke listener callback
   * @param ownerToken The unique ownership token of the registering component
   * @param ipcMain The underlying Electron ipcMain instance (defaults to electronIpcMain)
   * @throws IPCError if the channel is already registered or registration on ipcMain fails
   */
  public static register(
    channel: string,
    listener: IpcInvokeListener,
    ownerToken: symbol,
    ipcMain: IpcMainLike = electronIpcMain,
  ): void {
    const existing = this.activeRegistrations.get(channel);
    if (existing) {
      if (existing.status === 'removal_failed') {
        throw new IPCError(
          `Duplicate handler registration rejected for channel '${channel}': previous registration removal failed and remains unresolved`,
          IPC_ERROR_CODES.INTERNAL_ERROR,
        );
      }
      throw new IPCError(
        `Duplicate handler registration rejected for channel '${channel}'`,
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }

    try {
      ipcMain.handle(channel, listener);
    } catch {
      // Security: Never propagate raw error details across the boundary
      throw new IPCError(
        'Failed to register IPC handler on ipcMain',
        IPC_ERROR_CODES.INTERNAL_ERROR,
      );
    }

    // Record ownership strictly AFTER successful registration on ipcMain
    this.activeRegistrations.set(channel, {
      ownerToken,
      listener,
      ipcMain,
      status: 'registered',
    });
  }

  /**
   * Authoritatively unregisters a channel from ipcMain, strictly verifying ownership.
   * Preserves ownership record if native removal fails, marking it as removal_failed.
   *
   * @param channel The IPC channel name
   * @param ownerToken The ownership token requesting removal
   * @returns true if successfully unregistered by the rightful owner; false otherwise
   */
  public static unregister(channel: string, ownerToken: symbol): boolean {
    const record = this.activeRegistrations.get(channel);
    if (!record) {
      return false;
    }

    // Verify ownership: NEVER allow another component to remove or replace!
    if (record.ownerToken !== ownerToken) {
      return false;
    }

    try {
      record.ipcMain.removeHandler(channel);
      // Ownership is released ONLY after successful native removal
      this.activeRegistrations.delete(channel);
      return true;
    } catch {
      // Native removal threw: retain ownership record, mark as removal_failed
      this.activeRegistrations.set(channel, {
        ...record,
        status: 'removal_failed',
      });
      return false;
    }
  }

  /**
   * Unregisters all channels owned by the given owner token.
   * Retains registrations that fail native removal, marking them as removal_failed.
   *
   * @param ownerToken The ownership token whose registered channels should be removed
   * @returns array of channel names that were successfully unregistered
   */
  public static unregisterAllForOwner(ownerToken: symbol): string[] {
    const removed: string[] = [];
    for (const [channel, record] of this.activeRegistrations.entries()) {
      if (record.ownerToken === ownerToken) {
        try {
          record.ipcMain.removeHandler(channel);
          // Released ONLY after successful native removal
          this.activeRegistrations.delete(channel);
          removed.push(channel);
        } catch {
          // Native removal threw: retain ownership record, mark as removal_failed
          this.activeRegistrations.set(channel, {
            ...record,
            status: 'removal_failed',
          });
        }
      }
    }
    return removed;
  }

  /**
   * Checks whether a channel is currently registered in the manager.
   */
  public static isChannelRegistered(channel: string): boolean {
    return this.activeRegistrations.has(channel);
  }

  /**
   * Checks whether a channel is owned by a specific owner token.
   */
  public static isChannelOwnedBy(channel: string, ownerToken: symbol): boolean {
    const record = this.activeRegistrations.get(channel);
    return record !== undefined && record.ownerToken === ownerToken;
  }

  /**
   * Checks whether a channel's previous removal attempt failed.
   */
  public static isRemovalFailed(channel: string): boolean {
    const record = this.activeRegistrations.get(channel);
    return record !== undefined && record.status === 'removal_failed';
  }

  /**
   * Returns the registered record for a channel if registered.
   */
  public static getRegistration(channel: string): Readonly<ChannelRegistrationRecord> | undefined {
    const record = this.activeRegistrations.get(channel);
    return record ? Object.freeze({ ...record }) : undefined;
  }
}
