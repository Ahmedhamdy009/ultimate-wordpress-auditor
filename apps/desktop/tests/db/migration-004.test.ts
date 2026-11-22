import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { MIGRATIONS } from '../../src/main/db/migrations/definitions.js';

describe('Migration 004: Historical Comparison, Lineage, and OCC User Triage', () => {
  let connection: DatabaseConnection;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  it('successfully migrates database to version 4', () => {
    const rawDb = connection.getRawDb();
    const row = rawDb.prepare('SELECT version, name FROM _migrations WHERE version = 4').get() as {
      version: number;
      name: string;
    };

    expect(row).toBeDefined();
    expect(row.version).toBe(4);
    expect(row.name).toBe('004_historical_comparison_and_triage');
  });

  it('verifies baseline_scan_run_id column in scan_runs with SET NULL on baseline deletion', () => {
    const rawDb = connection.getRawDb();
    const projectId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const baselineScanId = crypto.randomUUID();
    const childScanId = crypto.randomUUID();
    const now = new Date().toISOString();

    rawDb
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(projectId, 'Lineage Project', now, now);

    rawDb
      .prepare(
        'INSERT INTO sites (id, project_id, name, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(siteId, projectId, 'Lineage Site', 'https://lineage.example.com', now, now);

    // Insert baseline scan run
    rawDb
      .prepare(
        `INSERT INTO scan_runs (
          id, site_id, scan_type, status, target_url, config_json, created_at, updated_at
        ) VALUES (?, ?, 'full', 'completed', 'https://lineage.example.com', '{}', ?, ?)`,
      )
      .run(baselineScanId, siteId, now, now);

    // Insert child scan run referencing baseline
    rawDb
      .prepare(
        `INSERT INTO scan_runs (
          id, site_id, scan_type, status, target_url, config_json, baseline_scan_run_id, created_at, updated_at
        ) VALUES (?, ?, 'full', 'completed', 'https://lineage.example.com', '{}', ?, ?, ?)`,
      )
      .run(childScanId, siteId, baselineScanId, now, now);

    const childBefore = rawDb
      .prepare('SELECT baseline_scan_run_id FROM scan_runs WHERE id = ?')
      .get(childScanId) as { baseline_scan_run_id: string | null };
    expect(childBefore.baseline_scan_run_id).toBe(baselineScanId);

    // Delete baseline scan run -> ON DELETE SET NULL should set child reference to null
    rawDb.prepare('DELETE FROM scan_runs WHERE id = ?').run(baselineScanId);

    const childAfter = rawDb
      .prepare('SELECT baseline_scan_run_id FROM scan_runs WHERE id = ?')
      .get(childScanId) as { baseline_scan_run_id: string | null };
    expect(childAfter.baseline_scan_run_id).toBeNull();
  });

  it('verifies fingerprint column in findings and index existence', () => {
    const rawDb = connection.getRawDb();
    const projectId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const scanId = crypto.randomUUID();
    const findingId = crypto.randomUUID();
    const now = new Date().toISOString();
    const testFingerprint = 'a'.repeat(64);

    rawDb
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(projectId, 'Finding Project', now, now);

    rawDb
      .prepare(
        'INSERT INTO sites (id, project_id, name, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(siteId, projectId, 'Finding Site', 'https://finding.example.com', now, now);

    rawDb
      .prepare(
        `INSERT INTO scan_runs (
          id, site_id, scan_type, status, target_url, config_json, created_at, updated_at
        ) VALUES (?, ?, 'full', 'completed', 'https://finding.example.com', '{}', ?, ?)`,
      )
      .run(scanId, siteId, now, now);

    rawDb
      .prepare(
        `INSERT INTO findings (
          id, scan_run_id, rule_id, category, title, description,
          severity, confidence, status, target_url, fingerprint, created_at
        ) VALUES (?, ?, 'SEC_RULE_1', 'security', 'Test Title', 'Test Desc', 'high', 'confirmed', 'active', 'https://finding.example.com', ?, ?)`,
      )
      .run(findingId, scanId, testFingerprint, now);

    const saved = rawDb.prepare('SELECT fingerprint FROM findings WHERE id = ?').get(findingId) as {
      fingerprint: string | null;
    };
    expect(saved.fingerprint).toBe(testFingerprint);

    // Verify index usage via query plan
    const plan = rawDb
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM findings WHERE fingerprint = ?')
      .all(testFingerprint) as Array<{ detail: string }>;
    expect(plan.some(p => p.detail.includes('idx_findings_fingerprint'))).toBe(true);
  });

  it('enforces SQLite triggers preventing UPDATE and DELETE on finding_triage_events', () => {
    const rawDb = connection.getRawDb();
    const projectId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const fingerprint = 'b'.repeat(64);
    const now = new Date().toISOString();

    rawDb
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(projectId, 'Trigger Project', now, now);

    rawDb
      .prepare(
        'INSERT INTO sites (id, project_id, name, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(siteId, projectId, 'Trigger Site', 'https://trigger.example.com', now, now);

    rawDb
      .prepare(
        `INSERT INTO finding_triage_events (
          id, site_id, finding_fingerprint, revision, status, previous_status,
          reason, notes, created_by, created_at
        ) VALUES (?, ?, ?, 1, 'accepted_risk', 'active', 'Business justification', NULL, 'test_user', ?)`,
      )
      .run(eventId, siteId, fingerprint, now);

    // Verify record was inserted
    const row = rawDb.prepare('SELECT * FROM finding_triage_events WHERE id = ?').get(eventId);
    expect(row).toBeDefined();

    // Attempt UPDATE -> must be blocked by trigger
    expect(() => {
      rawDb
        .prepare('UPDATE finding_triage_events SET status = ? WHERE id = ?')
        .run('active', eventId);
    }).toThrow(/finding_triage_events records are append-only and cannot be updated/);

    // Attempt DELETE -> must be blocked by trigger
    expect(() => {
      rawDb.prepare('DELETE FROM finding_triage_events WHERE id = ?').run(eventId);
    }).toThrow(/finding_triage_events records are append-only and cannot be deleted/);
  });

  it('enforces check constraints on finding_triage and finding_triage_events', () => {
    const rawDb = connection.getRawDb();
    const projectId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const now = new Date().toISOString();

    rawDb
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(projectId, 'Check Project', now, now);

    rawDb
      .prepare(
        'INSERT INTO sites (id, project_id, name, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(siteId, projectId, 'Check Site', 'https://check.example.com', now, now);

    // Invalid fingerprint length (< 64)
    expect(() => {
      rawDb
        .prepare(
          `INSERT INTO finding_triage (
            site_id, finding_fingerprint, revision, status, updated_at
          ) VALUES (?, 'short_hash', 1, 'accepted_risk', ?)`,
        )
        .run(siteId, now);
    }).toThrow();

    // Invalid revision (< 1)
    expect(() => {
      rawDb
        .prepare(
          `INSERT INTO finding_triage (
            site_id, finding_fingerprint, revision, status, updated_at
          ) VALUES (?, ?, 0, 'accepted_risk', ?)`,
        )
        .run(siteId, 'c'.repeat(64), now);
    }).toThrow();

    // Invalid status
    expect(() => {
      rawDb
        .prepare(
          `INSERT INTO finding_triage (
            site_id, finding_fingerprint, revision, status, updated_at
          ) VALUES (?, ?, 1, 'invalid_status', ?)`,
        )
        .run(siteId, 'c'.repeat(64), now);
    }).toThrow();
  });

  it('supports progressive schema upgrade from v3 to v4', async () => {
    const freshConn = new DatabaseConnection(':memory:', { isMemory: true });
    freshConn.open();

    // Run migrations up to v3 only
    const v1to3 = MIGRATIONS.slice(0, 3);
    const runnerV3 = new MigrationRunner(freshConn, v1to3);
    const resV3 = await runnerV3.migrate();
    expect(resV3.currentVersion).toBe(3);

    // Apply Migration 004
    const runnerV4 = new MigrationRunner(freshConn, MIGRATIONS);
    const resV4 = await runnerV4.migrate();
    expect(resV4.appliedCount).toBe(1);
    expect(resV4.currentVersion).toBe(4);

    freshConn.close();
  });

  it('enforces ON DELETE RESTRICT foreign key constraint when attempting direct SQL deletion of referenced site', () => {
    const rawDb = connection.getRawDb();
    const projectId = crypto.randomUUID();
    const siteId = crypto.randomUUID();
    const fingerprint = 'c'.repeat(64);
    const now = new Date().toISOString();

    // 1. Create project and site
    rawDb
      .prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(projectId, 'FK Test Project', now, now);

    rawDb
      .prepare(
        'INSERT INTO sites (id, project_id, name, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(siteId, projectId, 'FK Test Site', 'https://fk-test.example.com', now, now);

    // 2. Insert triage state and event referencing siteId
    const eventId = crypto.randomUUID();
    rawDb
      .prepare(
        `INSERT INTO finding_triage_events (
          id, site_id, finding_fingerprint, revision, status, previous_status,
          reason, created_by, created_at
        ) VALUES (?, ?, ?, 1, 'accepted_risk', 'active', 'FK restriction test reason', 'tester', ?)`,
      )
      .run(eventId, siteId, fingerprint, now);

    rawDb
      .prepare(
        `INSERT INTO finding_triage (
          site_id, finding_fingerprint, revision, status, reason, updated_by, updated_at
        ) VALUES (?, ?, 1, 'accepted_risk', 'FK restriction test reason', 'tester', ?)`,
      )
      .run(siteId, fingerprint, now);

    // 3. Attempt direct SQL deletion of referenced site -> Must fail with FOREIGN KEY constraint failed
    expect(() => {
      rawDb.prepare('DELETE FROM sites WHERE id = ?').run(siteId);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 4. Verify site is still present in sites table
    const siteRow = rawDb.prepare('SELECT id, name FROM sites WHERE id = ?').get(siteId);
    expect(siteRow).toBeDefined();

    // 5. Verify triage state and events remain completely intact
    const triageRow = rawDb
      .prepare('SELECT * FROM finding_triage WHERE site_id = ? AND finding_fingerprint = ?')
      .get(siteId, fingerprint);
    expect(triageRow).toBeDefined();

    const eventRow = rawDb
      .prepare('SELECT * FROM finding_triage_events WHERE id = ?')
      .get(eventId);
    expect(eventRow).toBeDefined();

    // 6. Test isolated ON DELETE RESTRICT with finding_triage_events alone
    const siteOnlyEventId = crypto.randomUUID();
    const eventOnlyId = crypto.randomUUID();
    rawDb
      .prepare(
        'INSERT INTO sites (id, project_id, name, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        siteOnlyEventId,
        projectId,
        'Site Only Event',
        'https://event-only.example.com',
        now,
        now,
      );

    rawDb
      .prepare(
        `INSERT INTO finding_triage_events (
          id, site_id, finding_fingerprint, revision, status, previous_status,
          reason, created_by, created_at
        ) VALUES (?, ?, ?, 1, 'accepted_risk', 'active', 'Event only reason', 'tester', ?)`,
      )
      .run(eventOnlyId, siteOnlyEventId, fingerprint, now);

    expect(() => {
      rawDb.prepare('DELETE FROM sites WHERE id = ?').run(siteOnlyEventId);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });
});
