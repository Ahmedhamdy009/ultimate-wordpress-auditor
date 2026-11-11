export interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly up: string;
}

export interface AppliedMigrationRecord {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: string;
}

export interface MigrationResult {
  readonly appliedCount: number;
  readonly currentVersion: number;
}
