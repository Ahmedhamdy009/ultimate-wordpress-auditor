import type { WebContents } from 'electron';

export interface RequestLease {
  readonly signal: AbortSignal;
  readonly complete: () => void;
}

/**
 * Manages request lifecycle and cooperative cancellation bound to WebContents.
 *
 * Architectural & Safety Design:
 * - Maintains active AbortControllers in a Map<number, Set<AbortController>> keyed by WebContents.id.
 * - Attaches exactly ONE 'destroyed' event listener per WebContents, avoiding memory leaks
 *   from per-request event listener proliferation.
 * - When a WebContents is destroyed, all in-flight AbortControllers for that WebContents are aborted,
 *   cooperatively notifying handlers that observe the AbortSignal.
 * - Race-condition safe: request completion and window destruction cleanups are idempotent.
 *
 * Technical Note on AbortSignal:
 * Node.js and JavaScript runtimes cannot preemptively interrupt running JavaScript synchronous execution.
 * The AbortSignal cancels asynchronous operations only if the handler cooperatively checks
 * `signal.aborted` or passes `signal` to async APIs (e.g. fetch, timers, streams).
 */
interface BoundListenerRecord {
  readonly webContents: WebContents;
  readonly listener: () => void;
}

export class WebContentsLifecycleManager {
  private readonly activeControllers = new Map<number, Set<AbortController>>();
  private readonly boundListeners = new Map<number, BoundListenerRecord>();
  private readonly destructionCallbacks = new Map<number, () => void>();

  /**
   * Acquires an AbortSignal for a new in-flight request on the given WebContents.
   * Lazily registers exactly one 'destroyed' listener for the WebContents.
   */
  public acquireSignal(webContents: WebContents, onDestroyCallback?: () => void): RequestLease {
    const webContentsId = webContents.id;

    if (webContents.isDestroyed()) {
      const controller = new AbortController();
      controller.abort();
      return {
        signal: controller.signal,
        complete: () => {},
      };
    }

    let controllerSet = this.activeControllers.get(webContentsId);
    if (!controllerSet) {
      controllerSet = new Set<AbortController>();
      this.activeControllers.set(webContentsId, controllerSet);
    }

    if (onDestroyCallback && !this.destructionCallbacks.has(webContentsId)) {
      this.destructionCallbacks.set(webContentsId, onDestroyCallback);
    }

    // Attach exactly ONE 'destroyed' listener per WebContents lifetime
    if (!this.boundListeners.has(webContentsId)) {
      const cleanupHandler = () => {
        this.abortAll(webContentsId);
      };

      this.boundListeners.set(webContentsId, {
        webContents,
        listener: cleanupHandler,
      });

      webContents.once('destroyed', cleanupHandler);
    }

    const controller = new AbortController();
    controllerSet.add(controller);

    let completed = false;
    const complete = () => {
      if (completed) {
        return;
      }
      completed = true;
      const set = this.activeControllers.get(webContentsId);
      if (set) {
        set.delete(controller);
        if (set.size === 0 && webContents.isDestroyed()) {
          this.activeControllers.delete(webContentsId);
        }
      }
    };

    return {
      signal: controller.signal,
      complete,
    };
  }

  /**
   * Aborts all active requests associated with a WebContents and cleans up its tracking set.
   */
  public abortAll(webContentsId: number): void {
    const controllerSet = this.activeControllers.get(webContentsId);
    if (controllerSet) {
      for (const controller of controllerSet) {
        try {
          controller.abort();
        } catch {
          // Ignore individual abort listener exceptions to ensure all controllers are aborted
        }
      }
      controllerSet.clear();
      this.activeControllers.delete(webContentsId);
    }

    const bound = this.boundListeners.get(webContentsId);
    if (bound) {
      this.boundListeners.delete(webContentsId);
      try {
        if (
          !bound.webContents.isDestroyed() &&
          typeof bound.webContents.removeListener === 'function'
        ) {
          bound.webContents.removeListener('destroyed', bound.listener);
        }
      } catch {
        // Safe fail-through
      }
    }

    const onDestruction = this.destructionCallbacks.get(webContentsId);
    if (onDestruction) {
      this.destructionCallbacks.delete(webContentsId);
      try {
        onDestruction();
      } catch {
        // Safe fail-through
      }
    }
  }

  /**
   * Aborts all active requests across all WebContents during dispatcher teardown.
   * Removes all registered WebContents destroyed listeners.
   */
  public teardown(): void {
    for (const webContentsId of Array.from(this.activeControllers.keys())) {
      this.abortAll(webContentsId);
    }

    // Detach any remaining bound listeners
    for (const [webContentsId, bound] of this.boundListeners.entries()) {
      try {
        if (
          !bound.webContents.isDestroyed() &&
          typeof bound.webContents.removeListener === 'function'
        ) {
          bound.webContents.removeListener('destroyed', bound.listener);
        }
      } catch {
        // Safe fail-through
      }
      this.boundListeners.delete(webContentsId);
    }

    this.activeControllers.clear();
    this.destructionCallbacks.clear();
  }
}
