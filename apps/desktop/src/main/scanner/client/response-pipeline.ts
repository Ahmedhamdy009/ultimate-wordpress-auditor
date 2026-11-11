import type { IncomingMessage } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { validateHtmlContentType } from '@auditor/shared';
import { SCANNER_CLIENT_ERROR_CODES } from './types.js';
import { ScannerClientError } from './errors.js';

export interface ResponsePipelineLimits {
  readonly maxEncodedBytes?: number;
  readonly maxDecompressedBytes?: number;
  readonly maxCompressionRatio?: number;
  readonly minCompressionRatioBytes?: number;
  readonly signal?: AbortSignal;
}

export interface ProcessedResponseBody {
  readonly encodedBodyBytes: number;
  readonly decompressedBodyBytes: number;
  readonly body: ArrayBuffer;
}

/**
 * Encoded HTTP response body byte limiter.
 * Operates directly on the raw entity body chunks delivered by IncomingMessage.
 */
class EncodedBodyLimiter extends Transform {
  bytesCount = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    super();
    this.maxBytes = maxBytes;
  }

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.bytesCount += chunk.length;
    if (this.bytesCount > this.maxBytes) {
      callback(
        new ScannerClientError(
          SCANNER_CLIENT_ERROR_CODES.ERR_ENCODED_BODY_SIZE_EXCEEDED,
          `Encoded HTTP response body size (${this.bytesCount} bytes) exceeded maximum limit of ${this.maxBytes} bytes.`,
          { encodedBytes: this.bytesCount, maxEncodedBytes: this.maxBytes },
        ),
      );
      return;
    }
    callback(null, chunk);
  }
}

/**
 * Decompressed body size limiter & compression bomb ratio detector.
 */
class DecompressedBodyLimiter extends Transform {
  decompressedBytes = 0;
  private readonly maxBytes: number;
  private readonly maxRatio: number;
  private readonly minRatioBytes: number;
  private readonly getEncodedBytes: () => number;

  constructor(
    maxBytes: number,
    maxRatio: number,
    minRatioBytes: number,
    getEncodedBytes: () => number,
  ) {
    super();
    this.maxBytes = maxBytes;
    this.maxRatio = maxRatio;
    this.minRatioBytes = minRatioBytes;
    this.getEncodedBytes = getEncodedBytes;
  }

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.decompressedBytes += chunk.length;

    if (this.decompressedBytes > this.maxBytes) {
      callback(
        new ScannerClientError(
          SCANNER_CLIENT_ERROR_CODES.ERR_DECOMPRESSED_BODY_SIZE_EXCEEDED,
          `Decompressed response body size (${this.decompressedBytes} bytes) exceeded maximum limit of ${this.maxBytes} bytes.`,
          { decompressedBytes: this.decompressedBytes, maxDecompressedBytes: this.maxBytes },
        ),
      );
      return;
    }

    if (this.decompressedBytes > this.minRatioBytes) {
      const encoded = Math.max(1, this.getEncodedBytes());
      const ratio = this.decompressedBytes / encoded;
      if (ratio > this.maxRatio) {
        callback(
          new ScannerClientError(
            SCANNER_CLIENT_ERROR_CODES.ERR_COMPRESSION_BOMB_DETECTED,
            `Compression bomb detected: decompression ratio ${ratio.toFixed(1)}:1 exceeded maximum allowed ratio ${this.maxRatio}:1.`,
            {
              decompressedBytes: this.decompressedBytes,
              encodedBytes: encoded,
              ratio,
              maxRatio: this.maxRatio,
            },
          ),
        );
        return;
      }
    }

    callback(null, chunk);
  }
}

/**
 * Accumulator transform stream that buffers incoming chunks and copies them
 * directly into a single dedicated ArrayBuffer without Buffer.concat().
 */
class BoundedBufferAccumulator extends Transform {
  private chunks: Buffer[] = [];
  totalBytes = 0;

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    callback(); // Do not forward chunks downstream; consume here
  }

  /**
   * Finalizes memory accumulation into a single unshared ArrayBuffer
   * and immediately releases internal chunk references.
   */
  toArrayBuffer(): ArrayBuffer {
    const buffer = new ArrayBuffer(this.totalBytes);
    const view = new Uint8Array(buffer);
    let offset = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      view.set(c, offset);
      offset += c.length;
    }
    // Release references immediately
    this.chunks.length = 0;
    return buffer;
  }
}

/**
 * Executes the safe streaming response processing pipeline:
 * res -> EncodedBodyLimiter -> Decompressor -> DecompressedBodyLimiter -> BoundedAccumulator
 */
export async function executeSafeResponsePipeline(
  res: IncomingMessage,
  limits?: ResponsePipelineLimits,
): Promise<ProcessedResponseBody> {
  const maxEncodedBytes = limits?.maxEncodedBytes ?? 2 * 1024 * 1024; // 2 MB
  const maxDecompressedBytes = limits?.maxDecompressedBytes ?? 4 * 1024 * 1024; // 4 MB
  const maxCompressionRatio = limits?.maxCompressionRatio ?? 10;
  const minCompressionRatioBytes = limits?.minCompressionRatioBytes ?? 50 * 1024; // 50 KB
  const signal = limits?.signal;

  if (signal?.aborted) {
    res.destroy();
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
      'Response processing aborted by caller signal.',
    );
  }

  // 1. Content-Type Gatekeeper
  const contentType = res.headers['content-type'];
  const ctCheck = validateHtmlContentType(contentType);
  if (!ctCheck.allowed) {
    res.destroy();
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_NON_HTML_CONTENT_TYPE,
      `Non-HTML or invalid Content-Type: ${ctCheck.reason}`,
      { contentType },
    );
  }

  // 2. Content-Encoding Inspection & Decoder Selection
  const rawEncoding = (res.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  if (rawEncoding.includes(',')) {
    res.destroy();
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_UNSUPPORTED_CONTENT_ENCODING,
      `Stacked Content-Encoding headers ("${rawEncoding}") are strictly rejected.`,
      { contentEncoding: rawEncoding },
    );
  }

  let decompressor: Transform;
  if (rawEncoding === 'gzip') {
    decompressor = zlib.createGunzip();
  } else if (rawEncoding === 'deflate') {
    decompressor = zlib.createInflate();
  } else if (rawEncoding === 'br') {
    decompressor = zlib.createBrotliDecompress();
  } else if (rawEncoding === 'identity' || rawEncoding === '') {
    decompressor = new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk);
      },
    });
  } else {
    res.destroy();
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_UNSUPPORTED_CONTENT_ENCODING,
      `Unsupported Content-Encoding: "${rawEncoding}". Only gzip, deflate, br, and identity are supported.`,
      { contentEncoding: rawEncoding },
    );
  }

  const encodedLimiter = new EncodedBodyLimiter(maxEncodedBytes);
  const decompressedLimiter = new DecompressedBodyLimiter(
    maxDecompressedBytes,
    maxCompressionRatio,
    minCompressionRatioBytes,
    () => encodedLimiter.bytesCount,
  );
  const accumulator = new BoundedBufferAccumulator();

  // Attach abort handler to destroy pipeline on signal
  const onAbort = (): void => {
    res.destroy();
    encodedLimiter.destroy();
    decompressor.destroy();
    decompressedLimiter.destroy();
    accumulator.destroy();
  };

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    await pipeline(res, encodedLimiter, decompressor, decompressedLimiter, accumulator, { signal });

    const bodyBuffer = accumulator.toArrayBuffer();
    return {
      encodedBodyBytes: encodedLimiter.bytesCount,
      decompressedBodyBytes: accumulator.totalBytes,
      body: bodyBuffer,
    };
  } catch (err: unknown) {
    res.destroy();
    if (signal?.aborted) {
      throw new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        'Response pipeline processing aborted by caller signal.',
      );
    }
    if (err instanceof ScannerClientError) {
      throw err;
    }
    const errObj = err as { code?: string; message?: string };
    if (
      errObj.code === 'Z_DATA_ERROR' ||
      errObj.code === 'Z_BUF_ERROR' ||
      errObj.code === 'ERR_PADDING_2' ||
      errObj.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
      errObj.code === 'ERR_BROTLI_DECOMPRESS_FAILED'
    ) {
      throw new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_UNSUPPORTED_CONTENT_ENCODING,
        `Decompression failed: stream is corrupt or truncated (${errObj.message})`,
        { cause: errObj.code },
      );
    }
    throw err;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
