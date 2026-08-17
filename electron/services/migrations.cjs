const path = require('node:path');
const { ensureDir, readJson, writeJson } = require('./jsonStore.cjs');

async function migrateProjectV2(projectPath) {
  const projectPathname = path.join(projectPath, 'project.json');
  const project = await readJson(projectPathname, null);
  if (!project || project.schema_version === '2.0') return { migrated: false, project };
  if (project.schema_version && project.schema_version !== '1.0') throw new Error(`Unsupported project schema: ${project.schema_version}`);
  const now = new Date().toISOString();
  const screenId = project.screen_id || 'main';
  const statePath = path.join(projectPath, 'workflow', 'state.json');
  const legacyState = await readJson(statePath, {});
  const backupPath = path.join(projectPath, 'workflow', 'migration-backup-v1.json');
  const migrationLogPath = path.join(projectPath, 'workflow', 'migration-log.json');
  const existingLog = await readJson(migrationLogPath, []);
  await writeJson(backupPath, { captured_at: now, project, workflow: legacyState });
  await ensureDir(path.join(projectPath, 'screens', screenId));
  await writeJson(path.join(projectPath, 'screens', 'index.json'), {
    schema_version: '2.0', active_screen_id: screenId,
    screens: [{ id: screenId, name: screenId === 'main' ? '主页面' : screenId, status: 'active', created_at: project.created_at || now, updated_at: now }]
  });
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
    migration: { from: '1.0', migrated_at: now, legacy_visuals: true }, updated_at: now
  };
  const nextState = {
    ...legacyState, schema_version: '2.0', active_screen_id: screenId,
    global_stages: globalStages, screen_stages: { [screenId]: screenStages }, updated_at: now
  };
  await writeJson(projectPathname, nextProject);
  await writeJson(statePath, nextState);
  await writeJson(migrationLogPath, [{ from: '1.0', to: '2.0', status: 'completed', migrated_at: now, backup: 'workflow/migration-backup-v1.json' }, ...existingLog]);
  return { migrated: true, project: nextProject };
}

module.exports = { migrateProjectV2 };

