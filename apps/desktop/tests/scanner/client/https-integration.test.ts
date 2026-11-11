import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import type net from 'node:net';
import { SafeHttpClient } from '../../../src/main/scanner/client/http-client.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../../../src/main/scanner/client/types.js';

describe('Real HTTPS & TLS Verification Integration Suite', () => {
  const fixturesDir = path.resolve(__dirname, '../../fixtures/tls');
  const caCert = fs.readFileSync(path.join(fixturesDir, 'ca-cert.pem'));
  const validCert = fs.readFileSync(path.join(fixturesDir, 'valid-cert.pem'));
  const validKey = fs.readFileSync(path.join(fixturesDir, 'valid-key.pem'));
  const selfsignedCert = fs.readFileSync(path.join(fixturesDir, 'selfsigned-cert.pem'));
  const selfsignedKey = fs.readFileSync(path.join(fixturesDir, 'selfsigned-key.pem'));
  const mismatchCert = fs.readFileSync(path.join(fixturesDir, 'mismatch-cert.pem'));
  const mismatchKey = fs.readFileSync(path.join(fixturesDir, 'mismatch-key.pem'));
  const expiredCert = fs.readFileSync(path.join(fixturesDir, 'expired-cert.pem'));
  const expiredKey = fs.readFileSync(path.join(fixturesDir, 'expired-key.pem'));

  let validServer: https.Server;
  let validPort: number;

  let selfsignedServer: https.Server;
  let selfsignedPort: number;

  let mismatchServer: https.Server;
  let mismatchPort: number;

  let expiredServer: https.Server;
  let expiredPort: number;

  let connectionsCount = 0;

  beforeAll(async () => {
    // 1. Valid Server (SAN: DNS:audit-target.com, IP:127.0.0.1, DNS:localhost)
    validServer = https.createServer({ cert: validCert, key: validKey }, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body><h1>Secure Audit Target</h1></body></html>');
    });
    validServer.on('connection', () => {
      connectionsCount++;
    });

    // 2. Self-signed Server (not signed by CA)
    selfsignedServer = https.createServer(
      { cert: selfsignedCert, key: selfsignedKey },
      (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Self Signed</h1>');
      },
    );

    // 3. Mismatched Server (SAN: DNS:unrelated-site.com)
    mismatchServer = https.createServer({ cert: mismatchCert, key: mismatchKey }, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Mismatch</h1>');
    });

    // 4. Expired Server (expired in 2020)
    expiredServer = https.createServer({ cert: expiredCert, key: expiredKey }, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Expired</h1>');
    });

    await Promise.all([
      new Promise<void>(resolve =>
        validServer.listen(0, '127.0.0.1', () => {
          validPort = (validServer.address() as net.AddressInfo).port;
          resolve();
        }),
      ),
      new Promise<void>(resolve =>
        selfsignedServer.listen(0, '127.0.0.1', () => {
          selfsignedPort = (selfsignedServer.address() as net.AddressInfo).port;
          resolve();
        }),
      ),
      new Promise<void>(resolve =>
        mismatchServer.listen(0, '127.0.0.1', () => {
          mismatchPort = (mismatchServer.address() as net.AddressInfo).port;
          resolve();
        }),
      ),
      new Promise<void>(resolve =>
        expiredServer.listen(0, '127.0.0.1', () => {
          expiredPort = (expiredServer.address() as net.AddressInfo).port;
          resolve();
        }),
      ),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>(resolve => validServer.close(() => resolve())),
      new Promise<void>(resolve => selfsignedServer.close(() => resolve())),
      new Promise<void>(resolve => mismatchServer.close(() => resolve())),
      new Promise<void>(resolve => expiredServer.close(() => resolve())),
    ]);
  });

  it('accepts valid trusted certificate when CA is provided and hostname matches SAN', async () => {
    const client = new SafeHttpClient();
    const beforeConn = connectionsCount;

    const res = await client.get(`https://audit-target.com:${validPort}/index.html`, {
      lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
      pinnedIpOverride: '127.0.0.1',
      ca: caCert,
    });

    expect(res.statusCode).toBe(200);
    expect(res.text()).toContain('Secure Audit Target');
    // Confirm exact single TCP connection wrapped by TLS (no secondary uncontrolled socket)
    expect(connectionsCount - beforeConn).toBe(1);
  });

  it('rejects self-signed certificate by default (without CA anchor)', async () => {
    const client = new SafeHttpClient();

    await expect(
      client.get(`https://audit-target.com:${selfsignedPort}/index.html`, {
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        pinnedIpOverride: '127.0.0.1',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_TLS_CERT_INVALID,
      }),
    );
  });

  it('rejects expired certificate even when signed by trusted CA', async () => {
    const client = new SafeHttpClient();

    await expect(
      client.get(`https://audit-target.com:${expiredPort}/index.html`, {
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        pinnedIpOverride: '127.0.0.1',
        ca: caCert,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_TLS_CERT_INVALID,
      }),
    );
  });

  it('rejects certificate with mismatched hostname (unrelated-site.com vs audit-target.com)', async () => {
    const client = new SafeHttpClient();

    await expect(
      client.get(`https://audit-target.com:${mismatchPort}/index.html`, {
        lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
        pinnedIpOverride: '127.0.0.1',
        ca: caCert,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_TLS_CERT_INVALID,
      }),
    );
  });

  it('validates IPv4 literal certificate identity matching SAN iPAddress', async () => {
    const client = new SafeHttpClient();

    // validCert has subjectAltName=DNS:audit-target.com,IP:93.184.216.34
    // URL hostname is public IP 93.184.216.34 (passes SSRF check)
    // pinnedIpOverride routes socket to local validPort
    // RFC 6066: SNI servername is omitted for IP literals
    // tls.checkServerIdentity matches 93.184.216.34 against iPAddress SAN
    const res = await client.get(`https://93.184.216.34:${validPort}/index.html`, {
      ca: caCert,
      pinnedIpOverride: '127.0.0.1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.text()).toContain('Secure Audit Target');
  });

  it('rejects IPv4 literal certificate when certificate lacks matching IP SAN', async () => {
    const client = new SafeHttpClient();

    // mismatchCert only has subjectAltName=DNS:unrelated-site.com (lacks IP:93.184.216.34)
    await expect(
      client.get(`https://93.184.216.34:${mismatchPort}/index.html`, {
        ca: caCert,
        pinnedIpOverride: '127.0.0.1',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_TLS_CERT_INVALID,
      }),
    );
  });
});
