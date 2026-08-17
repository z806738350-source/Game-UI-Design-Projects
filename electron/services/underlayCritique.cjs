function issue(severity, type, input = {}) {
  return { severity, type, slot_id: input.slot_id, bbox: input.bbox, confidence: input.confidence, reason: input.reason || type, action: input.action || (severity === 'critical' ? 'regenerate-or-inpaint' : 'manual-review') };
}

function buildUnderlayCritique({ screenId, underlayId, contract, deterministic = {}, semantic = {} }) {
  const issues = [];
  for (const finding of semantic.suspected_ui_regions || []) issues.push(issue(finding.confidence >= 0.75 ? 'critical' : 'major', finding.type || 'ui-like', finding));
  for (const finding of semantic.text_like_regions || []) issues.push(issue(finding.confidence >= 0.8 ? 'critical' : 'major', 'text-like', finding));
  for (const region of contract.reserved_regions || []) {
    const metric = deterministic.slots?.[region.slot_id] || {};
    const semanticSlot = (semantic.slot_checks || []).find((item) => item.slot_id === region.slot_id) || {};
    if (semanticSlot.subject_overlap) issues.push(issue('critical', 'subject-overlap', { ...semanticSlot, slot_id: region.slot_id, bbox: region.bbox }));
    if (semanticSlot.ui_like_contamination?.detected) issues.push(issue(semanticSlot.ui_like_contamination.confidence >= 0.75 ? 'critical' : 'major', semanticSlot.ui_like_contamination.type || 'ui-like', { slot_id: region.slot_id, bbox: region.bbox, confidence: semanticSlot.ui_like_contamination.confidence }));
    if (Number(metric.edge_density) > 0.35 || Number(metric.local_contrast) > 0.45 || Number(metric.color_complexity) > 0.6) issues.push(issue('major', 'background-busyness', { slot_id: region.slot_id, bbox: region.bbox, reason: `edge=${metric.edge_density || 0}, contrast=${metric.local_contrast || 0}, color=${metric.color_complexity || 0}` }));
  }
  if (Number(semantic.confidence || 1) < 0.6) issues.push(issue('major', 'low-critique-confidence', { confidence: semantic.confidence, reason: 'Semantic critique confidence is below 0.6.' }));
  const failed = issues.some((item) => ['blocker', 'critical', 'major'].includes(item.severity));
  return {
    schema_version: '2.0', id: `${screenId}-underlay-critique-${underlayId}`, version: 1, status: 'reviewed',
    source: { underlay: underlayId, underlay_contract: contract.id },
    global_scan: { suspected_ui_regions: semantic.suspected_ui_regions || [], text_like_regions: semantic.text_like_regions || [] },
    slot_checks: semantic.slot_checks || [], deterministic_metrics: deterministic, issues,
    result: failed ? 'failed' : 'passed', manual_waivers: []
  };
}

function reviewGate(critique) {
  const waived = new Set((critique?.manual_waivers || []).filter((waiver) => typeof waiver.reason === 'string' && waiver.reason.trim().length >= 10).map((waiver) => waiver.issue_id));
  const blocking = (critique?.issues || []).map((item, index) => ({ ...item, issue_id: item.issue_id || `issue-${index + 1}` })).filter((item) => ['blocker', 'critical', 'major'].includes(item.severity) && !waived.has(item.issue_id));
  return { passed: critique?.result === 'passed' || blocking.length === 0, blocking };
}

module.exports = { buildUnderlayCritique, reviewGate };

