// Intent Analysis v2 domain contract (v1.4 execution baseline, PR-I0).
// Pure CommonJS, no I/O: normalization, validation, unsupported-claim policy,
// deterministic review builder/renderer, canonical Intent Context and diff
// helpers. State storage, CAS and file writes live in intentStateStore (PR-I1).
// The enums exported here are the single source of truth; the frontend only
// consumes them, it never re-declares rules.
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Enums and limits (§5)
// ---------------------------------------------------------------------------

const PAGE_TYPES = Object.freeze([
  'full_screen',
  'inner_page',
  'modal_overlay',
  'drawer',
  'popover',
  'hud',
  'announcement',
  'other'
]);

const LAYER_KINDS = Object.freeze([
  'background_frame',
  'primary_content',
  'modal',
  'drawer',
  'popover',
  'overlay',
  'region'
]);

// Layers that require a same-scene backdrop context (§5.3).
const OVERLAY_LAYER_KINDS = Object.freeze(['modal', 'drawer', 'popover', 'overlay']);

const UNCERTAINTY_CATEGORIES = Object.freeze([
  'state_semantics',
  'reward_rules',
  'entry_navigation',
  'unlock_preconditions',
  'resource_economy',
  'interaction_limits',
  'background_behavior',
  'data_source_refresh'
]);

const UNCERTAINTY_PRIORITIES = Object.freeze(['blocking', 'important', 'optional']);
const REVIEW_STATUSES = Object.freeze(['unreviewed', 'answered', 'deferred', 'not_applicable']);
const ORIGINS = Object.freeze(['ai_visible', 'ai_inference', 'designer']);
const CREATED_BY = Object.freeze(['ai', 'policy', 'designer']);
const AUDIT_STATUSES = Object.freeze(['questions_present', 'no_gap_found', 'not_applicable']);
const ENTITY_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

const LIMITS = Object.freeze({
  layers: 12,
  visibleControls: 80,
  visibleInformation: 120,
  playerTasks: 20,
  coreFlow: 30,
  uncertainties: 40,
  textCodePoints: 500,
  maxDepth: 16,
  analysisBytes: 512 * 1024,
  reviewBytes: 256 * 1024,
  candidateBytes: 1024 * 1024
});

// Fields the server stamps itself; the model must not provide them (§5.1).
const SERVER_OWNED_ANALYSIS_FIELDS = Object.freeze([
  'schema_version',
  'analysis_id',
  'generated_at',
  'source_revision',
  'provider',
  'warnings'
]);

// ---------------------------------------------------------------------------
// Text normalization (§5.5)
// ---------------------------------------------------------------------------

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.normalize('NFC').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
}

function textError(label, value) {
  if (typeof value !== 'string' || value.trim().length === 0) return `${label} must be a non-empty string`;
  if ([...value.normalize('NFC')].length > LIMITS.textCodePoints) return `${label} exceeds ${LIMITS.textCodePoints} code points`;
  return null;
}

// ---------------------------------------------------------------------------
// Intent Analysis normalization + validation (§5.2–§5.6)
// ---------------------------------------------------------------------------

function normalizeEntityList(raw, kind, errors) {
  if (!Array.isArray(raw)) {
    errors.push(`${kind} must be an array`);
    return [];
  }
  const items = [];
  const seenIds = new Set();
  for (const [index, rawItem] of raw.entries()) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      errors.push(`${kind}[${index}] must be an object`);
      continue;
    }
    const id = typeof rawItem.id === 'string' ? rawItem.id.trim() : '';
    if (!ENTITY_ID_PATTERN.test(id)) {
      errors.push(`${kind}[${index}].id "${id}" does not match ^[a-z][a-z0-9-]{0,63}$`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`${kind} contains duplicate id "${id}"`);
      continue;
    }
    seenIds.add(id);
    items.push({ id, raw: rawItem, index });
  }
  return items;
}

function normalizeLayers(raw, errors) {
  const entries = normalizeEntityList(raw, 'screen_layers', errors);
  if (entries.length > LIMITS.layers) {
    errors.push(`screen_layers exceeds ${LIMITS.layers} entries`);
    return [];
  }
  return entries.map(({ id, raw, index }) => {
    const kind = LAYER_KINDS.includes(raw.kind) ? raw.kind : null;
    if (!kind) errors.push(`screen_layers[${index}].kind "${raw.kind}" is not a known layer kind`);
    const parentId = raw.parent_id === null || raw.parent_id === undefined ? null : String(raw.parent_id);
    return {
      id,
      kind: kind || 'region',
      name: normalizeText(raw.name) || id,
      parent_id: parentId,
      summary: normalizeText(raw.summary)
    };
  });
}

function normalizeVisibleEntry(raw, kind, index, layerIds, errors) {
  const entry = { id: raw.id, layer_id: null, visible_label: '', visible_text: '', observed_states: [], claimed_states: [], summary: '' };
  if (raw.layer_id === undefined || raw.layer_id === null) {
    errors.push(`${kind}[${index}] (${raw.id}) requires layer_id`);
  } else if (!layerIds.has(String(raw.layer_id))) {
    errors.push(`${kind}[${index}] (${raw.id}) references unknown layer_id "${raw.layer_id}"`);
  } else {
    entry.layer_id = String(raw.layer_id);
  }
  if (raw.visible_label !== undefined) entry.visible_label = normalizeText(raw.visible_label);
  if (raw.visible_text !== undefined) entry.visible_text = normalizeText(raw.visible_text);
  if (raw.summary !== undefined) entry.summary = normalizeText(raw.summary);
  if (raw.observed_states !== undefined) {
    if (!Array.isArray(raw.observed_states)) errors.push(`${kind}[${index}] (${raw.id}) observed_states must be an array`);
    else entry.observed_states = raw.observed_states.filter((state) => typeof state === 'string').map(normalizeText).filter(Boolean);
  }
  if (raw.claimed_states !== undefined) {
    if (!Array.isArray(raw.claimed_states)) {
      errors.push(`${kind}[${index}] (${raw.id}) claimed_states must be an array`);
    } else {
      entry.claimed_states = raw.claimed_states
        .filter((claim) => claim && typeof claim === 'object')
        .map((claim) => ({
          state: normalizeText(claim.state),
          support: Array.isArray(claim.support) ? claim.support.filter((s) => typeof s === 'string').map(normalizeText).filter(Boolean) : []
        }))
        .filter((claim) => claim.state.length > 0);
    }
  }
  return entry;
}

function normalizeUncertainties(raw, entityIds, errors, warnings) {
  const entries = normalizeEntityList(raw, 'uncertainties', errors);
  if (entries.length > LIMITS.uncertainties) {
    errors.push(`uncertainties exceeds ${LIMITS.uncertainties} entries`);
    return [];
  }
  const normalized = [];
  for (const { id, raw: rawItem, index } of entries) {
    const category = UNCERTAINTY_CATEGORIES.includes(rawItem.category) ? rawItem.category : null;
    if (!category) {
      errors.push(`uncertainties[${index}] (${id}) has unknown category "${rawItem.category}"`);
      continue;
    }
    const priority = UNCERTAINTY_PRIORITIES.includes(rawItem.priority) ? rawItem.priority : null;
    if (!priority) {
      errors.push(`uncertainties[${index}] (${id}) has unknown priority "${rawItem.priority}"`);
      continue;
    }
    const questionError = textError(`uncertainties[${index}].question`, rawItem.question);
    if (questionError) {
      errors.push(questionError);
      continue;
    }
    // Dangling evidence references are normalizable, not blocking (§5.6).
    const evidence = Array.isArray(rawItem.evidence_ids) ? rawItem.evidence_ids.map(String) : [];
    const resolved = evidence.filter((ref) => entityIds.has(ref));
    if (resolved.length < evidence.length) {
      warnings.push(`uncertainties[${index}] (${id}) dropped ${evidence.length - resolved.length} dangling evidence reference(s)`);
    }
    normalized.push({
      id,
      category,
      question: normalizeText(rawItem.question),
      priority,
      evidence_ids: resolved,
      created_by: CREATED_BY.includes(rawItem.created_by) ? rawItem.created_by : 'ai'
    });
  }
  return normalized;
}

function normalizeAudit(raw, uncertaintyIds, errors) {
  if (!Array.isArray(raw)) {
    errors.push('uncertainty_audit must be an array');
    return [];
  }
  const audit = [];
  for (const category of UNCERTAINTY_CATEGORIES) {
    const row = raw.find((entry) => entry && entry.category === category);
    if (!row) {
      errors.push(`uncertainty_audit is missing category "${category}"`);
      continue;
    }
    if (!AUDIT_STATUSES.includes(row.status)) {
      errors.push(`uncertainty_audit category "${category}" has unknown status "${row.status}"`);
      continue;
    }
    const refs = Array.isArray(row.uncertainty_ids) ? row.uncertainty_ids.map(String) : [];
    const dangling = refs.filter((ref) => !uncertaintyIds.has(ref));
    if (dangling.length) {
      errors.push(`uncertainty_audit category "${category}" references unknown uncertainty id(s): ${dangling.join(', ')}`);
      continue;
    }
    audit.push({ category, status: row.status, uncertainty_ids: refs, rationale: normalizeText(row.rationale) });
  }
  return audit;
}

function validateLayerGraph(layers, errors) {
  const ids = new Set(layers.map((layer) => layer.id));
  for (const layer of layers) {
    if (layer.parent_id !== null && !ids.has(layer.parent_id)) {
      errors.push(`screen_layers "${layer.id}" references unknown parent_id "${layer.parent_id}"`);
    }
  }
  // Cycle detection.
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  for (const layer of layers) {
    const visited = new Set();
    let cursor = layer;
    while (cursor && cursor.parent_id !== null) {
      if (visited.has(cursor.id)) {
        errors.push(`screen_layers parent graph has a cycle at "${layer.id}"`);
        break;
      }
      visited.add(cursor.id);
      cursor = byId.get(cursor.parent_id);
      if (!cursor) break; // unknown parent already reported above
    }
  }
  // Overlay layers need a same-scene backdrop (§5.3): a background_frame or
  // primary_content anywhere in the scene. A top-level modal with
  // parent_id=null is legal.
  const hasBackdrop = layers.some((layer) => layer.kind === 'background_frame' || layer.kind === 'primary_content');
  const hasOverlay = layers.some((layer) => OVERLAY_LAYER_KINDS.includes(layer.kind));
  if (hasOverlay && !hasBackdrop) {
    errors.push('overlay layers (modal/drawer/popover/overlay) require a background_frame or primary_content in the same scene');
  }
}

// Normalize a raw model object into a validated Intent Analysis v2 value.
// Returns { value, errors, warnings }. errors block persistence; warnings are
// normalizations the caller must surface (§7.5).
function normalizeIntentAnalysis(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: null, errors: ['intent analysis must be a JSON object'], warnings };
  }
  for (const field of SERVER_OWNED_ANALYSIS_FIELDS) {
    if (field in raw) warnings.push(`model-provided server field "${field}" was ignored`);
  }
  if (!PAGE_TYPES.includes(raw.page_type)) errors.push(`page_type "${raw.page_type}" is not a known page type`);
  const purposeError = textError('page_purpose', raw.page_purpose);
  if (purposeError) errors.push(purposeError);

  const tasks = normalizeEntityList(raw.player_tasks, 'player_tasks', errors);
  if (tasks.length > LIMITS.playerTasks) errors.push(`player_tasks exceeds ${LIMITS.playerTasks} entries`);
  const flow = normalizeEntityList(raw.core_flow, 'core_flow', errors);
  if (flow.length > LIMITS.coreFlow) errors.push(`core_flow exceeds ${LIMITS.coreFlow} entries`);

  const layers = normalizeLayers(raw.screen_layers, errors);
  const layerIds = new Set(layers.map((layer) => layer.id));
  validateLayerGraph(layers, errors);

  const controlsRaw = normalizeEntityList(raw.visible_controls, 'visible_controls', errors);
  if (controlsRaw.length > LIMITS.visibleControls) errors.push(`visible_controls exceeds ${LIMITS.visibleControls} entries`);
  const infoRaw = normalizeEntityList(raw.visible_information_and_states, 'visible_information_and_states', errors);
  if (infoRaw.length > LIMITS.visibleInformation) errors.push(`visible_information_and_states exceeds ${LIMITS.visibleInformation} entries`);

  const controls = controlsRaw.map(({ id, raw: item, index }) => normalizeVisibleEntry({ id, ...item }, 'visible_controls', index, layerIds, errors));
  const information = infoRaw.map(({ id, raw: item, index }) => normalizeVisibleEntry({ id, ...item }, 'visible_information_and_states', index, layerIds, errors));

  const entityIds = new Set([...layerIds, ...controls.map((c) => c.id), ...information.map((i) => i.id)]);
  const uncertainties = normalizeUncertainties(raw.uncertainties || [], entityIds, errors, warnings);
  const uncertaintyIds = new Set(uncertainties.map((u) => u.id));
  const audit = normalizeAudit(raw.uncertainty_audit, uncertaintyIds, errors);

  for (const task of tasks) {
    const taskError = textError(`player_tasks "${task.id}" text`, task.raw.text);
    if (taskError) errors.push(taskError);
  }
  for (const step of flow) {
    const stepError = textError(`core_flow "${step.id}" text`, step.raw.text);
    if (stepError) errors.push(stepError);
  }

  if (errors.length === 0) {
    const value = {
      schema_version: '2.0',
      page_type: raw.page_type,
      page_purpose: normalizeText(raw.page_purpose),
      player_tasks: tasks.map(({ id, raw: item }) => ({ id, text: normalizeText(item.text) })),
      core_flow: flow.map(({ id, raw: item }) => ({ id, text: normalizeText(item.text) })),
      screen_layers: layers,
      visible_controls: controls,
      visible_information_and_states: information,
      uncertainties,
      uncertainty_audit: audit
    };
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > LIMITS.analysisBytes) {
      errors.push(`intent analysis exceeds ${LIMITS.analysisBytes} bytes serialized`);
    } else {
      return { value, errors, warnings };
    }
  }
  return { value: null, errors, warnings };
}

// ---------------------------------------------------------------------------
// Unsupported business claim policy (§5.7)
// ---------------------------------------------------------------------------

// A claimed business state is supported only when one of its support strings
// appears verbatim in the SAME entity's visible_label/visible_text. Global
// page-text matches never count. Unsupported claims are demoted to AI
// inference plus a policy-created uncertainty, and the audit row is synced.
function applyUnsupportedClaimPolicy(analysis) {
  const value = structuredClone(analysis);
  const warnings = [...(analysis.warnings || [])];
  const addedUncertainties = [];
  const counters = new Map();

  const checkEntry = (entry, kindLabel) => {
    const haystack = `${entry.visible_label}\n${entry.visible_text}`;
    const supported = [];
    for (const claim of entry.claimed_states) {
      const isSupported = claim.support.length > 0 && claim.support.some((text) => text.length > 0 && haystack.includes(text));
      if (isSupported) {
        supported.push(claim);
        continue;
      }
      const ordinal = (counters.get(entry.id) || 0) + 1;
      counters.set(entry.id, ordinal);
      const uncertaintyId = `policy-state_semantics-${entry.id}-${ordinal}`;
      addedUncertainties.push({
        id: uncertaintyId,
        category: 'state_semantics',
        question: `「${claim.state}」这个业务状态在${kindLabel} ${entry.id} 上没有同实体可见文本支持，请设计师确认其真实含义。`,
        priority: 'important',
        evidence_ids: [entry.id],
        created_by: 'policy'
      });
      warnings.push(`unsupported business claim "${claim.state}" on ${kindLabel} ${entry.id} demoted to uncertainty ${uncertaintyId}`);
    }
    entry.claimed_states = supported;
  };

  for (const entry of value.visible_controls) checkEntry(entry, '控件');
  for (const entry of value.visible_information_and_states) checkEntry(entry, '信息');

  if (addedUncertainties.length) {
    value.uncertainties = [...value.uncertainties, ...addedUncertainties];
    const newIds = addedUncertainties.map((u) => u.id);
    const auditRow = value.uncertainty_audit.find((row) => row.category === 'state_semantics');
    if (auditRow) {
      auditRow.status = 'questions_present';
      auditRow.uncertainty_ids = [...new Set([...auditRow.uncertainty_ids, ...newIds])];
    }
  }
  return { value, warnings, demoted: addedUncertainties.map((u) => u.id) };
}

// ---------------------------------------------------------------------------
// Review builder (§6.1–§6.3)
// ---------------------------------------------------------------------------

function describeVisibleEntry(entry) {
  const parts = [];
  if (entry.visible_label) parts.push(`标签「${entry.visible_label}」`);
  if (entry.visible_text) parts.push(`文本「${entry.visible_text}」`);
  if (entry.observed_states.length) parts.push(`可见状态：${entry.observed_states.join('；')}`);
  if (entry.claimed_states.length) parts.push(`有据业务状态：${entry.claimed_states.map((c) => c.state).join('、')}`);
  if (entry.summary) parts.push(entry.summary);
  return parts.join('；') || entry.id;
}

// Deterministic: the same analysis always yields the same review ids.
function createIntentReview(analysis, { wireframeRevision }) {
  const toItem = (entity, origin) => ({
    id: entity.id,
    text: entity.text,
    origin,
    source_evidence_ids: [],
    designer_modified: false
  });
  const visibleItem = (entry) => ({
    id: entry.id,
    text: describeVisibleEntry(entry),
    origin: 'ai_visible',
    source_evidence_ids: [entry.layer_id].filter(Boolean),
    designer_modified: false
  });
  return {
    schema_version: '1.1',
    revision: 0,
    source_analysis_id: analysis.analysis_id || null,
    source_wireframe_revision: wireframeRevision,
    page_purpose: {
      id: 'page-purpose',
      text: analysis.page_purpose,
      origin: 'ai_inference',
      source_evidence_ids: [],
      designer_modified: false
    },
    player_tasks: analysis.player_tasks.map((task) => toItem(task, 'ai_inference')),
    core_flow: analysis.core_flow.map((step) => toItem(step, 'ai_inference')),
    visible_controls: analysis.visible_controls.map(visibleItem),
    visible_information_and_states: analysis.visible_information_and_states.map(visibleItem),
    uncertainties: analysis.uncertainties.map((u) => ({
      id: u.id,
      category: u.category,
      question: u.question,
      priority: u.priority,
      evidence_ids: [...u.evidence_ids],
      created_by: u.created_by,
      review_status: 'unreviewed',
      note: '',
      designer_modified: false
    })),
    confirmed_at: null
  };
}

// ---------------------------------------------------------------------------
// Review validation / confirmation gate (§6.4, §6.5)
// ---------------------------------------------------------------------------

function validateIntentReview(review, { forConfirmation = false } = {}) {
  const errors = [];
  if (!review || typeof review !== 'object') return { errors: ['intent review must be an object'] };
  const sections = ['player_tasks', 'core_flow', 'visible_controls', 'visible_information_and_states'];
  for (const section of sections) {
    if (!Array.isArray(review[section])) errors.push(`review.${section} must be an array`);
  }
  if (errors.length) return { errors };

  const allItems = [
    review.page_purpose ? { ...review.page_purpose, section: 'page_purpose' } : null,
    ...sections.flatMap((section) => review[section].map((item) => ({ ...item, section })))
  ].filter(Boolean);
  const ids = new Set();
  for (const item of allItems) {
    if (!item.id || ids.has(item.id)) errors.push(`review item id missing or duplicated: "${item.id}"`);
    ids.add(item.id);
    if (textError(`review item ${item.id} text`, item.text)) errors.push(`review item ${item.id} has empty or oversized text`);
    if (!ORIGINS.includes(item.origin)) errors.push(`review item ${item.id} has unknown origin "${item.origin}"`);
  }

  if (!Array.isArray(review.uncertainties)) {
    errors.push('review.uncertainties must be an array');
  } else {
    const seen = new Set();
    for (const u of review.uncertainties) {
      if (!u.id || seen.has(u.id)) errors.push(`uncertainty id missing or duplicated: "${u.id}"`);
      seen.add(u.id);
      if (!REVIEW_STATUSES.includes(u.review_status)) errors.push(`uncertainty ${u.id} has unknown review_status "${u.review_status}"`);
      if (u.review_status === 'answered' && !(typeof u.note === 'string' && u.note.trim())) {
        errors.push(`uncertainty ${u.id} is answered but has an empty note`);
      }
    }
    if (forConfirmation) {
      if (!review.page_purpose || !review.page_purpose.text || !review.page_purpose.text.trim()) {
        errors.push('page purpose must not be empty');
      }
      if (review.player_tasks.length < 1) errors.push('player tasks must contain at least 1 item');
      if (review.core_flow.length < 1) errors.push('core flow must contain at least 1 item');
      if (review.visible_controls.length + review.visible_information_and_states.length < 1) {
        errors.push('visible controls and visible information must contain at least 1 item combined');
      }
      for (const u of review.uncertainties) {
        if (u.review_status === 'unreviewed') errors.push(`uncertainty ${u.id} is still unreviewed`);
        if (u.priority === 'blocking' && u.review_status === 'deferred') {
          errors.push(`blocking uncertainty ${u.id} cannot be deferred`);
        }
        if (u.priority === 'blocking' && u.review_status === 'not_applicable' && !(typeof u.note === 'string' && u.note.trim())) {
          errors.push(`blocking uncertainty ${u.id} marked not_applicable requires a rationale note`);
        }
      }
    }
  }
  const serialized = JSON.stringify(review);
  if (Buffer.byteLength(serialized, 'utf8') > LIMITS.reviewBytes) errors.push(`intent review exceeds ${LIMITS.reviewBytes} bytes serialized`);
  return { errors };
}

// ---------------------------------------------------------------------------
// Deterministic requirement renderer (§6.7)
// ---------------------------------------------------------------------------

const EMPTY_PLACEHOLDER = '（暂无内容）';

function renderSectionLines(items, render) {
  return items.length ? items.map(render) : [EMPTY_PLACEHOLDER];
}

// Byte-stable: identical review input always yields identical output.
function renderIntentReview(review) {
  const lines = [];
  lines.push('【页面目的】');
  lines.push(review.page_purpose && review.page_purpose.text ? review.page_purpose.text : EMPTY_PLACEHOLDER);
  lines.push('');
  lines.push('【玩家任务】');
  lines.push(...renderSectionLines(review.player_tasks, (item, index) => `${index + 1}. ${item.text}`));
  lines.push('');
  lines.push('【核心流程】');
  lines.push(...renderSectionLines(review.core_flow, (item, index) => `${index + 1}. ${item.text}`));
  lines.push('');
  lines.push('【可见控件】');
  lines.push(...renderSectionLines(review.visible_controls, (item) => `- ${item.text}`));
  lines.push('');
  lines.push('【可见信息与状态】');
  lines.push(...renderSectionLines(review.visible_information_and_states, (item) => `- ${item.text}`));
  lines.push('');
  lines.push('【待确认项】');
  const uncertainties = review.uncertainties || [];
  if (!uncertainties.length) {
    lines.push('设计师确认：本页面暂无需要确认的未知规则。');
  } else {
    for (const u of uncertainties) {
      const statusText = {
        unreviewed: '未处理',
        answered: `已回答：${u.note}`,
        deferred: '暂保留，尚未定案',
        not_applicable: `设计师确认不适用${u.note ? `（理由：${u.note}）` : ''}`
      }[u.review_status] || u.review_status;
      lines.push(`- [${u.priority}] ${u.question} —— ${statusText}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Canonical Intent Context (§6.8, §9.2)
// ---------------------------------------------------------------------------

function analysisIsFresh(analysis, { wireframeRevision, projectType }) {
  return Boolean(
    analysis
    && analysis.source_revision
    && analysis.source_revision.wireframe === wireframeRevision
    && analysis.source_revision.project_type === projectType
  );
}

// Shared field selection and ordering for both canonical builders. Deep key
// sorting happens in canonicalJson, so callers never depend on insertion order.
function selectIntentContextFields({ review, analysis, wireframeRevision, projectType }) {
  const fresh = analysisIsFresh(analysis, { wireframeRevision, projectType });
  const reason = !analysis
    ? 'no_analysis'
    : fresh
      ? null
      : analysis.source_revision && analysis.source_revision.wireframe !== wireframeRevision
        ? 'wireframe_revision_mismatch'
        : 'project_type_mismatch';
  return {
    wireframe_revision: wireframeRevision,
    project_type: projectType,
    review: {
      page_purpose: review?.page_purpose?.text || '',
      player_tasks: (review?.player_tasks || []).map((item) => item.text),
      core_flow: (review?.core_flow || []).map((item) => item.text),
      visible_controls: (review?.visible_controls || []).map((item) => item.text),
      visible_information_and_states: (review?.visible_information_and_states || []).map((item) => item.text)
    },
    visible_facts: fresh ? {
      layers: analysis.screen_layers.map((layer) => ({ id: layer.id, kind: layer.kind, name: layer.name, parent_id: layer.parent_id })),
      controls: analysis.visible_controls.map((entry) => ({ id: entry.id, layer_id: entry.layer_id, visible_label: entry.visible_label, visible_text: entry.visible_text })),
      information: analysis.visible_information_and_states.map((entry) => ({ id: entry.id, layer_id: entry.layer_id, visible_label: entry.visible_label, visible_text: entry.visible_text }))
    } : null,
    deferred_uncertainties: (review?.uncertainties || [])
      .filter((u) => u.review_status === 'deferred')
      .map((u) => ({ id: u.id, category: u.category, question: u.question, priority: u.priority })),
    analysis_context_excluded: !fresh,
    analysis_context_excluded_reason: reason
  };
}

// Deep-stable JSON serialization: object keys are sorted recursively so key
// order in the source objects never changes the output.
function canonicalJson(value) {
  const sort = (node) => {
    if (Array.isArray(node)) return node.map(sort);
    if (node && typeof node === 'object') {
      const sorted = {};
      for (const key of Object.keys(node).sort()) sorted[key] = sort(node[key]);
      return sorted;
    }
    return node === undefined ? null : node;
  };
  return JSON.stringify(sort(value));
}

function buildCanonicalIntentContext(inputs) {
  return selectIntentContextFields(inputs);
}

function canonicalIntentContextHash(context) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(context), 'utf8').digest('hex')}`;
}

// Screen Contract supporting context builder (§9.2). Same selection logic as
// the canonical builder; never emits unconfirmed AI inference and returns
// audit-only metadata that must not reach the model.
function buildScreenContractIntentContext(project) {
  const wireframeRevision = project.input_revisions?.wireframe ?? 0;
  const context = selectIntentContextFields({
    review: project.intent_review || null,
    analysis: project.intent_analysis || null,
    wireframeRevision,
    projectType: project.project_type
  });
  return {
    context,
    hash: canonicalIntentContextHash(context),
    meta: {
      analysis_context_excluded: context.analysis_context_excluded,
      reason: context.analysis_context_excluded_reason
    }
  };
}

// ---------------------------------------------------------------------------
// Review diff helpers (§10.6)
// ---------------------------------------------------------------------------

// Match priority: stable item id → normalized text signature → added/removed.
// The diff is display-only; adoption is always a whole-version replacement.
function diffReviewSection(currentItems, candidateItems) {
  const result = [];
  const candidateById = new Map(candidateItems.map((item) => [item.id, item]));
  const matched = new Set();
  for (const current of currentItems) {
    const sameId = candidateById.get(current.id);
    if (sameId) {
      matched.add(current.id);
      result.push({ section_kind: sameId.text === current.text ? 'same' : 'modified', current_id: current.id, candidate_id: sameId.id, text: sameId.text });
      continue;
    }
    const byText = candidateItems.find((item) => !matched.has(item.id) && normalizeText(item.text) === normalizeText(current.text));
    if (byText) {
      matched.add(byText.id);
      result.push({ section_kind: 'moved', current_id: current.id, candidate_id: byText.id, text: byText.text });
    } else {
      result.push({ section_kind: 'removed', current_id: current.id, candidate_id: null, text: current.text });
    }
  }
  for (const candidate of candidateItems) {
    if (!matched.has(candidate.id)) {
      result.push({ section_kind: 'added', current_id: null, candidate_id: candidate.id, text: candidate.text });
    }
  }
  return result;
}

function diffIntentReviews(current, candidate) {
  const sections = ['player_tasks', 'core_flow', 'visible_controls', 'visible_information_and_states'];
  const diff = {};
  for (const section of sections) diff[section] = diffReviewSection(current[section] || [], candidate[section] || []);
  diff.page_purpose = {
    section_kind: (current.page_purpose?.text || '') === (candidate.page_purpose?.text || '') ? 'same' : 'modified',
    text: candidate.page_purpose?.text || ''
  };
  diff.uncertainties = diffReviewSection(
    (current.uncertainties || []).map((u) => ({ id: u.id, text: u.question })),
    (candidate.uncertainties || []).map((u) => ({ id: u.id, text: u.question }))
  );
  return diff;
}

module.exports = {
  PAGE_TYPES,
  LAYER_KINDS,
  OVERLAY_LAYER_KINDS,
  UNCERTAINTY_CATEGORIES,
  UNCERTAINTY_PRIORITIES,
  REVIEW_STATUSES,
  ORIGINS,
  CREATED_BY,
  AUDIT_STATUSES,
  ENTITY_ID_PATTERN,
  LIMITS,
  SERVER_OWNED_ANALYSIS_FIELDS,
  normalizeText,
  normalizeIntentAnalysis,
  applyUnsupportedClaimPolicy,
  createIntentReview,
  validateIntentReview,
  renderIntentReview,
  analysisIsFresh,
  buildCanonicalIntentContext,
  canonicalIntentContextHash,
  buildScreenContractIntentContext,
  diffIntentReviews,
  canonicalJson
};
