// One-shot legacy repair for projects stuck by the pre-fix Layout—Style
// cycle: on layout-first routes (exploration/guided) a regenerated Style
// Contract wrongly invalidated the approved layout, after which neither
// stage could move forward. The dependency-graph fix prevents new cases;
// this module restores already-stuck projects under strict eligibility.
//
// Eligibility (fix-plan P0-07): only layout-first projects whose layout
// artifacts are stale for exactly the legacy reason style_contract_regenerated,
// with an unchanged functional contract, canvas, inputs and source proposal.
// Strict/locked projects and any other stale reason are never repaired.
// The repair is idempotent: a healthy project is returned untouched.

const fs = require('node:fs/promises');
const path = require('node:path');
const { ERROR_CODES } = require('./errorCodes.cjs');
const { validateLayout } = require('./layoutValidator.cjs');
const { profileOf } = require('./pipelineProfile.cjs');
const { artifactRelativePath } = require('./artifactRegistry.cjs');

const REPAIR_VERSION = 'route-cycle-v1';
const LEGACY_REASON = 'style_contract_regenerated';

function createFlowStateRepair({ projectStore }) {
  function ineligible(message) {
    return Object.assign(new Error(message), { code: ERROR_CODES.ROUTE_CYCLE_REPAIR_INELIGIBLE });
  }

  async function readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  // 最近一次非 stale 的 layout-proposals 历史快照决定恢复后的状态；
  // 找不到快照时回退到生成后的常规状态 reviewed。
  async function restoredLayoutStatus(workspacePath) {
    const historyDir = path.join(workspacePath, 'workflow', 'history');
    let names = [];
    try {
      names = await fs.readdir(historyDir);
    } catch {
      return 'reviewed';
    }
    const snapshots = names.filter((name) => name.startsWith('layout-proposals-')).sort();
    for (const name of snapshots.reverse()) {
      const snapshot = await readJson(path.join(historyDir, name), null);
      if (snapshot && snapshot.status !== 'stale') return snapshot.status;
    }
    return 'reviewed';
  }

  async function repairRouteCycle(projectId, input = {}) {
    const screenId = String(input.screenId || '').trim();
    if (!screenId) throw Object.assign(new Error('screenId is required for route-cycle repair.'), { code: ERROR_CODES.SCREEN_ID_REQUIRED });
    const project = await projectStore.open(projectId, { includePreviews: false, screenId });
    if (project.screen_id !== screenId) throw Object.assign(new Error(`Screen context mismatch: activate ${screenId} before repairing it.`), { code: ERROR_CODES.SCREEN_CONTEXT_MISMATCH });
    const workspacePath = project.workspacePath;

    // Strict/locked 路线的布局依赖风格资产，绝不进入本修复。
    const profile = profileOf(project);
    if (profile === 'strict') throw ineligible('严格继承/锁定项目不适用本修复，请重新生成布局链路。');

    const layouts = project.artifacts.layouts;
    const approvedLayout = project.artifacts.approvedLayout;

    // 幂等：链路已经健康时不再改写，重复执行返回 no-op。
    if (layouts?.status !== 'stale' && approvedLayout?.status === 'approved') {
      return { repaired: false, already_repaired: true, screen_id: screenId };
    }
    if (!layouts || layouts.status !== 'stale' || layouts.stale_reason !== LEGACY_REASON) {
      throw ineligible('布局提案不存在，或失效原因不是旧版风格循环缺陷，不能自动修复。');
    }
    if (!approvedLayout || approvedLayout.status !== 'stale' || approvedLayout.stale_reason !== LEGACY_REASON) {
      throw ineligible('已批准布局不存在，或失效原因不是旧版风格循环缺陷，不能自动修复。');
    }
    if (!project.artifacts.styleContract) throw ineligible('缺少 Style Contract，无法确认旧版循环场景，不能自动修复。');
    if (project.artifacts.screenContract?.status !== 'approved') throw ineligible('Functional Screen Contract 不再是批准状态，请重新走功能契约流程。');
    const proposals = layouts.proposals || [];
    if (!proposals.some((proposal) => proposal.id === approvedLayout.source_proposal)) {
      throw ineligible('已批准布局引用的方案已不在当前布局提案中，请重新选择并批准布局。');
    }
    // 画布与输入必须与批准时一致；任何真实变化都意味着布局需要重新生成。
    if (JSON.stringify(approvedLayout.canvas_spec || {}) !== JSON.stringify(project.canvas_spec || {})) {
      throw ineligible('画布规格已变化，旧布局不再可信，请重新生成布局提案。');
    }
    if (JSON.stringify(approvedLayout.input_revisions || {}) !== JSON.stringify(project.input_revisions || {})) {
      throw ineligible('需求或线框输入已变化，旧布局不再可信，请重新生成布局提案。');
    }

    // 恢复前重跑确定性布局校验；失败即拒绝修复，不动任何文件。
    const layoutErrors = validateLayout(approvedLayout, project.artifacts.bindings, project.artifacts.componentContract, project.canvas_spec, { strict: false });
    if (layoutErrors.length) throw ineligible(`布局校验失败，不能自动修复：${layoutErrors.join('; ')}`);

    // 先备份将被改写的状态文件，再写入任何恢复结果。
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(workspacePath, 'workflow', 'repairs', 'backup', `${REPAIR_VERSION}-${stamp}`);
    await fs.mkdir(backupDir, { recursive: true });
    const backupRelativePaths = [];
    for (const [kind, relative] of [['layout-proposals', artifactRelativePath('layout-proposals', screenId)], ['approved-layout', artifactRelativePath('approved-layout', screenId)]]) {
      const sourcePath = path.join(workspacePath, relative);
      try {
        await fs.copyFile(sourcePath, path.join(backupDir, path.basename(relative)));
        backupRelativePaths.push(`workflow/repairs/backup/${REPAIR_VERSION}-${stamp}/${path.basename(relative)}`);
      } catch {
        throw ineligible(`无法备份 ${kind}，修复中止。`);
      }
    }
    const statePath = path.join(workspacePath, 'workflow', 'state.json');
    try {
      await fs.copyFile(statePath, path.join(backupDir, 'state.json'));
      backupRelativePaths.push(`workflow/repairs/backup/${REPAIR_VERSION}-${stamp}/state.json`);
    } catch {
      // state.json 缺失时不阻塞修复；workflow 会在后面重建。
    }

    const previousStatus = {
      layout_proposals: { status: layouts.status, stale_reason: layouts.stale_reason, stale_at: layouts.stale_at },
      approved_layout: { status: approvedLayout.status, stale_reason: approvedLayout.stale_reason, stale_at: approvedLayout.stale_at },
      workflow_layout_design: project.workflow?.stages?.layout_design?.status || null
    };

    const restoredLayoutsStatus = await restoredLayoutStatus(workspacePath);
    const repairedAt = new Date().toISOString();
    const restoredLayouts = { ...layouts, status: restoredLayoutsStatus };
    delete restoredLayouts.stale_at;
    delete restoredLayouts.stale_reason;
    await projectStore.saveArtifact(projectId, 'layout-proposals', restoredLayouts, { screenId });

    const restoredApproved = { ...approvedLayout, status: 'approved', repaired: { version: REPAIR_VERSION, repaired_at: repairedAt } };
    delete restoredApproved.stale_at;
    delete restoredApproved.stale_reason;
    await projectStore.saveArtifact(projectId, 'approved-layout', restoredApproved, { screenId });

    await projectStore.updateWorkflow(projectId, 'layout_design', 'approved', `screens/${screenId}/approved-layout.json`, { screenId });

    const restoredStatus = {
      layout_proposals: { status: restoredLayoutsStatus },
      approved_layout: { status: 'approved' },
      workflow_layout_design: 'approved'
    };

    // 修复台账：追加式记录，保留完整审计链。
    const ledgerRelative = path.join('workflow', 'repairs', `${REPAIR_VERSION}.json`);
    const ledgerPath = path.join(workspacePath, ledgerRelative);
    const ledger = await readJson(ledgerPath, { schema_version: '1.0', repairs: [] });
    ledger.repairs.push({
      repair_version: REPAIR_VERSION,
      screen_id: screenId,
      repaired_at: repairedAt,
      reason: LEGACY_REASON,
      previous_status: previousStatus,
      restored_status: restoredStatus,
      validation: { passed: true, errors: [] },
      backup_paths: backupRelativePaths
    });
    await writeJson(ledgerPath, ledger);

    return {
      repaired: true,
      screen_id: screenId,
      repair_version: REPAIR_VERSION,
      previous_status: previousStatus,
      restored_status: restoredStatus,
      backup_paths: backupRelativePaths,
      ledger_path: ledgerRelative
    };
  }

  return { repairRouteCycle };
}

module.exports = { createFlowStateRepair };
