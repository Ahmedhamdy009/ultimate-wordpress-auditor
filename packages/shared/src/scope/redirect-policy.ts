/**
 * Multi-dimensional redirect authorization policy engine.
 * 100% Isomorphic: Pure TypeScript with zero Node.js built-ins.
 */

import { isUrlInScope, getEffectivePort, type ScopePolicyOptions } from './guard.js';

export interface RedirectPolicyOptions extends ScopePolicyOptions {
  /**
   * If true, permits external redirects that transition from one external hostname
   * to a different external hostname.
   * Default is false (strictly rejects cross-host external redirects to prevent scope expansion).
   */
  readonly allowCrossHostExternalRedirects?: boolean;

  /**
   * If true, permits an HTTPS endpoint to redirect to an unencrypted HTTP endpoint.
   * Default is false (strictly rejects HTTPS-to-HTTP downgrade).
   */
  readonly allowHttpsDowngrade?: boolean;

  /**
   * Current hop index (1-based, e.g. 1 for first redirect).
   * Default is 1.
   */
  readonly hopCount?: number;

  /**
   * Maximum permitted redirect hops.
   * Default is 5 for in-scope redirects, 2 for external links.
   */
  readonly maxHops?: number;
}

export interface RedirectPolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly targetUrl?: string;
  readonly isExternal: boolean;
  readonly isCrossHost: boolean;
  readonly isHttpsDowngrade: boolean;
  readonly isPortChange: boolean;
  readonly nextHopCount: number;
}

/**
 * Authoritatively evaluates an incoming HTTP redirect (3xx Location) against scope boundaries.
 * Enforces:
 * - Scheme restrictions (http/https only).
 * - HTTPS-to-HTTP downgrade rejection by default.
 * - Port change rejection by default.
 * - Cross-host external redirect rejection by default.
 * - Same-host external redirect bounding (max 2 hops).
 * - Target credential stripping / rejection.
 * - Hop count ceilings (prevents infinite redirect loops).
 */
export function evaluateRedirectPolicy(
  currentUrlStr: string,
  locationHeader: string,
  allowedHosts: readonly string[],
  options?: RedirectPolicyOptions,
): RedirectPolicyDecision {
  const currentHop = options?.hopCount ?? 1;
  const allowCrossHost = options?.allowCrossHostExternalRedirects === true;
  const allowDowngrade = options?.allowHttpsDowngrade === true;

  let currentParsed: URL;
  try {
    currentParsed = new URL(currentUrlStr.trim());
  } catch {
    return {
      allowed: false,
      reason: `Invalid current URL: "${currentUrlStr}".`,
      isExternal: false,
      isCrossHost: false,
      isHttpsDowngrade: false,
      isPortChange: false,
      nextHopCount: currentHop,
    };
  }

  // Resolve Location relative to current URL
  let targetParsed: URL;
  try {
    targetParsed = new URL(locationHeader.trim(), currentParsed);
  } catch {
    return {
      allowed: false,
      reason: `Invalid or unparseable redirect Location: "${locationHeader}".`,
      isExternal: false,
      isCrossHost: false,
      isHttpsDowngrade: false,
      isPortChange: false,
      nextHopCount: currentHop,
    };
  }

  const targetUrl = targetParsed.toString();

  // 1. Protocol check (http: and https: only)
  if (targetParsed.protocol !== 'http:' && targetParsed.protocol !== 'https:') {
    return {
      allowed: false,
      reason: `Unsupported redirect protocol: "${targetParsed.protocol}". Only http: and https: are permitted.`,
      targetUrl,
      isExternal: false,
      isCrossHost: false,
      isHttpsDowngrade: false,
      isPortChange: false,
      nextHopCount: currentHop,
    };
  }

  // 2. Reject embedded credentials in redirect target
  if (targetParsed.username !== '' || targetParsed.password !== '') {
    return {
      allowed: false,
      reason:
        'Redirect target contains embedded credentials (username/password), which is strictly forbidden.',
      targetUrl,
      isExternal: false,
      isCrossHost: false,
      isHttpsDowngrade: false,
      isPortChange: false,
      nextHopCount: currentHop,
    };
  }

  // 3. HTTPS-to-HTTP downgrade check
  const isHttpsDowngrade = currentParsed.protocol === 'https:' && targetParsed.protocol === 'http:';
  if (isHttpsDowngrade && !allowDowngrade) {
    return {
      allowed: false,
      reason:
        'HTTPS-to-HTTP downgrade redirect is strictly rejected by default to prevent SSL stripping.',
      targetUrl,
      isExternal: false,
      isCrossHost: false,
      isHttpsDowngrade: true,
      isPortChange: false,
      nextHopCount: currentHop,
    };
  }

  // 4. Port change check
  const currentPort = getEffectivePort(currentParsed);
  const targetPort = getEffectivePort(targetParsed);
  const isPortChange = currentPort !== targetPort;

  // 5. In-Scope evaluation
  const inScope = isUrlInScope(targetUrl, allowedHosts, options);
  const isExternal = !inScope;

  // Compare hostnames
  const currentHost = currentParsed.hostname.toLowerCase();
  const targetHost = targetParsed.hostname.toLowerCase();
  const isCrossHost = currentHost !== targetHost;

  // 6. Max hops ceiling
  const defaultMaxHops = isExternal ? 2 : 5;
  const maxHops = options?.maxHops ?? defaultMaxHops;

  if (currentHop > maxHops) {
    return {
      allowed: false,
      reason: `Redirect hop count (${currentHop}) exceeded maximum allowed limit (${maxHops}).`,
      targetUrl,
      isExternal,
      isCrossHost,
      isHttpsDowngrade,
      isPortChange,
      nextHopCount: currentHop,
    };
  }

  // 7. External redirect policies
  if (isExternal) {
    if (isCrossHost && !allowCrossHost) {
      return {
        allowed: false,
        reason: `Cross-host external redirect from "${currentHost}" to "${targetHost}" is rejected by default.`,
        targetUrl,
        isExternal: true,
        isCrossHost: true,
        isHttpsDowngrade,
        isPortChange,
        nextHopCount: currentHop,
      };
    }

    if (
      isPortChange &&
      options?.allowAnyPort !== true &&
      !options?.allowedPorts?.includes(targetPort)
    ) {
      return {
        allowed: false,
        reason: `External redirect port change from :${currentPort} to :${targetPort} is unauthorized.`,
        targetUrl,
        isExternal: true,
        isCrossHost,
        isHttpsDowngrade,
        isPortChange: true,
        nextHopCount: currentHop,
      };
    }
  }

  return {
    allowed: true,
    targetUrl,
    isExternal,
    isCrossHost,
    isHttpsDowngrade,
    isPortChange,
    nextHopCount: currentHop + 1,
  };
}
