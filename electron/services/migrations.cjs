const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ensureDir, readJson, writeJson } = require('./jsonStore.cjs');

const MIGRATION_FAULT_POINTS = Object.freeze([
  'after-backup', 'after-stage-copy', 'after-screen-index', 'after-project',
  'after-state', 'after-log', 'after-original-rename', 'after-stage-promote'
]);

async function pathExists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

async function validateStagedMigration(stagingPath, screenId) {
  const project = await readJson(path.join(stagingPath, 'project.json'), null);
  const registry = await readJson(path.join(stagingPath, 'screens', 'index.json'), null);
  const state = await readJson(path.join(stagingPath, 'workflow', 'state.json'), null);
  if (project?.schema_version !== '2.0' || project.active_screen_id !== screenId) throw new Error('Staged project schema validation failed.');
  if (registry?.schema_version !== '2.0' || registry.active_screen_id !== screenId || !registry.screens?.some((screen) => screen.id === screenId)) throw new Error('Staged screen registry validation failed.');
  if (state?.schema_version !== '2.0' || state.active_screen_id !== screenId || !state.screen_stages?.[screenId]) throw new Error('Staged workflow validation failed.');
}

async function migrateProjectV2(projectPath, options = {}) {
  const sourcePath = path.resolve(projectPath);
  const projectPathname = path.join(sourcePath, 'project.json');
  const project = await readJson(projectPathname, null);
  if (!project || project.schema_version === '2.0') return { migrated: false, project };
  if (project.schema_version && project.schema_version !== '1.0') throw new Error(`Unsupported project schema: ${project.schema_version}`);
  const now = new Date().toISOString();
  const screenId = project.screen_id || 'main';
  const statePath = path.join(sourcePath, 'workflow', 'state.json');
  const legacyState = await readJson(statePath, {});
  const parentPath = path.dirname(sourcePath);
  const basename = path.basename(sourcePath);
  if (!basename || sourcePath === parentPath) throw new Error('Migration requires a concrete project directory.');
  const transactionId = String(options.transactionId || `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`).replace(/[^A-Za-z0-9_-]/g, '-');
  const backupPath = path.join(parentPath, `.${basename}.backup-v1-${transactionId}`);
  const stagingPath = path.join(parentPath, `.${basename}.migration-${transactionId}`);
  const rollbackPath = path.join(parentPath, `.${basename}.rollback-${transactionId}`);
  const failedLogPath = path.join(parentPath, `${basename}.migration-failed.json`);
  const migrationLogPath = path.join(sourcePath, 'workflow', 'migration-log.json');
  const existingLog = await readJson(migrationLogPath, []);
  let backupCompleted = false;
  let originalMoved = false;
  let stagePromoted = false;
  const checkpoint = async (point) => {
    if (typeof options.faultInjector === 'function') await options.faultInjector(point);
    if (options.faultAt === point) throw Object.assign(new Error(`Injected migration failure at ${point}.`), { code: 'MIGRATION_FAULT_INJECTED', fault_point: point });
  };
  try {
    await fs.cp(sourcePath, backupPath, { recursive: true, errorOnExist: true, force: false });
    backupCompleted = true;
    await checkpoint('after-backup');
    await fs.cp(sourcePath, stagingPath, { recursive: true, errorOnExist: true, force: false });
    await checkpoint('after-stage-copy');
    await ensureDir(path.join(stagingPath, 'screens', screenId));
    await writeJson(path.join(stagingPath, 'screens', 'index.json'), {
      schema_version: '2.0', active_screen_id: screenId,
      screens: [{ id: screenId, name: screenId === 'main' ? '主页面' : screenId, status: 'active', created_at: project.created_at || now, updated_at: now }]
    });
    await checkpoint('after-screen-index');
    const globalStages = {
      input: legacyState.stages?.input || { status: 'draft' },
      reference_analysis: { status: project.project_type === 'existing' ? 'blocked' : 'draft' },
      style_resolution: legacyState.stages?.style_resolution || { status: 'draft' },
      typography_resolution: { status: project.project_type === 'existing' ? 'blocked' : 'draft' },
      component_resolution: { status: project.project_type === 'existing' ? 'blocked' : 'draft' }
    };
    const screenStages = {
      screen_definition: legacyState.stages?.wireframe_interpretation || { status: 'draft' },
      component_binding: { status: project.project_type === 'existing' ? 'blocked' : 'draft' },
      layout_design: legacyState.stages?.layout_design || { status: 'draft' },
      underlay_specification: { status: 'draft' }, underlay_generation: { status: 'draft' },
      underlay_review: { status: 'draft' }, composition: { status: 'draft' }, fidelity_review: { status: 'draft' },
      visual_exploration: legacyState.stages?.visual_exploration || { status: 'draft' }
    };
    const nextProject = {
      ...project, schema_version: '2.0', active_screen_id: screenId, screen_id: screenId,
      continuation_mode: project.continuation_mode || (project.project_type === 'existing' ? 'existing-strict' : 'exploration'),
      migration: { from: '1.0', migrated_at: now, legacy_visuals: true, transaction_id: transactionId }, updated_at: now
    };
    const nextState = {
      ...legacyState, schema_version: '2.0', active_screen_id: screenId,
      global_stages: globalStages, screen_stages: { [screenId]: screenStages }, updated_at: now
    };
    await writeJson(path.join(stagingPath, 'project.json'), nextProject);
    await checkpoint('after-project');
    await writeJson(path.join(stagingPath, 'workflow', 'state.json'), nextState);
    await checkpoint('after-state');
    await writeJson(path.join(stagingPath, 'workflow', 'migration-backup-v1.json'), {
      schema_version: '2.0', captured_at: now, type: 'full-project-directory', path: path.basename(backupPath), transaction_id: transactionId
    });
    await writeJson(path.join(stagingPath, 'workflow', 'migration-log.json'), [{
      from: '1.0', to: '2.0', status: 'completed', migrated_at: now,
      transaction_id: transactionId, backup: path.basename(backupPath), validation: 'passed'
    }, ...existingLog]);
    await checkpoint('after-log');
    await validateStagedMigration(stagingPath, screenId);
    await fs.rename(sourcePath, rollbackPath);
    originalMoved = true;
    await checkpoint('after-original-rename');
    await fs.rename(stagingPath, sourcePath);
    stagePromoted = true;
    await checkpoint('after-stage-promote');
    await fs.rm(rollbackPath, { recursive: true, force: true });
    originalMoved = false;
    return { migrated: true, project: nextProject, backupPath, transactionId };
  } catch (error) {
    let restored = !originalMoved;
    let recoveryError;
    if (originalMoved) {
      try {
        if (stagePromoted && await pathExists(sourcePath)) await fs.rename(sourcePath, stagingPath);
        if (await pathExists(rollbackPath)) await fs.rename(rollbackPath, sourcePath);
        restored = true;
      } catch (cause) {
        restored = false;
        recoveryError = cause;
      }
    }
    if (await pathExists(stagingPath)) await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
    await writeJson(failedLogPath, {
      from: '1.0', to: '2.0', status: 'failed', failed_at: new Date().toISOString(), transaction_id: transactionId,
      fault_point: error.fault_point, reason: error.message, backup: path.basename(backupPath), backup_completed: backupCompleted,
      recovery: { attempted: originalMoved, restored, ...(recoveryError ? { error: recoveryError.message } : {}) }
    });
    error.code ||= 'MIGRATION_TRANSACTION_FAILED';
    error.migration = { transactionId, backupPath, failedLogPath, restored };
    throw error;
  }
}

module.exports = { MIGRATION_FAULT_POINTS, migrateProjectV2, validateStagedMigration };
