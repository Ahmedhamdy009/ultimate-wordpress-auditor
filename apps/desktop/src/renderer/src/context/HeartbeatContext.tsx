import React, { createContext, useContext, useMemo } from 'react';
import { usePing, type UsePingReturn, type UsePingOptions } from '../hooks/usePing.js';

export type HeartbeatContextValue = UsePingReturn;

const DEFAULT_HEARTBEAT_VALUE: HeartbeatContextValue = Object.freeze({
  connected: false,
  latencyMs: null,
  lastPongTimestamp: null,
  error: null,
  pinging: false,
  pingNow: async () => {},
});

const HeartbeatContext = createContext<HeartbeatContextValue>(DEFAULT_HEARTBEAT_VALUE);

export interface HeartbeatProviderProps extends UsePingOptions {
  readonly children: React.ReactNode;
}

/**
 * Isolated Heartbeat Provider.
 *
 * Encapsulates the single IPC ping loop for the entire application.
 * Prevents periodic latency updates from forcing the root App or unrelated
 * interactive views (such as TargetValidatorView) to re-render.
 */
export const HeartbeatProvider: React.FC<HeartbeatProviderProps> = ({
  children,
  enabled = true,
  intervalMs = 10000,
}) => {
  const pingState = usePing({ enabled, intervalMs });

  const contextValue = useMemo(
    () => ({
      connected: pingState.connected,
      latencyMs: pingState.latencyMs,
      lastPongTimestamp: pingState.lastPongTimestamp,
      error: pingState.error,
      pinging: pingState.pinging,
      pingNow: pingState.pingNow,
    }),
    [
      pingState.connected,
      pingState.latencyMs,
      pingState.lastPongTimestamp,
      pingState.error,
      pingState.pinging,
      pingState.pingNow,
    ],
  );

  return <HeartbeatContext.Provider value={contextValue}>{children}</HeartbeatContext.Provider>;
};

export function useHeartbeat(): HeartbeatContextValue {
  return useContext(HeartbeatContext);
}
