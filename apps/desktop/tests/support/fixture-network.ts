import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

export interface DnsLookupEntry {
  readonly address: string;
  readonly family: number;
}

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<DnsLookupEntry[]>;

export interface LocalFixtureNetworkOptions {
  /**
   * Custom DNS lookup behavior for test hostnames.
   * Defaults to resolving any hostname to `[{ address: '93.184.216.34', family: 4 }]`.
   */
  readonly lookupFn?: DnsLookupFn;

  /**
   * Maps synthetic public IP addresses returned by mock DNS (or used in IP-literal tests)
   * to the local loopback server IP (typically '127.0.0.1').
   * Defaults to `{ '93.184.216.34': '127.0.0.1' }`.
   */
  readonly pinnedRoutes?: Readonly<Record<string, string>>;

  /**
   * Optional trusted CA certificate(s) injected into `tls.connect` calls during TLS fixture tests.
   * Keeps `rejectUnauthorized: true` and `checkServerIdentity` strictly enforced.
   */
  readonly ca?: string | Buffer | Array<string | Buffer>;
}

export interface LocalFixtureNetworkHandle {
  restore(): void;
}

const DEFAULT_PUBLIC_IP = '93.184.216.34';

/**
 * Installs isolated test-only network shims on `node:dns`, `node:net`, and optionally `node:tls`
 * so production scanner and browser proxy classes can be verified against local 127.0.0.1
 * fixture servers without introducing any test hooks or SSRF bypasses into production code.
 */
export function installLocalFixtureNetwork(
  options: LocalFixtureNetworkOptions = {},
): LocalFixtureNetworkHandle {
  const lookupFn: DnsLookupFn =
    options.lookupFn ?? (async () => [{ address: DEFAULT_PUBLIC_IP, family: 4 }]);
  const pinnedRoutes: Readonly<Record<string, string>> = options.pinnedRoutes ?? {
    [DEFAULT_PUBLIC_IP]: '127.0.0.1',
  };

  const previousLookup = dns.promises.lookup;
  const previousCreateConnection = net.createConnection;
  const previousTlsConnect = tls.connect;

  dns.promises.lookup = ((hostname: string, lookupOptions?: unknown) => {
    if (
      typeof lookupOptions === 'object' &&
      lookupOptions !== null &&
      'all' in lookupOptions &&
      (lookupOptions as { all?: boolean }).all === true
    ) {
      return lookupFn(hostname, { all: true, verbatim: true }) as ReturnType<
        typeof dns.promises.lookup
      >;
    }
    return previousLookup.call(dns.promises, hostname, lookupOptions as never);
  }) as typeof dns.promises.lookup;

  net.createConnection = ((...args: unknown[]) => {
    const firstArg = args[0];
    if (
      typeof firstArg === 'object' &&
      firstArg !== null &&
      'host' in firstArg &&
      typeof (firstArg as net.NetConnectOpts & { host?: unknown }).host === 'string'
    ) {
      const connectOpts = firstArg as net.TcpNetConnectOpts;
      const mappedHost = connectOpts.host ? pinnedRoutes[connectOpts.host] : undefined;
      if (mappedHost) {
        const rewrittenOpts: net.TcpNetConnectOpts = {
          ...connectOpts,
          host: mappedHost,
        };
        return (previousCreateConnection as (...a: unknown[]) => net.Socket).call(
          net,
          rewrittenOpts,
          ...args.slice(1),
        );
      }
    }
    return (previousCreateConnection as (...a: unknown[]) => net.Socket).apply(net, args);
  }) as typeof net.createConnection;

  let installedTls = false;
  if (options.ca !== undefined) {
    const testCa = Array.isArray(options.ca) ? [...options.ca] : options.ca;
    installedTls = true;
    tls.connect = ((...args: unknown[]) => {
      const firstArg = args[0];
      if (typeof firstArg === 'object' && firstArg !== null) {
        const tlsOpts = firstArg as tls.ConnectionOptions;
        const rewrittenOpts: tls.ConnectionOptions = {
          ...tlsOpts,
          ca: tlsOpts.ca ?? testCa,
        };
        return (previousTlsConnect as (...a: unknown[]) => tls.TLSSocket).call(
          tls,
          rewrittenOpts,
          ...args.slice(1),
        );
      }
      return (previousTlsConnect as (...a: unknown[]) => tls.TLSSocket).apply(tls, args);
    }) as typeof tls.connect;
  }

  let restored = false;
  return {
    restore(): void {
      if (restored) return;
      restored = true;
      if (installedTls) {
        tls.connect = previousTlsConnect;
      }
      net.createConnection = previousCreateConnection;
      dns.promises.lookup = previousLookup;
    },
  };
}

/**
 * Installs a deterministic test-only mock for `dns.promises.lookup` without altering socket routing.
 */
export function mockDnsLookup(lookupFn: DnsLookupFn): LocalFixtureNetworkHandle {
  const previousLookup = dns.promises.lookup;
  dns.promises.lookup = ((hostname: string, lookupOptions?: unknown) => {
    if (
      typeof lookupOptions === 'object' &&
      lookupOptions !== null &&
      'all' in lookupOptions &&
      (lookupOptions as { all?: boolean }).all === true
    ) {
      return lookupFn(hostname, { all: true, verbatim: true }) as ReturnType<
        typeof dns.promises.lookup
      >;
    }
    return previousLookup.call(dns.promises, hostname, lookupOptions as never);
  }) as typeof dns.promises.lookup;

  let restored = false;
  return {
    restore(): void {
      if (restored) return;
      restored = true;
      dns.promises.lookup = previousLookup;
    },
  };
}
