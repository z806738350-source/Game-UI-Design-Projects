#!/usr/bin/env node
// v1.4 §13.8 受控真实多模态评估：对 intent-analysis-v2 的真实模型表现做
// 结构化评估。本脚本不进普通 CI（依赖外部模型与私有基准素材），只在本地
// 显式配置后运行：
//
//   INTENT_BENCHMARK_DIR=/local/private/path \
//   INTENT_BENCHMARK_MANIFEST=/local/private/path/manifest.json \
//   node scripts/evaluate-intent-prefill.cjs
//
// manifest 形状：
//   {
//     "defaults": { "repeat": 3, "project_type": "existing-strict" },
//     "cases": [{
//       "id": "ue10-boss-progress",        // 报告只用 id，不记录用户素材内容
//       "image": "ue10.png",               // 相对 INTENT_BENCHMARK_DIR
//       "repeat": 20,                      // 覆盖 defaults
//       "project_type": "existing-strict", // 覆盖 defaults
//       "expect": [{
//         "id": "layer-modal",
//         "description": "背景框架 + 主体弹窗层级",
//         "section": "screen_layers",      // 或 "uncertainties"
//         "kind_contains": "modal",        // layers 按 kind 匹配
//         "text_contains": "挑战",          // 条目文本/问题匹配
//         "uncertainty_category": "reward_rules",
//         "threshold": 0.95                // 可选：低于阈值的项需逐条 triage
//       }]
//     }]
//   }
//
// 指标口径（§13.8）：内容质量指标只在成功 analysis 上计算，provider 失败
// 单独报告；任一项低于阈值不自动放行也不一票否决，失败逐条留档供 triage。
const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error([
    'usage: INTENT_BENCHMARK_DIR=<dir> INTENT_BENCHMARK_MANIFEST=<manifest.json> node scripts/evaluate-intent-prefill.cjs',
    'controlled real-model evaluation (v1.4 §13.8); never part of ordinary CI.'
  ].join('\n'));
}

function processValue(raw) {
  const intent = require('../electron/services/intentAnalysis.cjs');
  const normalized = intent.normalizeIntentAnalysis(raw);
  if (!normalized.value) {
    return { value: null, errors: normalized.errors, warnings: normalized.warnings, repairContext: raw };
  }
  const policy = intent.applyUnsupportedClaimPolicy(normalized.value);
  return { value: policy.value, errors: [], warnings: [...normalized.warnings, ...policy.warnings] };
}

function sixSectionsPresent(value) {
  if (!value || typeof value !== 'object') return false;
  if (!String(value.page_purpose || '').trim()) return false;
  for (const key of ['player_tasks', 'core_flow', 'screen_layers']) {
    if (!Array.isArray(value[key]) || !value[key].length) return false;
  }
  const visible = (Array.isArray(value.visible_controls) ? value.visible_controls.length : 0)
    + (Array.isArray(value.visible_information_and_states) ? value.visible_information_and_states.length : 0);
  if (!visible) return false;
  return Array.isArray(value.uncertainty_audit) && value.uncertainty_audit.length === 8;
}

function expectPasses(expect, value) {
  const entries = Array.isArray(value[expect.section]) ? value[expect.section] : [];
  if (expect.kind_contains) {
    return entries.some((entry) => String(entry.kind || '').includes(expect.kind_contains));
  }
  if (expect.uncertainty_category) {
    return entries.some((entry) => entry.category === expect.uncertainty_category);
  }
  if (expect.text_contains) {
    return entries.some((entry) => {
      const haystack = [entry.text, entry.visible_label, entry.visible_text, entry.name, entry.question]
        .filter((field) => typeof field === 'string').join(' ');
      return haystack.includes(expect.text_contains);
    });
  }
  return entries.length > 0;
}

async function runOnce(kunpoClient, config, prompt, imagePaths) {
  const startedAt = Date.now();
  try {
    const envelope = await kunpoClient.requestJson({ ...config }, {
      prompt, imagePaths, captureMeta: true,
      failureCode: 'INTENT_ANALYSIS_INVALID',
      processValue
    });
    return {
      ok: true, durationMs: Date.now() - startedAt,
      value: envelope.value, warnings: envelope.warnings || [],
      provider: envelope.provider || null
    };
  } catch (error) {
    return { ok: false, durationMs: Date.now() - startedAt, error_code: error.code || 'PROVIDER_ERROR', message: String(error.message || error) };
  }
}

async function main() {
  const benchmarkDir = process.env.INTENT_BENCHMARK_DIR;
  const manifestPath = process.env.INTENT_BENCHMARK_MANIFEST;
  if (!benchmarkDir || !manifestPath) { usage(); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const defaults = manifest.defaults || {};

  const projectRoot = path.join(__dirname, '..');
  const { loadKunpoConfig } = require('../electron/services/env.cjs');
  const config = loadKunpoConfig(projectRoot);
  if (!config.configured) throw new Error('Kunpo is not configured (.env).');
  const kunpoClient = require('../electron/services/kunpoClient.cjs');
  const { intentAnalysisV2Prompt } = require('../electron/services/prompts.cjs');

  const cases = [];
  for (const spec of manifest.cases || []) {
    const imagePath = path.resolve(benchmarkDir, spec.image);
    if (!fs.existsSync(imagePath)) throw new Error(`benchmark image missing: ${spec.image} (case ${spec.id})`);
    const repeat = Number(spec.repeat ?? defaults.repeat ?? 3);
    const project = {
      name: `intent-eval:${spec.id}`,
      project_type: spec.project_type || defaults.project_type || 'existing-strict',
      requirement: '', wireframe_path: imagePath
    };
    const prompt = intentAnalysisV2Prompt(project);
    const runs = [];
    for (let index = 0; index < repeat; index += 1) {
      const run = await runOnce(kunpoClient, config, prompt, [imagePath]);
      run.index = index + 1;
      if (run.ok) {
        run.six_sections_present = sixSectionsPresent(run.value);
        run.expect_results = (spec.expect || []).map((expect) => ({ id: expect.id, pass: expectPasses(expect, run.value) }));
        delete run.value; // 报告不落盘模型全文，只留结构化指标
      }
      runs.push(run);
      console.error(`[${spec.id}] run ${index + 1}/${repeat}: ${run.ok ? 'ok' : `failed (${run.error_code})`}`);
    }

    const successes = runs.filter((run) => run.ok);
    const expectSummary = (spec.expect || []).map((expect) => {
      const passCount = successes.filter((run) => run.expect_results.some((entry) => entry.id === expect.id && entry.pass)).length;
      const rate = successes.length ? passCount / successes.length : 0;
      return {
        id: expect.id, description: expect.description || expect.id,
        pass: passCount, of: successes.length, rate: Number(rate.toFixed(3)),
        threshold: expect.threshold ?? null,
        below_threshold: expect.threshold != null && rate < expect.threshold
      };
    });
    cases.push({
      id: spec.id, repeat,
      success_runs: successes.length,
      provider_failures: runs.filter((run) => !run.ok).map((run) => ({ run: run.index, error_code: run.error_code })),
      six_sections_rate: successes.length ? Number((successes.filter((run) => run.six_sections_present).length / successes.length).toFixed(3)) : 0,
      dangling_evidence_warnings: successes.reduce((count, run) => count + run.warnings.length, 0),
      expect: expectSummary,
      runs
    });
  }

  const report = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    provider: kunpoClient.safeConfig(config),
    prompt_task_kind: 'intent-analysis-v2',
    cases
  };
  const reportDir = path.join(benchmarkDir, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `intent-prefill-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // 控制台只输出结构化摘要（阈值未达标的项需要逐条 triage，见 §13.8）。
  const summary = {
    report_path: reportPath,
    cases: cases.map(({ id, repeat, success_runs, six_sections_rate, expect, provider_failures }) => ({
      id, repeat, success_runs, six_sections_rate, provider_failures: provider_failures.length,
      expect: expect.map(({ id: expectId, pass, of, rate, threshold, below_threshold }) => ({ id: expectId, pass, of, rate, threshold, below_threshold }))
    })),
    triage_required: cases.some((entry) => entry.expect.some((item) => item.below_threshold))
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }));
  process.exitCode = 1;
});
