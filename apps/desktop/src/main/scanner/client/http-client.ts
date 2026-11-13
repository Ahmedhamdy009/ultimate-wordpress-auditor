import http from 'node:http';
import https from 'node:https';
import type stream from 'node:stream';
import type tls from 'node:tls';
import { URL } from 'node:url';
import {
  SCANNER_CLIENT_ERROR_CODES,
  type RedirectHopInfo,
  type SafeHttpClientOptions,
  type SafeHttpClientTestHooks,
  type SafeHttpRequest,
  type SafeHttpResponse,
  type TlsCertificateInfo,
  type TlsConnectionMetadata,
} from './types.js';
import { ScannerClientError } from './errors.js';
import { resolveAndValidateDns } from './dns-resolver.js';
import { createPinnedSocket } from './socket-factory.js';
import { executeSafeResponsePipeline } from './response-pipeline.js';
import { handleResponseRedirect } from './redirect.js';
import { shouldFallbackToGetRange, createHeadFallbackResponse } from './head-fallback.js';

const DEFAULT_OPTIONS: Required<Omit<SafeHttpClientOptions, 'allowedHosts'>> = {
  connectTimeoutMs: 5000,
  responseTimeoutMs: 10000,
  maxHeaderSize: 16384, // 16 KB
  maxEncodedBytes: 2 * 1024 * 1024, // 2 MB
  maxDecompressedBytes: 4 * 1024 * 1024, // 4 MB
  maxCompressionRatio: 10,
  minCompressionRatioBytes: 50 * 1024, // 50 KB
  allowCrossHostExternalRedirects: false,
  allowHttpsDowngrade: false,
  maxHops: 5,
  userAgent: 'WordPressAuditorBot/1.0 (+https://github.com/ultimate-auditor)',
};

function extractTlsMetadata(socket: stream.Duplex | undefined): TlsConnectionMetadata | null {
  if (!socket || !('getPeerCertificate' in socket)) {
    return null;
  }
  const tlsSocket = socket as tls.TLSSocket;
  try {
    const protocol = typeof tlsSocket.getProtocol === 'function' ? tlsSocket.getProtocol() : null;
    const cipher = typeof tlsSocket.getCipher === 'function' ? tlsSocket.getCipher() : null;
    const authorized = tlsSocket.authorized ?? false;
    const authError = tlsSocket.authorizationError ? String(tlsSocket.authorizationError) : null;
    const rawCert =
      typeof tlsSocket.getPeerCertificate === 'function' ? tlsSocket.getPeerCertificate() : null;

    let peerCertificate: TlsCertificateInfo | null = null;
    if (rawCert && Object.keys(rawCert).length > 0) {
      let daysUntilExpiration: number | undefined;
      if (rawCert.valid_to) {
        const expiryMs = new Date(rawCert.valid_to).getTime();
        if (!isNaN(expiryMs)) {
          daysUntilExpiration = Math.round((expiryMs - Date.now()) / (1000 * 60 * 60 * 24));
        }
      }
      peerCertificate = {
        validFrom: rawCert.valid_from ?? '',
        validTo: rawCert.valid_to ?? '',
        subject: (rawCert.subject as unknown as Record<string, string>) ?? {},
        issuer: (rawCert.issuer as unknown as Record<string, string>) ?? {},
        subjectAltName: rawCert.subjectaltname,
        serialNumber: rawCert.serialNumber,
        fingerprint256: rawCert.fingerprint256,
        daysUntilExpiration,
      };
    }

    return {
      protocol,
      cipher: cipher
        ? {
            name: cipher.name,
            version: cipher.version,
            standardName: cipher.standardName,
          }
        : null,
      authorized,
      authorizationError: authError,
      peerCertificate,
    };
  } catch {
    return null;
  }
}

export class SafeHttpClient {
  private readonly defaultOptions: SafeHttpClientOptions;
  private readonly defaultTestHooks?: SafeHttpClientTestHooks;

  constructor(options?: Partial<SafeHttpClientOptions>, testHooks?: SafeHttpClientTestHooks) {
    this.defaultOptions = { ...DEFAULT_OPTIONS, ...options };
    this.defaultTestHooks = testHooks;
  }

  /**
   * Executes a safe, SSRF-protected, socket-pinned HTTP/HTTPS request.
   */
  async request(req: SafeHttpRequest): Promise<SafeHttpResponse> {
    const mergedOptions: SafeHttpClientOptions = {
      ...this.defaultOptions,
      ...req.options,
    };
    const mergedTestHooks: SafeHttpClientTestHooks | undefined =
      req.testHooks || this.defaultTestHooks
        ? { ...this.defaultTestHooks, ...req.testHooks }
        : undefined;

    return this.executeWithRedirects(req, mergedOptions, mergedTestHooks, 1);
  }

  async get(
    url: string,
    options?: Partial<SafeHttpClientOptions> & {
      signal?: AbortSignal;
      headers?: Record<string, string>;
      testHooks?: SafeHttpClientTestHooks;
    } & SafeHttpClientTestHooks,
  ): Promise<SafeHttpResponse> {
    const { signal, headers, testHooks, lookupFn, pinnedIpOverride, ca, ...cleanOptions } =
      options ?? {};
    const effectiveTestHooks: SafeHttpClientTestHooks | undefined =
      testHooks || lookupFn || pinnedIpOverride || ca
        ? { lookupFn, pinnedIpOverride, ca, ...testHooks }
        : undefined;

    return this.request({
      url,
      method: 'GET',
      headers,
      signal,
      options: cleanOptions,
      testHooks: effectiveTestHooks,
    });
  }

  async head(
    url: string,
    options?: Partial<SafeHttpClientOptions> & {
      signal?: AbortSignal;
      headers?: Record<string, string>;
      testHooks?: SafeHttpClientTestHooks;
    } & SafeHttpClientTestHooks,
  ): Promise<SafeHttpResponse> {
    const { signal, headers, testHooks, lookupFn, pinnedIpOverride, ca, ...cleanOptions } =
      options ?? {};
    const effectiveTestHooks: SafeHttpClientTestHooks | undefined =
      testHooks || lookupFn || pinnedIpOverride || ca
        ? { lookupFn, pinnedIpOverride, ca, ...testHooks }
        : undefined;

    return this.request({
      url,
      method: 'HEAD',
      headers,
      signal,
      options: cleanOptions,
      testHooks: effectiveTestHooks,
    });
  }

  private async executeWithRedirects(
    req: SafeHttpRequest,
    options: SafeHttpClientOptions,
    testHooks: SafeHttpClientTestHooks | undefined,
    currentHop: number,
    redirectChain: RedirectHopInfo[] = [],
  ): Promise<SafeHttpResponse> {
    const currentUrl = req.url;
    let urlObj: URL;
    try {
      urlObj = new URL(currentUrl);
    } catch {
      throw new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_DNS_RESOLUTION_FAILED,
        `Invalid request URL: "${currentUrl}".`,
      );
    }

    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      throw new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_REDIRECT_DISALLOWED,
        `Unsupported protocol: "${urlObj.protocol}". Only http: and https: are permitted.`,
      );
    }

    const isHttps = urlObj.protocol === 'https:';
    const port = urlObj.port ? Number(urlObj.port) : isHttps ? 443 : 80;
    const hostname = urlObj.hostname;

    // 1. Resolve and authoritatively validate DNS (rejects any prohibited IP)
    const dnsResult = await resolveAndValidateDns(hostname, {
      signal: req.signal,
      lookupFn: testHooks?.lookupFn,
    });

    const pinnedIp = testHooks?.pinnedIpOverride ?? dnsResult.pinnedIp;

    // 2. Dispatch the single request hop with socket IP pinning
    const responseResult = await this.dispatchSingleHop({
      urlObj,
      hostname,
      pinnedIp,
      port,
      isHttps,
      method: req.method ?? 'GET',
      headers: req.headers,
      signal: req.signal,
      options,
      testHooks,
      currentHop,
    });

    // 3. Handle redirects if indicated
    if (responseResult.redirectUrl) {
      redirectChain.push({
        fromUrl: currentUrl,
        toUrl: responseResult.redirectUrl,
        statusCode: responseResult.statusCode ?? 302,
        location: responseResult.location ?? responseResult.redirectUrl,
        headers: responseResult.headers,
      });

      const nextHop = responseResult.nextHopCount ?? currentHop + 1;
      try {
        return await this.executeWithRedirects(
          {
            ...req,
            url: responseResult.redirectUrl,
          },
          options,
          testHooks,
          nextHop,
          redirectChain,
        );
      } catch (err: unknown) {
        if (redirectChain.length > 0) {
          if (err instanceof ScannerClientError) {
            const currentDetails =
              err.details && typeof err.details === 'object'
                ? { ...err.details }
                : ({} as Record<string, unknown>);
            currentDetails.redirectChain = Object.freeze([...redirectChain]);
            (err as { details?: Record<string, unknown> }).details = currentDetails;
          } else if (err && typeof err === 'object') {
            (err as { redirectChain?: readonly RedirectHopInfo[] }).redirectChain = Object.freeze([
              ...redirectChain,
            ]);
          }
        }
        throw err;
      }
    }

    const finalResponse = responseResult.response!;
    if (redirectChain.length > 0) {
      return {
        ...finalResponse,
        redirectChain: Object.freeze([...redirectChain]),
      };
    }

    return finalResponse;
  }

  private async dispatchSingleHop(args: {
    readonly urlObj: URL;
    readonly hostname: string;
    readonly pinnedIp: string;
    readonly port: number;
    readonly isHttps: boolean;
    readonly method: string;
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
    readonly options: SafeHttpClientOptions;
    readonly testHooks?: SafeHttpClientTestHooks;
    readonly currentHop: number;
  }): Promise<{
    redirectUrl?: string;
    nextHopCount?: number;
    statusCode?: number;
    location?: string;
    headers?: http.IncomingHttpHeaders;
    response?: SafeHttpResponse;
  }> {
    const {
      urlObj,
      hostname,
      pinnedIp,
      port,
      isHttps,
      method,
      headers,
      signal,
      options,
      testHooks,
      currentHop,
    } = args;

    if (signal?.aborted) {
      throw new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        'Request aborted by caller signal.',
      );
    }

    const requestModule = isHttps ? https : http;
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_OPTIONS.connectTimeoutMs;
    const responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_OPTIONS.responseTimeoutMs;
    const maxHeaderSize = options.maxHeaderSize ?? DEFAULT_OPTIONS.maxHeaderSize;

    return new Promise((resolve, reject) => {
      let responseTimer: NodeJS.Timeout | null = null;
      let activeRequest: http.ClientRequest | null = null;
      let isSettled = false;

      const cleanup = (): void => {
        if (responseTimer) {
          clearTimeout(responseTimer);
          responseTimer = null;
        }
      };

      const settleError = (err: Error): void => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        if (activeRequest) {
          activeRequest.destroy();
        }
        reject(err);
      };

      const settleSuccess = (val: {
        redirectUrl?: string;
        nextHopCount?: number;
        statusCode?: number;
        location?: string;
        headers?: http.IncomingHttpHeaders;
        response?: SafeHttpResponse;
      }): void => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve(val);
      };

      // Response timeout timer
      if (responseTimeoutMs > 0) {
        responseTimer = setTimeout(() => {
          settleError(
            new ScannerClientError(
              SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_TIMEOUT,
              `HTTP response timed out after ${responseTimeoutMs}ms for ${urlObj.toString()}.`,
              { url: urlObj.toString(), responseTimeoutMs },
            ),
          );
        }, responseTimeoutMs);
      }

      const onAbort = (): void => {
        settleError(
          new ScannerClientError(
            SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
            'Request aborted by caller signal.',
          ),
        );
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      // Custom createConnection function pinning TCP connection to pinnedIp
      const createConnection: http.ClientRequestArgs['createConnection'] = (_opts, cb) => {
        createPinnedSocket(
          {
            hostname,
            pinnedIp,
            port,
            isHttps,
            connectTimeoutMs,
            signal,
            ca: testHooks?.ca,
          },
          (err, socket) => {
            if (err) {
              cb(err, null as unknown as stream.Duplex);
            } else if (socket) {
              cb(null, socket);
            }
          },
        );
        return undefined;
      };

      const requestHeaders: Record<string, string> = {
        Host: urlObj.host,
        'User-Agent': options.userAgent ?? DEFAULT_OPTIONS.userAgent,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'close',
        ...headers,
      };

      const reqOptions: http.RequestOptions = {
        method,
        host: pinnedIp,
        port,
        path: `${urlObj.pathname}${urlObj.search}`,
        headers: requestHeaders,
        createConnection,
        maxHeaderSize,
      };

      const req = requestModule.request(reqOptions, async (res: http.IncomingMessage) => {
        try {
          // Check for redirect (3xx)
          const redirectEval = handleResponseRedirect(urlObj.toString(), res, {
            ...options,
            hopCount: currentHop,
          });

          if (redirectEval.shouldRedirect && redirectEval.targetUrl) {
            const locHeader =
              typeof res.headers['location'] === 'string'
                ? res.headers['location']
                : redirectEval.targetUrl;
            const statusCode = res.statusCode ?? 302;
            const resHeaders = res.headers;
            res.destroy(); // Destroy redirect stream immediately without reading body
            settleSuccess({
              redirectUrl: redirectEval.targetUrl,
              nextHopCount: redirectEval.nextHopCount,
              statusCode,
              location: locHeader,
              headers: resHeaders,
            });
            return;
          }

          // Handle HEAD requests and HEAD fallback
          if (method === 'HEAD') {
            const statusCode = res.statusCode ?? 0;
            if (shouldFallbackToGetRange(statusCode)) {
              res.destroy();
              // Perform fallback GET with Range: bytes=0-1024
              try {
                const fallbackResponse = await this.dispatchHeadFallback({
                  urlObj,
                  hostname,
                  pinnedIp,
                  port,
                  isHttps,
                  headers,
                  signal,
                  options,
                  testHooks,
                  currentHop,
                });
                settleSuccess({ response: fallbackResponse });
              } catch (fallbackErr) {
                settleError(fallbackErr as Error);
              }
              return;
            }

            // Normal HEAD response (no body)
            res.destroy();
            const emptyBuffer = new ArrayBuffer(0);
            settleSuccess({
              response: {
                statusCode,
                statusMessage: res.statusMessage ?? '',
                headers: res.headers,
                resolvedIp: pinnedIp,
                finalUrl: urlObj.toString(),
                redirectHops: currentHop - 1,
                encodedBodyBytes: 0,
                decompressedBodyBytes: 0,
                body: emptyBuffer,
                tls: extractTlsMetadata(res.socket),
                text: () => '',
              },
            });
            return;
          }

          // Process GET response stream pipeline
          const processed = await executeSafeResponsePipeline(res, {
            maxEncodedBytes: options.maxEncodedBytes,
            maxDecompressedBytes: options.maxDecompressedBytes,
            maxCompressionRatio: options.maxCompressionRatio,
            minCompressionRatioBytes: options.minCompressionRatioBytes,
            signal,
          });

          settleSuccess({
            response: {
              statusCode: res.statusCode ?? 0,
              statusMessage: res.statusMessage ?? '',
              headers: res.headers,
              resolvedIp: pinnedIp,
              finalUrl: urlObj.toString(),
              redirectHops: currentHop - 1,
              encodedBodyBytes: processed.encodedBodyBytes,
              decompressedBodyBytes: processed.decompressedBodyBytes,
              body: processed.body,
              tls: extractTlsMetadata(res.socket),
              text: () => Buffer.from(processed.body).toString('utf-8'),
            },
          });
        } catch (pipelineErr) {
          settleError(pipelineErr as Error);
        }
      });

      activeRequest = req;

      req.on('error', (err: NodeJS.ErrnoException) => {
        if (signal?.aborted) {
          settleError(
            new ScannerClientError(
              SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
              'Request aborted by caller signal.',
            ),
          );
          return;
        }

        if (err.code === 'HPE_HEADER_OVERFLOW') {
          settleError(
            new ScannerClientError(
              SCANNER_CLIENT_ERROR_CODES.ERR_HEADER_OVERFLOW,
              `HTTP response header exceeded maximum size limit of ${maxHeaderSize} bytes.`,
              { maxHeaderSize, code: err.code },
            ),
          );
          return;
        }

        if (err instanceof ScannerClientError) {
          settleError(err);
          return;
        }

        settleError(err);
      });

      req.end();
    });
  }

  private async dispatchHeadFallback(args: {
    readonly urlObj: URL;
    readonly hostname: string;
    readonly pinnedIp: string;
    readonly port: number;
    readonly isHttps: boolean;
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
    readonly options: SafeHttpClientOptions;
    readonly testHooks?: SafeHttpClientTestHooks;
    readonly currentHop: number;
  }): Promise<SafeHttpResponse> {
    const {
      urlObj,
      hostname,
      pinnedIp,
      port,
      isHttps,
      headers,
      signal,
      options,
      testHooks,
      currentHop,
    } = args;

    const requestModule = isHttps ? https : http;
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_OPTIONS.connectTimeoutMs;
    const responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_OPTIONS.responseTimeoutMs;
    const maxHeaderSize = options.maxHeaderSize ?? DEFAULT_OPTIONS.maxHeaderSize;

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      let isSettled = false;
      let activeReq: http.ClientRequest | null = null;

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const finishError = (err: Error): void => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        if (activeReq) activeReq.destroy();
        reject(err);
      };

      const finishSuccess = (res: SafeHttpResponse): void => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve(res);
      };

      if (responseTimeoutMs > 0) {
        timer = setTimeout(() => {
          finishError(
            new ScannerClientError(
              SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_TIMEOUT,
              `HEAD fallback response timed out after ${responseTimeoutMs}ms for ${urlObj.toString()}.`,
              { url: urlObj.toString(), responseTimeoutMs },
            ),
          );
        }, responseTimeoutMs);
      }

      const onAbort = (): void => {
        finishError(
          new ScannerClientError(
            SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
            'HEAD fallback aborted by caller signal.',
          ),
        );
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const createConnection: http.ClientRequestArgs['createConnection'] = (_opts, cb) => {
        createPinnedSocket(
          {
            hostname,
            pinnedIp,
            port,
            isHttps,
            connectTimeoutMs,
            signal,
            ca: testHooks?.ca,
          },
          (err, socket) => {
            if (err) {
              cb(err, null as unknown as stream.Duplex);
            } else if (socket) {
              cb(null, socket);
            }
          },
        );
        return undefined;
      };

      const fallbackHeaders: Record<string, string> = {
        Host: urlObj.host,
        'User-Agent': options.userAgent ?? DEFAULT_OPTIONS.userAgent,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        Range: 'bytes=0-1024',
        Connection: 'close',
        ...headers,
      };

      const req = requestModule.request(
        {
          method: 'GET',
          host: pinnedIp,
          port,
          path: `${urlObj.pathname}${urlObj.search}`,
          headers: fallbackHeaders,
          createConnection,
          maxHeaderSize,
        },
        (res: http.IncomingMessage) => {
          // Immediately capture status and headers, and destroy response stream without buffering body!
          const statusCode = res.statusCode ?? 0;
          const statusMessage = res.statusMessage ?? '';
          const resHeaders = res.headers;
          res.destroy();
          req.destroy();

          finishSuccess(
            createHeadFallbackResponse(
              statusCode,
              statusMessage,
              resHeaders,
              pinnedIp,
              urlObj.toString(),
              currentHop - 1,
              extractTlsMetadata(res.socket),
            ),
          );
        },
      );

      activeReq = req;

      req.on('error', (err: Error) => {
        if (signal?.aborted) {
          finishError(
            new ScannerClientError(
              SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
              'HEAD fallback aborted by caller signal.',
            ),
          );
          return;
        }
        finishError(err);
      });

      req.end();
    });
  }
}
