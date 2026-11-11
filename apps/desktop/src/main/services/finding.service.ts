import {
  IPCError,
  IPC_ERROR_CODES,
  type CreateFindingRequest,
  type GetFindingRequest,
  type ListFindingsRequest,
  type FindingDTO,
  type FindingListResponseDTO,
} from '@auditor/shared';
import type { FindingRepository } from '../db/repositories/finding.repository.js';
import type { ScanRunRepository } from '../db/repositories/scan-run.repository.js';

export const MAX_EVIDENCE_SIZE_BYTES = 64 * 1024; // 64 KB

/**
 * Sensitive key pattern matching tokens, passwords, cookies, authorization headers, and API keys.
 */
const SENSITIVE_KEY_REGEX =
  /^(?:authorization|auth[_-]?token|access[_-]?token|bearer|api[_-]?key|password|passwd|pwd|secret|cookie|set[_-]?cookie|private[_-]?key)$/i;

/**
 * Value patterns matching JWTs, Bearer tokens, or secret strings.
 */
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const BASIC_AUTH_REGEX = /Basic\s+[A-Za-z0-9+/=]+/gi;

/**
 * Recursively redacts sensitive credentials and tokens from evidence objects.
 */
export function redactSecrets(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    let sanitized = value.replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(BASIC_AUTH_REGEX, 'Basic [REDACTED]');
    return sanitized;
  }

  if (Array.isArray(value)) {
    return value.map(item => redactSecrets(item));
  }

  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }

    const sanitizedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        sanitizedObj[k] = '[REDACTED]';
      } else {
        sanitizedObj[k] = redactSecrets(v);
      }
    }
    return sanitizedObj;
  }

  return value;
}

export interface IFindingService {
  createFinding(request: CreateFindingRequest): FindingDTO;
  getFindingById(request: GetFindingRequest): FindingDTO;
  listFindings(request: ListFindingsRequest): FindingListResponseDTO;
}

export class FindingService implements IFindingService {
  private readonly findingRepo: FindingRepository;
  private readonly scanRunRepo: ScanRunRepository;

  constructor(findingRepo: FindingRepository, scanRunRepo: ScanRunRepository) {
    this.findingRepo = findingRepo;
    this.scanRunRepo = scanRunRepo;
  }

  /**
   * Creates a new finding associated with an existing scan run.
   * Business Rules:
   * - Associated scan run must exist.
   * - Evidence size is bounded to 64KB max.
   * - Secrets, passwords, tokens, and cookies in evidence are safely redacted before persistence.
   */
  public createFinding(request: CreateFindingRequest): FindingDTO {
    const run = this.scanRunRepo.getById(request.scanRunId);
    if (!run) {
      throw new IPCError(
        `Associated scan run '${request.scanRunId}' not found`,
        IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND,
      );
    }

    let sanitizedEvidence: Record<string, unknown> | string | null = null;
    if (request.evidence !== undefined && request.evidence !== null) {
      const serialized =
        typeof request.evidence === 'string' ? request.evidence : JSON.stringify(request.evidence);

      const byteLength = Buffer.byteLength(serialized, 'utf8');
      if (byteLength > MAX_EVIDENCE_SIZE_BYTES) {
        throw new IPCError(
          `Evidence size (${byteLength} bytes) exceeds maximum allowed limit (64KB)`,
          IPC_ERROR_CODES.EVIDENCE_TOO_LARGE,
        );
      }

      const redacted = redactSecrets(request.evidence);
      sanitizedEvidence = redacted as Record<string, unknown> | string;
    }

    try {
      return this.findingRepo.create({
        scanRunId: request.scanRunId,
        ruleId: request.ruleId,
        category: request.category,
        title: request.title,
        description: request.description,
        severity: request.severity,
        confidence: request.confidence,
        status: request.status ?? 'active',
        targetUrl: request.targetUrl,
        evidence: sanitizedEvidence,
        remediation: request.remediation ?? null,
        references: request.references ?? null,
      });
    } catch {
      throw new IPCError('Failed to persist finding in database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }

  /**
   * Retrieves a finding by ID.
   */
  public getFindingById(request: GetFindingRequest): FindingDTO {
    const finding = this.findingRepo.getById(request.id);
    if (!finding) {
      throw new IPCError(`Finding '${request.id}' not found`, IPC_ERROR_CODES.FINDING_NOT_FOUND);
    }
    return finding;
  }

  /**
   * Lists findings for a scan run with filtering and pagination.
   */
  public listFindings(request: ListFindingsRequest): FindingListResponseDTO {
    const run = this.scanRunRepo.getById(request.scanRunId);
    if (!run) {
      throw new IPCError(
        `Associated scan run '${request.scanRunId}' not found`,
        IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND,
      );
    }

    try {
      return this.findingRepo.listByScanRunId(request.scanRunId, {
        severity: request.severity,
        category: request.category,
        status: request.status,
        limit: request.limit,
        offset: request.offset,
      });
    } catch {
      throw new IPCError('Failed to list findings from database', IPC_ERROR_CODES.DATABASE_ERROR);
    }
  }
}
