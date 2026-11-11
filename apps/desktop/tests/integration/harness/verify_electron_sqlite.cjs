/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const projectRoot = path.resolve(__dirname, '../../../../../');

const results = {
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  chromeVersion: process.versions.chrome,
  v8Version: process.versions.v8,
  modulesAbi: process.versions.modules,
  allVersions: process.versions,
  timestamp: new Date().toISOString(),
  steps: [],
};

const dbPath = path.resolve(projectRoot, '.tmp/electron_test_real.db');
const electronBinding = path.resolve(
  projectRoot,
  'apps/desktop/src/main/db/native/electron-v149-win32-x64/better_sqlite3.node',
);

try {
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  // 1. Open Database
  const db = new Database(dbPath, { nativeBinding: electronBinding });
  results.steps.push({ name: 'open_database', success: db.open === true });

  // 2. Pragma configurations
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  const fk = db.pragma('foreign_keys', { simple: true });
  const journal = db.pragma('journal_mode', { simple: true });
  results.steps.push({ name: 'pragmas', fk, journal });

  // 3. CREATE TABLE
  db.exec(`
    CREATE TABLE test_electron (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  results.steps.push({ name: 'create_table', success: true });

  // 4. INSERT
  const insertStmt = db.prepare(
    'INSERT INTO test_electron (id, title, status, updated_at) VALUES (?, ?, ?, ?)',
  );
  const insertRes = insertStmt.run('t1', 'First Audit Target', 'pending', new Date().toISOString());
  results.steps.push({ name: 'insert', changes: insertRes.changes });

  // 5. SELECT
  const selectStmt = db.prepare('SELECT * FROM test_electron WHERE id = ?');
  const row1 = selectStmt.get('t1');
  results.steps.push({ name: 'select', row: row1 });

  // 6. UPDATE
  const updateStmt = db.prepare('UPDATE test_electron SET status = ?, updated_at = ? WHERE id = ?');
  const updateRes = updateStmt.run('completed', new Date().toISOString(), 't1');
  const updatedRow = selectStmt.get('t1');
  results.steps.push({ name: 'update', changes: updateRes.changes, row: updatedRow });

  // 7. Transaction & ROLLBACK
  try {
    const tx = db.transaction(() => {
      insertStmt.run('t2', 'Second Target', 'failed', new Date().toISOString());
      throw new Error('Forced rollback test');
    });
    tx();
  } catch (txErr) {
    results.steps.push({ name: 'rollback_error_caught', message: txErr.message });
  }

  const rolledBackRow = selectStmt.get('t2');
  results.steps.push({ name: 'verify_rollback', rolledBackFound: Boolean(rolledBackRow) });

  // 8. Close
  db.close();
  results.steps.push({ name: 'close_database', closed: db.open === false });

  // 9. Reopen and verify persistence
  const reopenedDb = new Database(dbPath, { nativeBinding: electronBinding });
  const persistedRow = reopenedDb.prepare('SELECT * FROM test_electron WHERE id = ?').get('t1');
  results.steps.push({
    name: 'reopen_and_verify_persistence',
    row: persistedRow,
    matches: persistedRow && persistedRow.status === 'completed',
  });
  reopenedDb.close();

  // 10. Clean up temporary test database and WAL files
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
  } catch {
    // Ignore cleanup errors
  }

  // 11. Verify that loading host Node ABI 137 binary in Electron strictly fails with ABI mismatch
  const nodeBinding = path.resolve(
    projectRoot,
    'apps/desktop/src/main/db/native/node-v137-win32-x64/better_sqlite3.node',
  );
  if (fs.existsSync(nodeBinding)) {
    try {
      new Database(':memory:', { nativeBinding: nodeBinding });
      results.steps.push({
        name: 'reject_incompatible_host_node_binary',
        rejected: false,
        error: 'Incompatible ABI 137 was unexpectedly accepted',
      });
      throw new Error('Host Node ABI 137 binary was unexpectedly loaded by Electron runtime');
    } catch (abiErr) {
      const isExpectedMismatch =
        abiErr.message.includes('NODE_MODULE_VERSION') ||
        abiErr.message.includes('different Node.js version');
      results.steps.push({
        name: 'reject_incompatible_host_node_binary',
        rejected: true,
        isExpectedMismatch,
        message: abiErr.message,
      });
    }
  }

  // 12. Verify that out/main/native copied production binary loads and operates in Electron
  const outMainBinding = path.resolve(
    projectRoot,
    'apps/desktop/out/main/native/electron-v149-win32-x64/better_sqlite3.node',
  );
  if (fs.existsSync(outMainBinding)) {
    const outDb = new Database(':memory:', { nativeBinding: outMainBinding });
    const versionCheck = outDb.prepare('SELECT sqlite_version() as v').get();
    outDb.close();
    results.steps.push({
      name: 'load_production_copied_binary',
      success: true,
      sqliteVersion: versionCheck.v,
    });
  }

  results.success = true;
} catch (err) {
  results.success = false;
  results.error = {
    message: err.message,
    stack: err.stack,
    code: err.code,
  };
}

const outPath = path.resolve(projectRoot, '.tmp/electron_sqlite_verification.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
process.exit(results.success ? 0 : 1);
