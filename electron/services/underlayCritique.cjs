function issue(severity, type, input = {}) {
  return { severity, type, slot_id: input.slot_id, bbox: input.bbox, confidence: input.confidence, reason: input.reason || type, action: input.action || (severity === 'critical' ? 'regenerate-or-inpaint' : 'manual-review') };
}

function asserted(value) {
  return value === true || (Number.isFinite(Number(value)) && Number(value) > 0.5) || (typeof value === 'string' && !/^(false|none|low|no)$/i.test(value));
}

function confidenceSeverity(confidence, { critical = 0.85, major = 0.7 } = {}) {
  if (confidence == null) return 'major';
  const value = Number(confidence);
  if (!Number.isFinite(value)) return 'major';
  if (value >= critical) return 'critical';
  if (value >= major) return 'major';
  return 'minor';
}

function metricExceedsThreshold(metric = {}, thresholds = {}, keys) {
  return keys.some((key) => Number(metric[key]) > Number(thresholds[key] ?? 1));
}

function buildUnderlayCritique({ screenId, underlayId, contract, deterministic = {}, semantic = {}, evidence = {}, strict = true }) {
  const issues = [];
  if (strict && (!evidence.underlay?.hash || !evidence.overlay?.hash || !evidence.component_board?.hash)) issues.push(issue('blocker', 'incomplete-review-inputs', { reason: 'Strict critique requires hashed Underlay, Review Overlay, and component board evidence.' }));
  if (!semantic || !Number.isFinite(Number(semantic.confidence))) issues.push(issue('major', 'missing-semantic-evidence', { reason: 'Underlay critique must include independent semantic evidence.' }));
  for (const finding of semantic.suspected_ui_regions || []) issues.push(issue(confidenceSeverity(finding.confidence), finding.type || 'ui-like', finding));
  for (const finding of semantic.text_like_regions || []) issues.push(issue(confidenceSeverity(finding.confidence, { critical: 0.85, major: 0.7 }), 'text-like', finding));
  for (const region of contract.reserved_regions || []) {
    const metric = deterministic.slots?.[region.slot_id] || {};
    const semanticSlot = (semantic.slot_checks || []).find((item) => item.slot_id === region.slot_id) || {};
    const thresholds = deterministic.thresholds || {};
    if (semanticSlot.subject_overlap) issues.push(issue(
      semanticSlot.subject_overlap_confidence == null
        ? 'critical'
        : confidenceSeverity(semanticSlot.subject_overlap_confidence, { critical: 0.85, major: 0.7 }),
      'subject-overlap', { ...semanticSlot, slot_id: region.slot_id, bbox: region.bbox, confidence: semanticSlot.subject_overlap_confidence }
    ));
    if (semanticSlot.ui_like_contamination?.detected) issues.push(issue(confidenceSeverity(semanticSlot.ui_like_contamination.confidence, { critical: 0.8, major: 0.7 }), semanticSlot.ui_like_contamination.type || 'ui-like', { slot_id: region.slot_id, bbox: region.bbox, confidence: semanticSlot.ui_like_contamination.confidence }));
    if (asserted(semanticSlot.background_busyness)) {
      const corroborated = metricExceedsThreshold(metric, thresholds, ['edge_density', 'local_contrast', 'color_complexity']);
      issues.push(issue(corroborated ? 'major' : 'minor', corroborated ? 'background-busyness' : 'semantic-background-busyness-unconfirmed', { slot_id: region.slot_id, bbox: region.bbox, reason: corroborated ? 'Semantic busyness is corroborated by pixel metrics.' : 'Semantic busyness is below deterministic warning thresholds.' }));
    }
    if (asserted(semanticSlot.contrast_conflict)) {
      const corroborated = metricExceedsThreshold(metric, thresholds, ['local_contrast', 'highlight_density']);
      issues.push(issue(corroborated ? 'major' : 'minor', corroborated ? 'contrast-conflict' : 'semantic-contrast-unconfirmed', { slot_id: region.slot_id, bbox: region.bbox, reason: corroborated ? 'Semantic contrast conflict is corroborated by pixel metrics.' : 'Semantic contrast conflict is below deterministic warning thresholds.' }));
    }
    if (asserted(semanticSlot.hard_edge_crossing)) {
      const corroborated = Number(metric.hard_edge_crossing) > Math.min(0.05, Number(thresholds.hard_edge_crossing ?? 0.2) * 0.5);
      issues.push(issue(corroborated ? 'critical' : 'minor', corroborated ? 'hard-edge-crossing' : 'semantic-hard-edge-unconfirmed', { slot_id: region.slot_id, bbox: region.bbox, reason: corroborated ? 'Semantic hard-edge crossing is corroborated by perimeter pixels.' : 'Semantic hard-edge claim is not corroborated by perimeter pixels.' }));
    }
    if (Number(metric.edge_density) > Number(thresholds.edge_density ?? 0.22) || Number(metric.local_contrast) > Number(thresholds.local_contrast ?? 0.32) || Number(metric.color_complexity) > Number(thresholds.color_complexity ?? 0.42)) issues.push(issue('major', 'background-busyness', { slot_id: region.slot_id, bbox: region.bbox, reason: `edge=${metric.edge_density || 0}, contrast=${metric.local_contrast || 0}, color=${metric.color_complexity || 0}` }));
    if (Number(metric.highlight_density) > Number(thresholds.highlight_density ?? 0.18)) issues.push(issue('major', 'highlight-conflict', { slot_id: region.slot_id, bbox: region.bbox, reason: `highlight=${metric.highlight_density}` }));
    if (Number(metric.hard_edge_crossing) > Number(thresholds.hard_edge_crossing ?? 0.2)) issues.push(issue('critical', 'hard-edge-crossing', { slot_id: region.slot_id, bbox: region.bbox, reason: `perimeter-edge=${metric.hard_edge_crossing}` }));
  }
  if (Number.isFinite(Number(semantic.confidence)) && Number(semantic.confidence) < 0.6) issues.push(issue('major', 'low-critique-confidence', { confidence: semantic.confidence, reason: 'Semantic critique confidence is below 0.6.' }));
  const normalizedIssues = issues.map((item, index) => ({ ...item, issue_id: `${underlayId}-issue-${index + 1}` }));
  const failed = normalizedIssues.some((item) => ['blocker', 'critical', 'major'].includes(item.severity));
  const manualReview = normalizedIssues.some((item) => ['missing-semantic-evidence', 'low-critique-confidence', 'incomplete-review-inputs'].includes(item.type));
  return {
    schema_version: '2.0', id: `${screenId}-underlay-critique-${underlayId}`, version: 1, status: 'reviewed',
    source: { underlay: underlayId, underlay_contract: contract.id, prompt_hash: evidence.prompt_hash, model: evidence.model },
    global_scan: { suspected_ui_regions: semantic.suspected_ui_regions || [], text_like_regions: semantic.text_like_regions || [] },
    slot_checks: semantic.slot_checks || [], deterministic_metrics: deterministic, evidence, issues: normalizedIssues,
    result: manualReview ? 'manual-review' : failed ? 'failed' : 'passed', manual_review: { required: manualReview, approved: false }, manual_waivers: []
  };
}

function reviewGate(critique) {
  const waived = new Set((critique?.manual_waivers || []).filter((waiver) => typeof waiver.reason === 'string' && waiver.reason.trim().length >= 10).map((waiver) => waiver.issue_id));
  const blocking = (critique?.issues || []).map((item, index) => ({ ...item, issue_id: item.issue_id || `issue-${index + 1}` })).filter((item) => ['blocker', 'critical', 'major'].includes(item.severity) && !waived.has(item.issue_id));
  const manualBlocked = critique?.manual_review?.required && !critique?.manual_review?.approved;
  return { passed: !manualBlocked && (critique?.result === 'passed' || blocking.length === 0), blocking: manualBlocked ? [...blocking, { severity: 'major', type: 'manual-review-required', reason: 'Critique requires manual review.' }] : blocking };
}

module.exports = { buildUnderlayCritique, reviewGate };
