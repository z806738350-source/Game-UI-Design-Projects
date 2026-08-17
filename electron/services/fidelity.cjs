const { reviewGate } = require('./underlayCritique.cjs');
const { validateFontManifest } = require('./typographyAssets.cjs');

function runFidelityChecks({ project, manifest, output, outputVerification, inspection, bindings, fontManifest, critique, dependencies = [] }) {
  const issues = [];
  const add = (severity, code, message) => issues.push({ severity, code, message });
  const componentControls = new Set((manifest?.layers || []).filter((layer) => layer.type === 'component').map((layer) => layer.control_id));
  const renderedTypography = new Map((output?.render_log?.layers || []).filter((layer) => layer.font_role).map((layer) => [`${layer.control_id}:${layer.font_role}`, layer]));
  for (const binding of bindings?.bindings || []) if (!componentControls.has(binding.control_id)) add('blocker', 'MISSING_RENDERED_CONTROL', `Control ${binding.control_id} is not rendered.`);
  const gate = reviewGate(critique);
  for (const issue of gate.blocking) add(issue.severity === 'blocker' ? 'blocker' : 'critical', 'UNDERLAY_REVIEW_FAILED', issue.reason || issue.type);
  for (const error of validateFontManifest(fontManifest, { strict: project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation' })) add('critical', 'TYPOGRAPHY_GATE_FAILED', error);
  for (const layer of manifest?.layers || []) {
    if (layer.type === 'component' && !/^sha256:[a-f0-9]{64}$/i.test(layer.asset_hash || '')) add('critical', 'COMPONENT_ASSET_UNIDENTIFIED', `${layer.component_id} has no valid asset hash.`);
    if (layer.type === 'text' && layer.fidelity_mode === 'unresolved') add('critical', 'UNRESOLVED_IDENTITY_FONT', `${layer.font_role} is unresolved.`);
    if (layer.type === 'text' && layer.fidelity_mode === 'exact') {
      const rendered = renderedTypography.get(`${layer.control_id}:${layer.font_role}`);
      if (!rendered?.actual_font_verified) add('critical', 'FONT_RENDER_NOT_VERIFIED', `${layer.font_role} was not rendered with a verified font file.`);
      else {
        if (rendered.font_hash !== layer.font_hash) add('critical', 'FONT_RENDER_HASH_MISMATCH', `${layer.font_role} rendered with a different font hash.`);
        if (rendered.actual_loaded_family !== layer.font_family) add('critical', 'FONT_RENDER_FAMILY_MISMATCH', `${layer.font_role} rendered with ${rendered.actual_loaded_family || '<unknown>'} instead of ${layer.font_family || '<unknown>'}.`);
      }
    }
  }
  if (!inspection) for (const issue of outputVerification?.issues || []) add('blocker', issue.code, issue.message);
  for (const issue of inspection?.issues || []) issues.push(issue);
  if (!output) add('blocker', 'COMPOSITION_OUTPUT_MISSING', 'Composition Output is missing.');
  else {
    if (manifest?.output?.artifact_id !== output.id || manifest?.output?.hash !== output.hash || manifest?.output?.path !== output.path) add('blocker', 'COMPOSITION_OUTPUT_REFERENCE_MISMATCH', 'Composition Manifest does not reference the current Composition Output.');
    if (manifest?.mode !== output.mode) add('blocker', 'COMPOSITION_OUTPUT_MODE_MISMATCH', 'Composition Manifest and Output modes differ.');
  }
  for (const dependency of dependencies) if (!dependency || dependency.status === 'stale') add('blocker', 'STALE_DEPENDENCY', `${dependency?.id || 'required artifact'} is stale or missing.`);
  const blocking = issues.filter((issue) => ['blocker', 'critical', 'major'].includes(issue.severity));
  return {
    schema_version: '2.0', id: `${project.screen_id}-fidelity-report`, version: 1, status: blocking.length ? 'reviewed' : 'passed',
    source: { composition_manifest: manifest?.id, composition_manifest_version: manifest?.version, composition_output: output?.id, composition_output_version: output?.version, composition_output_hash: output?.hash, underlay_critique: critique?.id },
    output: output ? { path: output.path, hash: output.hash, width: output.width, height: output.height, renderer_version: output.renderer_version, verified: Boolean(outputVerification?.passed) } : { verified: false },
    coverage: { required_controls: bindings?.coverage?.required_controls || 0, rendered_controls: componentControls.size },
    underlay: { critique_id: critique?.id, result: gate.passed ? 'passed' : 'failed', manual_waivers: critique?.manual_waivers || [] },
    typography: { identity_critical_roles: Object.values(fontManifest?.roles || {}).filter((role) => role.identity_critical).length, exact_roles: Object.values(fontManifest?.roles || {}).filter((role) => role.identity_critical && role.fidelity_mode === 'exact').length, actual_verified_layers: [...renderedTypography.values()].filter((layer) => layer.actual_font_verified).length },
    manifest_consistency: { passed: !(inspection?.issues || []).some((issue) => issue.category === 'manifest-consistency'), checks: (inspection?.issues || []).filter((issue) => issue.category === 'manifest-consistency') },
    visual_fidelity: { passed: !(inspection?.issues || []).some((issue) => issue.category === 'visual-fidelity'), checks: (inspection?.issues || []).filter((issue) => issue.category === 'visual-fidelity') },
    evidence: inspection?.evidence, evidence_digest: inspection?.evidence_digest,
    checks: ['composition-output', 'decoded-pixels', 'alpha', 'asset-rehash', 'rendered-bbox', 'overlap', 'safe-area', 'text-overflow', 'nine-slice-fixed-regions', 'control-coverage', 'underlay-gate', 'font-render-evidence', 'dependency-freshness'], issues,
    manual_review: { required: issues.some((issue) => issue.severity === 'major'), approved: false }
  };
}

function finalApprovalGate(report, { evidenceDigest } = {}) {
  const blocking = (report?.issues || []).filter((issue) => ['blocker', 'critical'].includes(issue.severity) || (issue.severity === 'major' && !issue.approved));
  if (evidenceDigest && report?.evidence_digest !== evidenceDigest) blocking.push({ severity: 'blocker', code: 'FIDELITY_EVIDENCE_STALE', message: 'The approved Fidelity Report does not match current files and pixels.' });
  return { passed: report?.status === 'passed' && blocking.length === 0 && (!report.manual_review?.required || report.manual_review.approved), blocking };
}

module.exports = { finalApprovalGate, runFidelityChecks };
