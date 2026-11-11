import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { createPinnedSocket } from '../../../src/main/scanner/client/socket-factory.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../../../src/main/scanner/client/types.js';
import { ScannerClientError } from '../../../src/main/scanner/client/errors.js';

describe('Pinned Socket Factory', () => {
  let server: net.Server;
  let serverPort: number;

  beforeAll(async () => {
    server = net.createServer(socket => {
      socket.on('data', data => {
        socket.write(data); // echo
      });
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  it('establishes direct TCP connection to pinned IP', async () => {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      createPinnedSocket(
        {
          hostname: 'example.internal',
          pinnedIp: '127.0.0.1',
          port: serverPort,
          isHttps: false,
          connectTimeoutMs: 2000,
        },
        (err, sock) => {
          if (err) reject(err);
          else resolve(sock as net.Socket);
        },
      );
    });

    expect(socket).toBeDefined();
    expect(socket.destroyed).toBe(false);

    // Verify data transmission
    const echoReceived = await new Promise<string>(resolve => {
      socket.once('data', chunk => {
        resolve(chunk.toString());
      });
      socket.write('hello-pinned-socket');
    });

    expect(echoReceived).toBe('hello-pinned-socket');
    socket.destroy();
  });

  it('returns ERR_CONNECTION_REFUSED when connecting to a closed port', async () => {
    // Find an unused port
    const closedPort = 59981;

    const err = await new Promise<Error>(resolve => {
      createPinnedSocket(
        {
          hostname: 'example.internal',
          pinnedIp: '127.0.0.1',
          port: closedPort,
          isHttps: false,
          connectTimeoutMs: 1000,
        },
        error => {
          resolve(error as Error);
        },
      );
    });

    expect(err).toBeInstanceOf(ScannerClientError);
    expect((err as ScannerClientError).code).toBe(
      SCANNER_CLIENT_ERROR_CODES.ERR_CONNECTION_REFUSED,
    );
  });

  it('returns ERR_REQUEST_ABORTED when signal is aborted before connect', async () => {
    const controller = new AbortController();
    controller.abort();

    const err = await new Promise<Error>(resolve => {
      createPinnedSocket(
        {
          hostname: 'example.internal',
          pinnedIp: '127.0.0.1',
          port: serverPort,
          isHttps: false,
          signal: controller.signal,
        },
        error => {
          resolve(error as Error);
        },
      );
    });

    expect(err).toBeInstanceOf(ScannerClientError);
    expect((err as ScannerClientError).code).toBe(SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED);
  });

  describe('TLS SNI and Certificate Verification (RFC 6066)', () => {
    it('omits TLS SNI servername when target hostname is an IPv4 literal', async () => {
      let capturedOptions: tls.ConnectionOptions | null = null;

      const tlsSpy = vi
        .spyOn(tls, 'connect')
        .mockImplementation((options: tls.ConnectionOptions) => {
          capturedOptions = options;
          options.socket?.destroy();
          const fakeTlsSocket = new net.Socket() as unknown as tls.TLSSocket;
          setTimeout(() => fakeTlsSocket.emit('secureConnect'), 10);
          return fakeTlsSocket;
        });

      try {
        await new Promise<void>((resolve, reject) => {
          createPinnedSocket(
            {
              hostname: '93.184.216.34',
              pinnedIp: '127.0.0.1',
              port: serverPort,
              isHttps: true,
            },
            err => {
              if (err) reject(err);
              else resolve();
            },
          );
        });

        expect(capturedOptions).not.toBeNull();
        expect(capturedOptions!.servername).toBeUndefined(); // RFC 6066: No SNI for IP literals
        expect(capturedOptions!.rejectUnauthorized).toBe(true);
      } finally {
        tlsSpy.mockRestore();
      }
    });

    it('omits TLS SNI servername when target hostname is a bracketed IPv6 literal', async () => {
      let capturedOptions: tls.ConnectionOptions | null = null;
      const tlsSpy = vi
        .spyOn(tls, 'connect')
        .mockImplementation((options: tls.ConnectionOptions) => {
          capturedOptions = options;
          options.socket?.destroy();
          const fakeTlsSocket = new net.Socket() as unknown as tls.TLSSocket;
          setTimeout(() => fakeTlsSocket.emit('secureConnect'), 10);
          return fakeTlsSocket;
        });

      try {
        await new Promise<void>((resolve, reject) => {
          createPinnedSocket(
            {
              hostname: '[2606:2800:220:1:248:1893:25c8:1946]',
              pinnedIp: '127.0.0.1',
              port: serverPort,
              isHttps: true,
            },
            err => {
              if (err) reject(err);
              else resolve();
            },
          );
        });

        expect(capturedOptions).not.toBeNull();
        expect(capturedOptions!.servername).toBeUndefined(); // No SNI for IPv6 literals
      } finally {
        tlsSpy.mockRestore();
      }
    });

    it('includes TLS SNI servername when target hostname is a DNS domain', async () => {
      let capturedOptions: tls.ConnectionOptions | null = null;
      const tlsSpy = vi
        .spyOn(tls, 'connect')
        .mockImplementation((options: tls.ConnectionOptions) => {
          capturedOptions = options;
          options.socket?.destroy();
          const fakeTlsSocket = new net.Socket() as unknown as tls.TLSSocket;
          setTimeout(() => fakeTlsSocket.emit('secureConnect'), 10);
          return fakeTlsSocket;
        });

      try {
        await new Promise<void>((resolve, reject) => {
          createPinnedSocket(
            {
              hostname: 'audit-target.com',
              pinnedIp: '127.0.0.1',
              port: serverPort,
              isHttps: true,
            },
            err => {
              if (err) reject(err);
              else resolve();
            },
          );
        });

        expect(capturedOptions).not.toBeNull();
        expect(capturedOptions!.servername).toBe('audit-target.com'); // SNI sent for DNS host
        expect(capturedOptions!.rejectUnauthorized).toBe(true);
      } finally {
        tlsSpy.mockRestore();
      }
    });

    it('maps TLS certificate handshake errors to ERR_TLS_CERT_INVALID', async () => {
      const tlsSpy = vi
        .spyOn(tls, 'connect')
        .mockImplementation((options: tls.ConnectionOptions) => {
          options.socket?.destroy();
          const fakeTlsSocket = new net.Socket() as unknown as tls.TLSSocket;
          setTimeout(() => {
            const certErr = new Error('CERT_HAS_EXPIRED') as NodeJS.ErrnoException;
            certErr.code = 'CERT_HAS_EXPIRED';
            fakeTlsSocket.emit('error', certErr);
          }, 10);
          return fakeTlsSocket;
        });

      try {
        const err = await new Promise<Error>(resolve => {
          createPinnedSocket(
            {
              hostname: 'expired-cert.com',
              pinnedIp: '127.0.0.1',
              port: serverPort,
              isHttps: true,
            },
            error => {
              resolve(error as Error);
            },
          );
        });

        expect(err).toBeInstanceOf(ScannerClientError);
        expect((err as ScannerClientError).code).toBe(
          SCANNER_CLIENT_ERROR_CODES.ERR_TLS_CERT_INVALID,
        );
        expect(err.message).toContain('TLS handshake / certificate validation failed');
      } finally {
        tlsSpy.mockRestore();
      }
    });

    describe('Certificate Verification Configuration Logic', () => {
      it('defaults rejectUnauthorized to true when omitted', async () => {
        let capturedOptions: tls.ConnectionOptions | null = null;
        const tlsSpy = vi
          .spyOn(tls, 'connect')
          .mockImplementation((options: tls.ConnectionOptions) => {
            capturedOptions = options;
            options.socket?.destroy();
            const fake = new net.Socket() as unknown as tls.TLSSocket;
            setTimeout(() => fake.emit('secureConnect'), 5);
            return fake;
          });

        try {
          await new Promise<void>((resolve, reject) => {
            createPinnedSocket(
              {
                hostname: 'test.com',
                pinnedIp: '127.0.0.1',
                port: serverPort,
                isHttps: true,
                // rejectUnauthorized omitted
              },
              err => (err ? reject(err) : resolve()),
            );
          });
          expect(capturedOptions!.rejectUnauthorized).toBe(true);
        } finally {
          tlsSpy.mockRestore();
        }
      });

      it('defaults rejectUnauthorized to true when undefined', async () => {
        let capturedOptions: tls.ConnectionOptions | null = null;
        const tlsSpy = vi
          .spyOn(tls, 'connect')
          .mockImplementation((options: tls.ConnectionOptions) => {
            capturedOptions = options;
            options.socket?.destroy();
            const fake = new net.Socket() as unknown as tls.TLSSocket;
            setTimeout(() => fake.emit('secureConnect'), 5);
            return fake;
          });

        try {
          await new Promise<void>((resolve, reject) => {
            createPinnedSocket(
              {
                hostname: 'test.com',
                pinnedIp: '127.0.0.1',
                port: serverPort,
                isHttps: true,
                rejectUnauthorized: undefined,
              },
              err => (err ? reject(err) : resolve()),
            );
          });
          expect(capturedOptions!.rejectUnauthorized).toBe(true);
        } finally {
          tlsSpy.mockRestore();
        }
      });

      it('respects explicit rejectUnauthorized: true', async () => {
        let capturedOptions: tls.ConnectionOptions | null = null;
        const tlsSpy = vi
          .spyOn(tls, 'connect')
          .mockImplementation((options: tls.ConnectionOptions) => {
            capturedOptions = options;
            options.socket?.destroy();
            const fake = new net.Socket() as unknown as tls.TLSSocket;
            setTimeout(() => fake.emit('secureConnect'), 5);
            return fake;
          });

        try {
          await new Promise<void>((resolve, reject) => {
            createPinnedSocket(
              {
                hostname: 'test.com',
                pinnedIp: '127.0.0.1',
                port: serverPort,
                isHttps: true,
                rejectUnauthorized: true,
              },
              err => (err ? reject(err) : resolve()),
            );
          });
          expect(capturedOptions!.rejectUnauthorized).toBe(true);
        } finally {
          tlsSpy.mockRestore();
        }
      });

      it('respects explicit rejectUnauthorized: false only when specifically provided', async () => {
        let capturedOptions: tls.ConnectionOptions | null = null;
        const tlsSpy = vi
          .spyOn(tls, 'connect')
          .mockImplementation((options: tls.ConnectionOptions) => {
            capturedOptions = options;
            options.socket?.destroy();
            const fake = new net.Socket() as unknown as tls.TLSSocket;
            setTimeout(() => fake.emit('secureConnect'), 5);
            return fake;
          });

        try {
          await new Promise<void>((resolve, reject) => {
            createPinnedSocket(
              {
                hostname: 'test.com',
                pinnedIp: '127.0.0.1',
                port: serverPort,
                isHttps: true,
                rejectUnauthorized: false,
              },
              err => (err ? reject(err) : resolve()),
            );
          });
          expect(capturedOptions!.rejectUnauthorized).toBe(false);
          // When false, checkServerIdentity bypasses checks
          const mockCert = {} as tls.PeerCertificate;
          expect(capturedOptions!.checkServerIdentity!('test.com', mockCert)).toBeUndefined();
        } finally {
          tlsSpy.mockRestore();
        }
      });
    });
  });
});
