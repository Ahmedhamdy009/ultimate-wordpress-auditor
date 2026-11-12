import type { MigrationDefinition } from './types.js';

export const MIGRATIONS: readonly MigrationDefinition[] = Object.freeze([
  {
    version: 1,
    name: '001_initial_schema',
    up: `
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(name) >= 1 AND length(name) <= 100),
  CHECK (is_archived IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_active_name
  ON projects(LOWER(name))
  WHERE is_archived = 0;

CREATE INDEX IF NOT EXISTS idx_projects_list
  ON projects(is_archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  platform_type TEXT NOT NULL DEFAULT 'wordpress',
  environment_type TEXT NOT NULL DEFAULT 'production',
  description TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CHECK (length(name) >= 1 AND length(name) <= 100),
  CHECK (length(base_url) >= 1 AND length(base_url) <= 2048),
  CHECK (platform_type IN ('wordpress', 'generic_web', 'custom')),
  CHECK (environment_type IN ('production', 'staging', 'development', 'local')),
  CHECK (is_archived IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sites_project_base_url
  ON sites(project_id, LOWER(base_url))
  WHERE is_archived = 0;

CREATE INDEX IF NOT EXISTS idx_sites_project_list
  ON sites(project_id, is_archived, updated_at DESC);
`.trim(),
  },
  {
    version: 2,
    name: '002_scan_history_and_findings',
    up: `
CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  scan_type TEXT NOT NULL,
  status TEXT NOT NULL,
  target_url TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  duration_ms INTEGER,
  config_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE RESTRICT,
  CHECK (length(target_url) >= 1 AND length(target_url) <= 2048),
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_site_id
  ON scan_runs(site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_runs_status
  ON scan_runs(status);

CREATE INDEX IF NOT EXISTS idx_scan_runs_created_at
  ON scan_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  target_url TEXT NOT NULL,
  evidence_json TEXT,
  remediation TEXT,
  references_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
  CHECK (length(title) >= 1 AND length(title) <= 255),
  CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info', 'informational')),
  CHECK (confidence IN ('confirmed', 'firm', 'tentative', 'potential', 'high', 'medium', 'low')),
  CHECK (status IN ('active', 'resolved', 'false_positive', 'ignored', 'confirmed', 'potential', 'needs_manual_review', 'fixed', 'accepted_risk', 'retest_required'))
);

CREATE INDEX IF NOT EXISTS idx_findings_scan_run_id
  ON findings(scan_run_id, severity);

CREATE INDEX IF NOT EXISTS idx_findings_severity
  ON findings(severity);

CREATE INDEX IF NOT EXISTS idx_findings_category
  ON findings(category);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  storage_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id) ON DELETE RESTRICT,
  CHECK (format IN ('json', 'html', 'pdf')),
  CHECK (status IN ('pending', 'generated', 'failed')),
  CHECK (length(title) >= 1 AND length(title) <= 255)
);

CREATE INDEX IF NOT EXISTS idx_reports_scan_run_id
  ON reports(scan_run_id);

CREATE INDEX IF NOT EXISTS idx_reports_status
  ON reports(status);
`.trim(),
  },
  {
    version: 3,
    name: '003_add_csv_report_format',
    up: `
CREATE TABLE IF NOT EXISTS reports_new (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  storage_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scan_run_id) REFERENCES scan_runs(id) ON DELETE RESTRICT,
  CHECK (format IN ('json', 'html', 'pdf', 'csv')),
  CHECK (status IN ('pending', 'generated', 'failed')),
  CHECK (length(title) >= 1 AND length(title) <= 255)
);

INSERT INTO reports_new (id, scan_run_id, title, format, status, summary_json, storage_path, created_at, updated_at)
  SELECT id, scan_run_id, title, format, status, summary_json, storage_path, created_at, updated_at FROM reports;

DROP TABLE reports;

ALTER TABLE reports_new RENAME TO reports;

CREATE INDEX IF NOT EXISTS idx_reports_scan_run_id
  ON reports(scan_run_id);

CREATE INDEX IF NOT EXISTS idx_reports_status
  ON reports(status);
`.trim(),
  },
]);
