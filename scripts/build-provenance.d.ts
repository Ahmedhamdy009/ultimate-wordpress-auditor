export const PROVENANCE_SCHEMA_VERSION: number;
export const PROVENANCE_FILENAME: string;

export const PROVENANCE_ERROR_CODES: Readonly<{
  MISSING: 'PROVENANCE_MISSING';
  INVALID_MANIFEST: 'PROVENANCE_INVALID_MANIFEST';
  VERSION_MISMATCH: 'PROVENANCE_VERSION_MISMATCH';
  SOURCE_MISMATCH: 'PROVENANCE_SOURCE_MISMATCH';
  BUNDLE_MISMATCH: 'PROVENANCE_BUNDLE_MISMATCH';
  COMMIT_MISMATCH: 'PROVENANCE_COMMIT_MISMATCH';
  DIRTY_TREE: 'PROVENANCE_DIRTY_TREE';
}>;

export interface GitIdentity {
  readonly available?: boolean;
  readonly commitSha: string | null;
  readonly branch: string | null;
  readonly isDirty: boolean;
}

export interface BuildProvenanceManifest {
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly sourceFingerprint: string;
  readonly inputFileCount: number;
  readonly outBundleDigest: string;
  readonly outFileCount: number;
  readonly gitCommitSha: string | null;
  readonly gitBranch: string | null;
  readonly gitDirty: boolean;
  readonly generatedAt: string;
}

export interface ProvenanceVerifyOptions {
  readonly projectRoot?: string;
  readonly outDir?: string;
  readonly gitIdentity?: GitIdentity;
  readonly requireCommitMatch?: boolean;
  readonly requireCleanTree?: boolean;
  readonly asarModule?: unknown;
}

export interface ProvenanceVerifyResult {
  readonly valid: boolean;
  readonly reasons: readonly string[];
  readonly manifest: BuildProvenanceManifest | null;
  readonly expected: {
    readonly appVersion: string;
    readonly sourceFingerprint: string;
    readonly actualBundleDigest: string | null;
    readonly gitCommitSha: string | null;
  } | null;
  readonly details: string;
}

export function computeSourceFingerprint(projectRoot?: string): {
  readonly sourceFingerprint: string;
  readonly inputFileCount: number;
};

export function computeOutBundleDigest(outDir: string): {
  readonly valid: boolean;
  readonly missingEntrypoints: readonly string[];
  readonly bundleDigest: string | null;
  readonly fileCount: number;
};

export function readGitIdentity(projectRoot?: string): GitIdentity;

export function writeBuildProvenance(options?: {
  readonly projectRoot?: string;
  readonly outDir?: string;
  readonly gitIdentity?: GitIdentity;
  readonly silent?: boolean;
}): {
  readonly manifestPath: string;
  readonly manifest: BuildProvenanceManifest;
};

export function verifyOutProvenance(options?: ProvenanceVerifyOptions): ProvenanceVerifyResult;

export function verifyAsarProvenance(
  asarPath: string,
  options?: ProvenanceVerifyOptions,
): ProvenanceVerifyResult;
