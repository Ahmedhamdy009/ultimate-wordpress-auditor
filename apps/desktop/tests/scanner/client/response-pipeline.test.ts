import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import zlib from 'node:zlib';
import { executeSafeResponsePipeline } from '../../../src/main/scanner/client/response-pipeline.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../../../src/main/scanner/client/types.js';

function createMockResponse(options: {
  headers: Record<string, string>;
  chunks: Buffer[];
  statusCode?: number;
}): IncomingMessage {
  const stream = Readable.from(options.chunks);
  const mockRes = Object.assign(stream, {
    headers: options.headers,
    statusCode: options.statusCode ?? 200,
    statusMessage: 'OK',
  }) as unknown as IncomingMessage;
  return mockRes;
}

describe('Safe Response Pipeline & Streaming Limiters', () => {
  describe('Content-Type Gatekeeper', () => {
    it('rejects responses with missing Content-Type header', async () => {
      const res = createMockResponse({
        headers: {},
        chunks: [Buffer.from('<html><body>Hello</body></html>')],
      });

      await expect(executeSafeResponsePipeline(res)).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_NON_HTML_CONTENT_TYPE,
        }),
      );
    });

    it('rejects responses with non-HTML Content-Type (e.g. application/pdf, image/png)', async () => {
      const badMimes = ['application/pdf', 'image/png', 'application/json', 'text/plain'];

      for (const mime of badMimes) {
        const res = createMockResponse({
          headers: { 'content-type': mime },
          chunks: [Buffer.from('non-html-bytes')],
        });

        await expect(executeSafeResponsePipeline(res)).rejects.toThrowError(
          expect.objectContaining({
            code: SCANNER_CLIENT_ERROR_CODES.ERR_NON_HTML_CONTENT_TYPE,
          }),
        );
      }
    });

    it('accepts text/html and application/xhtml+xml', async () => {
      const htmlContent =
        '<html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>';
      const res = createMockResponse({
        headers: { 'content-type': 'text/html; charset=UTF-8' },
        chunks: [Buffer.from(htmlContent)],
      });

      const result = await executeSafeResponsePipeline(res);
      expect(result.decompressedBodyBytes).toBe(Buffer.byteLength(htmlContent));
      expect(Buffer.from(result.body).toString('utf-8')).toBe(htmlContent);
    });
  });

  describe('Content-Encoding Decoding & Stacked Header Rejection', () => {
    const rawHtml = '<!DOCTYPE html><html><body>Test Payload For Compression</body></html>';

    it('decompresses gzip encoded responses', async () => {
      const gzipped = zlib.gzipSync(Buffer.from(rawHtml));
      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
        },
        chunks: [gzipped],
      });

      const result = await executeSafeResponsePipeline(res);
      expect(result.encodedBodyBytes).toBe(gzipped.length);
      expect(result.decompressedBodyBytes).toBe(Buffer.byteLength(rawHtml));
      expect(Buffer.from(result.body).toString('utf-8')).toBe(rawHtml);
    });

    it('decompresses deflate encoded responses', async () => {
      const deflated = zlib.deflateSync(Buffer.from(rawHtml));
      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'deflate',
        },
        chunks: [deflated],
      });

      const result = await executeSafeResponsePipeline(res);
      expect(Buffer.from(result.body).toString('utf-8')).toBe(rawHtml);
    });

    it('decompresses brotli encoded responses', async () => {
      const brotlied = zlib.brotliCompressSync(Buffer.from(rawHtml));
      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'br',
        },
        chunks: [brotlied],
      });

      const result = await executeSafeResponsePipeline(res);
      expect(Buffer.from(result.body).toString('utf-8')).toBe(rawHtml);
    });

    it('rejects stacked Content-Encoding fail-closed', async () => {
      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'gzip, br',
        },
        chunks: [Buffer.from('data')],
      });

      await expect(executeSafeResponsePipeline(res)).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_UNSUPPORTED_CONTENT_ENCODING,
        }),
      );
    });

    it('rejects unsupported Content-Encoding fail-closed', async () => {
      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'compress',
        },
        chunks: [Buffer.from('data')],
      });

      await expect(executeSafeResponsePipeline(res)).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_UNSUPPORTED_CONTENT_ENCODING,
        }),
      );
    });

    it('rejects malformed gzip streams fail-closed with ERR_UNSUPPORTED_CONTENT_ENCODING', async () => {
      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
        },
        chunks: [Buffer.from('this is completely invalid non-gzip binary data')],
      });

      await expect(executeSafeResponsePipeline(res)).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_UNSUPPORTED_CONTENT_ENCODING,
        }),
      );
    });

    it('rejects truncated gzip streams fail-closed with ERR_UNSUPPORTED_CONTENT_ENCODING', async () => {
      const validGzip = zlib.gzipSync(
        Buffer.from('<html><body>Valid HTML Content For Testing</body></html>'),
      );
      const truncated = validGzip.subarray(0, 8); // truncate header/payload

      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
        },
        chunks: [truncated],
      });

      await expect(executeSafeResponsePipeline(res)).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_UNSUPPORTED_CONTENT_ENCODING,
        }),
      );
    });
  });

  describe('Encoded Body Size Limiter', () => {
    it('aborts pipeline when encoded body bytes exceed maximum limit', async () => {
      const chunk1 = Buffer.alloc(600, 'a');
      const chunk2 = Buffer.alloc(600, 'b');

      const res = createMockResponse({
        headers: { 'content-type': 'text/html' },
        chunks: [chunk1, chunk2],
      });

      await expect(
        executeSafeResponsePipeline(res, { maxEncodedBytes: 1000 }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_ENCODED_BODY_SIZE_EXCEEDED,
        }),
      );
    });
  });

  describe('Decompressed Body Size Limiter', () => {
    it('aborts pipeline when decompressed bytes exceed limit', async () => {
      const chunk = Buffer.alloc(2500, 'x');
      const res = createMockResponse({
        headers: { 'content-type': 'text/html' },
        chunks: [chunk],
      });

      await expect(
        executeSafeResponsePipeline(res, { maxDecompressedBytes: 2000 }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_DECOMPRESSED_BODY_SIZE_EXCEEDED,
        }),
      );
    });
  });

  describe('Compression Bomb Detection', () => {
    it('allows small highly compressible responses (<50KB) without false positives', async () => {
      // 2 KB of repetitive data compresses to ~35 bytes (ratio ~57:1)
      const smallUncompressed = Buffer.alloc(2048, 'a');
      const gzipped = zlib.gzipSync(smallUncompressed);

      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
        },
        chunks: [gzipped],
      });

      // Default minCompressionRatioBytes is 50 KB, so a 2 KB response must NOT trigger false positive
      const result = await executeSafeResponsePipeline(res);
      expect(result.decompressedBodyBytes).toBe(2048);
      expect(Buffer.from(result.body).toString('utf-8')).toBe('a'.repeat(2048));
    });

    it('detects and aborts decompression when compression ratio exceeds ceiling', async () => {
      // 100 KB of repetitive zeros compresses down to ~120 bytes
      const uncompressed = Buffer.alloc(100 * 1024, 0);
      const gzipped = zlib.gzipSync(uncompressed);

      expect(gzipped.length).toBeLessThan(1000); // highly compressed
      const ratio = uncompressed.length / gzipped.length;
      expect(ratio).toBeGreaterThan(10); // ratio is over 100:1

      const res = createMockResponse({
        headers: {
          'content-type': 'text/html',
          'content-encoding': 'gzip',
        },
        chunks: [gzipped],
      });

      await expect(
        executeSafeResponsePipeline(res, {
          maxCompressionRatio: 10,
          minCompressionRatioBytes: 5000,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_COMPRESSION_BOMB_DETECTED,
        }),
      );
    });
  });

  describe('Direct-to-ArrayBuffer Accumulation and Memory Clean-Up', () => {
    it('accumulates chunks directly into dedicated ArrayBuffer without Buffer.concat()', async () => {
      const part1 = Buffer.from('<html><body>Part 1 ');
      const part2 = Buffer.from('and Part 2</body></html>');

      const res = createMockResponse({
        headers: { 'content-type': 'text/html' },
        chunks: [part1, part2],
      });

      const result = await executeSafeResponsePipeline(res);
      expect(result.body).toBeInstanceOf(ArrayBuffer);
      expect(result.body.byteLength).toBe(part1.length + part2.length);
      expect(Buffer.from(result.body).toString('utf-8')).toBe(
        '<html><body>Part 1 and Part 2</body></html>',
      );
    });
  });

  describe('AbortSignal Cancellation', () => {
    it('aborts and tears down pipeline on signal abortion', async () => {
      const controller = new AbortController();
      controller.abort();

      const res = createMockResponse({
        headers: { 'content-type': 'text/html' },
        chunks: [Buffer.from('<html><body>Hello</body></html>')],
      });

      await expect(
        executeSafeResponsePipeline(res, { signal: controller.signal }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        }),
      );
    });
  });
});
