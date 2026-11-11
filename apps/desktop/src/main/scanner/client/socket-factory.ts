import type stream from 'node:stream';
import net from 'node:net';
import tls from 'node:tls';
import { SCANNER_CLIENT_ERROR_CODES } from './types.js';
import { ScannerClientError } from './errors.js';

export interface PinnedConnectionOptions {
  readonly hostname: string;
  readonly pinnedIp: string;
  readonly port: number;
  readonly isHttps: boolean;
  readonly connectTimeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly rejectUnauthorized?: boolean;
  readonly ca?: string | Buffer | Array<string | Buffer>;
}

/**
 * Creates an outbound TCP socket or TLSSocket connected directly to a pinned IP address.
 * Enforces:
 * - Direct TCP connection to pinnedIp (bypassing runtime OS DNS re-resolution).
 * - For HTTPS: TLS SNI servername is set to the original hostname.
 * - TLS certificate validation strictly checks against original hostname (rejects invalid/mismatched certs).
 * - Connection timeout enforcement.
 * - Caller AbortSignal cancellation.
 */
export function createPinnedSocket(
  options: PinnedConnectionOptions,
  callback: (err: Error | null, socket?: stream.Duplex) => void,
): void {
  const { hostname, pinnedIp, port, isHttps, connectTimeoutMs = 5000, signal, ca } = options;
  const rejectUnauthorized = options.rejectUnauthorized !== false;

  if (signal?.aborted) {
    callback(
      new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        'Connection creation aborted by caller signal.',
      ),
    );
    return;
  }

  let timer: NodeJS.Timeout | null = null;
  let finished = false;

  const cleanup = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const finish = (err: Error | null, sock?: net.Socket | tls.TLSSocket): void => {
    if (finished) return;
    finished = true;
    cleanup();
    callback(err, sock);
  };

  // Connect TCP socket directly to pinnedIp
  const rawSocket = net.createConnection({
    host: pinnedIp,
    port,
  });

  rawSocket.setNoDelay(true);

  if (connectTimeoutMs > 0) {
    timer = setTimeout(() => {
      rawSocket.destroy();
      finish(
        new ScannerClientError(
          SCANNER_CLIENT_ERROR_CODES.ERR_CONNECTION_TIMEOUT,
          `Connection to ${pinnedIp}:${port} (${hostname}) timed out after ${connectTimeoutMs}ms.`,
          { hostname, pinnedIp, port, connectTimeoutMs },
        ),
      );
    }, connectTimeoutMs);
  }

  const onAbort = (): void => {
    rawSocket.destroy();
    finish(
      new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        'Connection aborted by caller signal.',
      ),
    );
  };

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  rawSocket.once('error', (err: NodeJS.ErrnoException) => {
    rawSocket.destroy();
    if (signal) signal.removeEventListener('abort', onAbort);

    if (err.code === 'ECONNREFUSED') {
      finish(
        new ScannerClientError(
          SCANNER_CLIENT_ERROR_CODES.ERR_CONNECTION_REFUSED,
          `Connection refused by ${pinnedIp}:${port} (${hostname}).`,
          { hostname, pinnedIp, port, code: err.code },
        ),
      );
    } else if (err.code === 'ETIMEDOUT') {
      finish(
        new ScannerClientError(
          SCANNER_CLIENT_ERROR_CODES.ERR_CONNECTION_TIMEOUT,
          `Connection to ${pinnedIp}:${port} timed out.`,
          { hostname, pinnedIp, port, code: err.code },
        ),
      );
    } else {
      finish(
        new ScannerClientError(
          SCANNER_CLIENT_ERROR_CODES.ERR_CONNECTION_REFUSED,
          `Network connection failed to ${pinnedIp}:${port} (${hostname}): ${err.message}`,
          { hostname, pinnedIp, port, code: err.code },
        ),
      );
    }
  });

  if (!isHttps) {
    rawSocket.once('connect', () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      finish(null, rawSocket);
    });
  } else {
    rawSocket.once('connect', () => {
      const cleanHost = hostname.replace(/^\[|\]$/g, '');
      const isIpLiteral = net.isIP(cleanHost) !== 0;

      const tlsSocket = tls.connect({
        socket: rawSocket,
        // RFC 6066: Literal IPv4/IPv6 addresses are forbidden in TLS SNI extension
        servername: isIpLiteral ? undefined : hostname,
        rejectUnauthorized,
        ca: Array.isArray(ca) ? [...ca] : ca,
        checkServerIdentity: (_certHost, cert) => {
          if (!rejectUnauthorized) {
            return undefined;
          }
          // Verify certificate against original DNS hostname or IP literal
          return tls.checkServerIdentity(cleanHost, cert);
        },
      });

      tlsSocket.once('secureConnect', () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        finish(null, tlsSocket);
      });

      tlsSocket.once('error', (tlsErr: NodeJS.ErrnoException) => {
        tlsSocket.destroy();
        if (signal) signal.removeEventListener('abort', onAbort);

        finish(
          new ScannerClientError(
            SCANNER_CLIENT_ERROR_CODES.ERR_TLS_CERT_INVALID,
            `TLS handshake / certificate validation failed for ${hostname} at ${pinnedIp}:${port}: ${tlsErr.message}`,
            { hostname, pinnedIp, port, code: tlsErr.code },
          ),
        );
      });
    });
  }
}
