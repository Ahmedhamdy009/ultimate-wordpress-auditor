/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const results = {
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  chromeVersion: process.versions.chrome,
  modulesAbi: process.versions.modules,
  timestamp: new Date().toISOString(),
  steps: [],
  success: false,
};

async function main() {
  const bundlePath =
    'file:///' +
    path.resolve('D:/ahmed/.tmp/electron-scanner-bundle/scanner-client.js').replace(/\\/g, '/');
  const { SafeHttpClient, SCANNER_CLIENT_ERROR_CODES } = await import(bundlePath);

  // 1. Verify client instantiation in Electron Main
  const client = new SafeHttpClient();
  results.steps.push({ name: 'instantiate_client', success: typeof client.get === 'function' });

  // 2. Verify SSRF protection inside Electron Main
  try {
    await client.get('http://127.0.0.1:8080/admin');
    results.steps.push({ name: 'ssrf_block_loopback', blocked: false });
  } catch (err) {
    results.steps.push({
      name: 'ssrf_block_loopback',
      blocked: true,
      code: err.code,
      expected: err.code === SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
    });
  }

  // 3. Real local HTTP server and pinned GET inside Electron Main
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><body><h1>Electron Main HTTP OK</h1></body></html>');
  });

  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const httpPort = httpServer.address().port;

  try {
    const httpRes = await client.get(`http://audit-target.com:${httpPort}/test.html`, {
      lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
      pinnedIpOverride: '127.0.0.1',
    });

    results.steps.push({
      name: 'http_pinned_get',
      statusCode: httpRes.statusCode,
      success: httpRes.statusCode === 200 && httpRes.text().includes('Electron Main HTTP OK'),
    });
  } finally {
    await new Promise(resolve => httpServer.close(resolve));
  }

  // 4. Real local HTTPS server and TLS certificate verification inside Electron Main
  const fixturesDir = path.resolve('D:/ahmed/apps/desktop/tests/fixtures/tls');
  const caCert = fs.readFileSync(path.join(fixturesDir, 'ca-cert.pem'));
  const validCert = fs.readFileSync(path.join(fixturesDir, 'valid-cert.pem'));
  const validKey = fs.readFileSync(path.join(fixturesDir, 'valid-key.pem'));
  const selfsignedCert = fs.readFileSync(path.join(fixturesDir, 'selfsigned-cert.pem'));
  const selfsignedKey = fs.readFileSync(path.join(fixturesDir, 'selfsigned-key.pem'));

  const httpsServer = https.createServer({ cert: validCert, key: validKey }, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><html><body><h1>Electron Main HTTPS OK</h1></body></html>');
  });

  await new Promise(resolve => httpsServer.listen(0, '127.0.0.1', resolve));
  const httpsPort = httpsServer.address().port;

  try {
    // 4a. Trusted CA verification succeeds
    const httpsRes = await client.get(`https://audit-target.com:${httpsPort}/secure.html`, {
      lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
      pinnedIpOverride: '127.0.0.1',
      ca: caCert,
    });

    results.steps.push({
      name: 'https_tls_trusted_ca',
      statusCode: httpsRes.statusCode,
      success: httpsRes.statusCode === 200 && httpsRes.text().includes('Electron Main HTTPS OK'),
    });
  } finally {
    await new Promise(resolve => httpsServer.close(resolve));
  }

  // 4b. Self-signed rejection in Electron Main
  const selfsignedServer = https.createServer(
    { cert: selfsignedCert, key: selfsignedKey },
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Untrusted</h1>');
    },
  );

  await new Promise(resolve => selfsignedServer.listen(0, '127.0.0.1', resolve));
  const selfsignedPort = selfsignedServer.address().port;

  try {
    await client.get(`https://audit-target.com:${selfsignedPort}/untrusted.html`, {
      lookupFn: async () => [{ address: '93.184.216.34', family: 4 }],
      pinnedIpOverride: '127.0.0.1',
    });
    results.steps.push({ name: 'https_reject_selfsigned', rejected: false });
  } catch (err) {
    results.steps.push({
      name: 'https_reject_selfsigned',
      rejected: true,
      code: err.code,
      expected: err.code === SCANNER_CLIENT_ERROR_CODES.ERR_TLS_CERT_INVALID,
    });
  } finally {
    await new Promise(resolve => selfsignedServer.close(resolve));
  }

  results.success = results.steps.every(
    s => s.success !== false && s.expected !== false && s.blocked !== false && s.rejected !== false,
  );
  const outPath = path.resolve('D:/ahmed/.tmp/electron_scanner_verification.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  process.exit(results.success ? 0 : 1);
}

main().catch(err => {
  results.success = false;
  results.error = { message: err.message, stack: err.stack };
  const outPath = path.resolve('D:/ahmed/.tmp/electron_scanner_verification.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  process.exit(1);
});
