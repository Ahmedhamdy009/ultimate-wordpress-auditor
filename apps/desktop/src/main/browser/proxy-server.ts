import http from 'node:http';
import net from 'node:net';
import { isIpAllowedForScan } from '@auditor/shared';
import { resolveAndValidateDns } from '../scanner/client/dns-resolver.js';
import {
  BROWSER_ERROR_CODES,
  type BrowserProxyOptions,
  type BrowserProxyStats,
  type BrowserProxyTestHooks,
  type BrowserScopePolicy,
} from './types.js';
import { BrowserError } from './errors.js';

export class BrowserProxyServer {
  private readonly options: Required<Omit<BrowserProxyOptions, 'scopePolicy' | 'testHooks'>>;
  private readonly testHooks?: BrowserProxyTestHooks;
  private scopePolicy?: BrowserScopePolicy;

  private server: http.Server | null = null;
  private actualPort = 0;
  private readonly openSockets = new Set<net.Socket>();

  private requestsTotal = 0;
  private requestsAllowed = 0;
  private requestsBlocked = 0;
  private connectTunnelsEstablished = 0;
  private connectTunnelsBlocked = 0;

  constructor(options: BrowserProxyOptions = {}) {
    this.options = {
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 0,
      connectTimeoutMs: options.connectTimeoutMs ?? 5000,
    };
    this.scopePolicy = options.scopePolicy;
    this.testHooks = options.testHooks;
  }

  public updateScopePolicy(policy: BrowserScopePolicy): void {
    this.scopePolicy = policy;
  }

  public getProxyUrl(): string {
    if (!this.server || this.actualPort === 0) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_PROXY_START_FAILED,
        'BrowserProxyServer has not been started yet.',
      );
    }
    return `http://${this.options.host}:${this.actualPort}`;
  }

  public getPort(): number {
    return this.actualPort;
  }

  public getStats(): BrowserProxyStats {
    return {
      requestsTotal: this.requestsTotal,
      requestsAllowed: this.requestsAllowed,
      requestsBlocked: this.requestsBlocked,
      connectTunnelsEstablished: this.connectTunnelsEstablished,
      connectTunnelsBlocked: this.connectTunnelsBlocked,
      activeSockets: this.openSockets.size,
    };
  }

  /**
   * Starts the local proxy server and begins intercepting traffic.
   */
  public async start(): Promise<string> {
    if (this.server) {
      return this.getProxyUrl();
    }

    const server = http.createServer((req, res) => this.handleHttpRequest(req, res));
    this.server = server;

    server.on('connect', (req, clientSocket, head) =>
      this.handleConnectTunnel(req, clientSocket as net.Socket, head),
    );

    server.on('upgrade', (req, clientSocket) =>
      this.handleUpgradeRequest(req, clientSocket as net.Socket),
    );

    server.on('connection', socket => {
      this.openSockets.add(socket);
      socket.once('close', () => this.openSockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => {
        server.removeListener('error', reject);
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          this.actualPort = addr.port;
          resolve();
        } else {
          reject(new Error('Failed to retrieve bound port for BrowserProxyServer'));
        }
      });
    });

    return this.getProxyUrl();
  }

  /**
   * Shuts down the proxy server and forcefully closes all active sockets.
   */
  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const s = this.server;
    this.server = null;
    this.actualPort = 0;

    for (const socket of this.openSockets) {
      try {
        socket.destroy();
      } catch {
        // Ignore destroy error
      }
    }
    this.openSockets.clear();

    await new Promise<void>(resolve => {
      s.close(() => resolve());
    });
  }

  /**
   * Handles HTTPS CONNECT tunnels.
   * Enforces destination validation, DNS resolution, IP pinning, and establishes direct TCP tunnel.
   */
  private async handleConnectTunnel(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): Promise<void> {
    this.requestsTotal++;
    this.openSockets.add(clientSocket);
    clientSocket.once('close', () => this.openSockets.delete(clientSocket));

    const authority = req.url ?? '';
    const colonIndex = authority.lastIndexOf(':');
    const hostname = colonIndex !== -1 ? authority.slice(0, colonIndex) : authority;
    const port = colonIndex !== -1 ? parseInt(authority.slice(colonIndex + 1), 10) : 443;

    // 1. Scope and origin policy check
    if (!this.isDestinationAllowed(hostname, port, 'https')) {
      this.connectTunnelsBlocked++;
      this.requestsBlocked++;
      this.sendSocketResponse(
        clientSocket,
        403,
        'Forbidden',
        'Blocked by SSRF Scope Policy (Origin Not Allowed)',
      );
      return;
    }

    // 2. DNS resolution and SSRF IP validation
    let pinnedIp: string;
    try {
      if (
        this.testHooks?.allowLoopbackInTests &&
        (hostname === '127.0.0.1' || hostname === 'localhost')
      ) {
        pinnedIp = '127.0.0.1';
      } else {
        const dnsResult = await resolveAndValidateDns(hostname, {
          lookupFn: this.testHooks?.lookupFn,
        });
        pinnedIp = this.testHooks?.pinnedIpOverride ?? dnsResult.pinnedIp;
      }
    } catch {
      this.connectTunnelsBlocked++;
      this.requestsBlocked++;
      this.sendSocketResponse(
        clientSocket,
        403,
        'Forbidden',
        'Prohibited Destination Address (SSRF Blocked)',
      );
      return;
    }

    // 3. Establish direct TCP connection to pinned IP
    let remoteSocket: net.Socket;
    try {
      remoteSocket = net.createConnection({
        host: pinnedIp,
        port,
      });
      remoteSocket.setNoDelay(true);
      this.openSockets.add(remoteSocket);
      remoteSocket.once('close', () => this.openSockets.delete(remoteSocket));
    } catch {
      this.connectTunnelsBlocked++;
      this.requestsBlocked++;
      this.sendSocketResponse(clientSocket, 502, 'Bad Gateway', 'Connection Creation Failed');
      return;
    }

    let timeoutTimer: NodeJS.Timeout | null = null;
    if (this.options.connectTimeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        remoteSocket.destroy();
        this.sendSocketResponse(clientSocket, 504, 'Gateway Timeout', 'Connection Timeout');
      }, this.options.connectTimeoutMs);
    }

    remoteSocket.once('connect', () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      this.connectTunnelsEstablished++;
      this.requestsAllowed++;

      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length > 0) {
        remoteSocket.write(head);
      }

      clientSocket.pipe(remoteSocket);
      remoteSocket.pipe(clientSocket);
    });

    remoteSocket.once('error', () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      this.connectTunnelsBlocked++;
      this.requestsBlocked++;
      this.sendSocketResponse(clientSocket, 502, 'Bad Gateway', 'Remote Connection Error');
    });

    clientSocket.once('error', () => {
      remoteSocket.destroy();
    });
  }

  /**
   * Handles plain HTTP requests forwarded through the proxy.
   */
  private async handleHttpRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): Promise<void> {
    this.requestsTotal++;

    let targetUrl: URL;
    try {
      const rawUrl = clientReq.url ?? '/';
      targetUrl =
        rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
          ? new URL(rawUrl)
          : new URL(rawUrl, `http://${clientReq.headers.host ?? 'localhost'}`);
    } catch {
      this.requestsBlocked++;
      clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
      clientRes.end('Bad Request (Malformed URL)');
      return;
    }

    const scheme = targetUrl.protocol.replace(':', '');
    if (scheme !== 'http') {
      this.requestsBlocked++;
      clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
      clientRes.end(`Unsupported Proxy Scheme: ${scheme}`);
      return;
    }

    const hostname = targetUrl.hostname;
    const port = targetUrl.port ? parseInt(targetUrl.port, 10) : 80;

    // 1. Scope check
    if (!this.isDestinationAllowed(hostname, port, 'http')) {
      this.requestsBlocked++;
      clientRes.writeHead(403, { 'Content-Type': 'text/plain' });
      clientRes.end('Blocked by SSRF Scope Policy (Origin Not Allowed)');
      return;
    }

    // 2. DNS validation & socket IP pinning
    let pinnedIp: string;
    try {
      if (
        this.testHooks?.allowLoopbackInTests &&
        (hostname === '127.0.0.1' || hostname === 'localhost')
      ) {
        pinnedIp = '127.0.0.1';
      } else {
        const dnsResult = await resolveAndValidateDns(hostname, {
          lookupFn: this.testHooks?.lookupFn,
        });
        pinnedIp = this.testHooks?.pinnedIpOverride ?? dnsResult.pinnedIp;
      }
    } catch {
      this.requestsBlocked++;
      clientRes.writeHead(403, { 'Content-Type': 'text/plain' });
      clientRes.end('Prohibited Destination Address (SSRF Blocked)');
      return;
    }

    // 3. Forward request directly to pinned IP
    this.requestsAllowed++;

    const forwardHeaders = { ...clientReq.headers };
    forwardHeaders.host = targetUrl.host;

    const proxyReq = http.request(
      {
        host: pinnedIp,
        port,
        method: clientReq.method,
        path: targetUrl.pathname + targetUrl.search,
        headers: forwardHeaders,
        createConnection: () =>
          net.createConnection({
            host: pinnedIp,
            port,
          }),
        timeout: this.options.connectTimeoutMs,
      },
      proxyRes => {
        clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(clientRes);
      },
    );

    proxyReq.on('error', () => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
        clientRes.end('Proxy Forwarding Error');
      }
    });

    clientReq.pipe(proxyReq);
  }

  /**
   * Handles WebSocket upgrade requests.
   */
  private handleUpgradeRequest(req: http.IncomingMessage, clientSocket: net.Socket): void {
    this.requestsTotal++;
    const allowWebSockets = this.scopePolicy?.allowWebSockets === true;

    if (!allowWebSockets) {
      this.requestsBlocked++;
      this.sendSocketResponse(
        clientSocket,
        403,
        'Forbidden',
        'WebSockets are blocked by default security policy',
      );
      return;
    }

    // If allowed, validate scope
    const hostHeader = req.headers.host || '';
    const colonIdx = hostHeader.indexOf(':');
    const hostname = colonIdx !== -1 ? hostHeader.slice(0, colonIdx) : hostHeader;
    const port = colonIdx !== -1 ? parseInt(hostHeader.slice(colonIdx + 1), 10) : 80;

    if (!this.isDestinationAllowed(hostname, port, 'ws')) {
      this.requestsBlocked++;
      this.sendSocketResponse(clientSocket, 403, 'Forbidden', 'WebSocket Target Not Allowed');
      return;
    }

    this.requestsBlocked++;
    this.sendSocketResponse(clientSocket, 501, 'Not Implemented', 'WebSocket Tunnel Not Supported');
  }

  /**
   * Helper to write raw HTTP status response to a socket and close it.
   */
  private sendSocketResponse(
    socket: net.Socket,
    statusCode: number,
    statusText: string,
    message: string,
  ): void {
    if (socket.writable) {
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
          `Content-Type: text/plain\r\n` +
          `Content-Length: ${Buffer.byteLength(message)}\r\n` +
          `Connection: close\r\n\r\n` +
          `${message}`,
      );
    }
    socket.destroy();
  }

  /**
   * Evaluates whether a destination hostname and port are permitted according to scope policy.
   */
  private isDestinationAllowed(hostname: string, _port: number, _scheme: string): boolean {
    const cleanHost = hostname.trim().toLowerCase();

    // 1. IP range check (blocks loopback, private, metadata, link-local)
    if (!this.testHooks?.allowLoopbackInTests) {
      if (cleanHost === 'localhost' || cleanHost.endsWith('.localhost')) {
        return false;
      }
      const isIpLiteral = net.isIP(cleanHost) !== 0;
      if (isIpLiteral) {
        const ipCheck = isIpAllowedForScan(cleanHost);
        if (!ipCheck.allowed) {
          return false;
        }
      }
    }

    // 2. If no scope policy configured, default to allowing public destinations
    if (!this.scopePolicy) {
      return true;
    }

    let authHost: string;
    try {
      const parsedAuth = new URL(this.scopePolicy.authorizedOrigin);
      authHost = parsedAuth.hostname.toLowerCase();
    } catch {
      authHost = this.scopePolicy.authorizedOrigin.toLowerCase();
    }

    // Exact authorized host or subdomain
    if (cleanHost === authHost || cleanHost.endsWith(`.${authHost}`)) {
      return true;
    }

    // Explicit additional allowed domains
    if (this.scopePolicy.allowedAdditionalDomains) {
      for (const domain of this.scopePolicy.allowedAdditionalDomains) {
        const cleanDomain = domain.trim().toLowerCase();
        if (cleanHost === cleanDomain || cleanHost.endsWith(`.${cleanDomain}`)) {
          return true;
        }
      }
    }

    // Third-party policy evaluation
    const thirdPartyPolicy = this.scopePolicy.thirdPartyPolicy ?? 'ALLOW_PUBLIC_SUBRESOURCES';
    if (thirdPartyPolicy === 'SAME_ORIGIN_ONLY') {
      return false;
    }

    if (thirdPartyPolicy === 'ALLOW_PUBLIC_SUBRESOURCES') {
      // In ALLOW_PUBLIC_SUBRESOURCES mode, external destinations are permitted
      // ONLY IF they are public (checked by DNS resolution step).
      return true;
    }

    return false;
  }
}
