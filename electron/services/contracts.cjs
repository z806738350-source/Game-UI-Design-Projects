const ARTIFACT_STATUS = new Set(['draft', 'generated', 'reviewed', 'approved', 'rejected', 'stale']);
const { validateFontManifest } = require('./typographyAssets.cjs');
const { validateComponentContract } = require('./componentKit.cjs');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, key, errors) {
  if (typeof value?.[key] !== 'string' || !value[key].trim()) errors.push(`${key} must be a non-empty string`);
}

function requireArray(value, key, errors) {
  if (!Array.isArray(value?.[key])) errors.push(`${key} must be an array`);
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (isObject(value)) return Object.entries(value).map(([key, item]) => `${key}：${String(item)}`);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function semanticTerms(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[\/、，,；;（）()\[\]\s]+/)
    .map((item) => item.replace(/(?:按钮|控件|区域|模块|栏|列表|显示|信息|文本|图标|页签|功能|操作)$/g, ''))
    .filter((item) => item.length >= 2);
}

function sourceItemCovered(item, candidates) {
  const terms = semanticTerms(item);
  if (!terms.length) return true;
  const corpus = candidates.map((candidate) => String(candidate).toLowerCase()).join('｜');
  return terms.every((term) => corpus.includes(term));
}

function normalizeArtifact(kind, value) {
  if (!isObject(value)) return value;
  if (kind === 'screen-contract') {
    const lists = ['secondary_actions', 'required_information', 'required_controls', 'states', 'edge_cases', 'data_dependencies'];
    const next = { ...value };
    lists.forEach((key) => { next[key] = asStringArray(value[key]); });
    if (isObject(value.source_inventory)) {
      next.source_inventory = { ...value.source_inventory };
      ['requirement_functions', 'wireframe_controls', 'wireframe_information'].forEach((key) => {
        next.source_inventory[key] = asStringArray(value.source_inventory[key]);
      });
    }
    if (isObject(value.coverage)) {
      next.coverage = {
        ...value.coverage,
        covered_items: asStringArray(value.coverage.covered_items),
        uncovered_items: asStringArray(value.coverage.uncovered_items)
      };
    }
    return next;
  }
  if (kind === 'layout-proposals') {
    const proposals = Array.isArray(value.proposals) ? value.proposals : isObject(value.proposals) ? Object.values(value.proposals) : [];
    return {
      ...value,
      proposals: proposals.filter(isObject).map((proposal) => ({
        ...proposal,
        visual_hierarchy: asStringArray(proposal.visual_hierarchy),
        interaction_flow: asStringArray(proposal.interaction_flow),
        tradeoffs: asStringArray(proposal.tradeoffs),
        rationale: Array.isArray(proposal.rationale) ? proposal.rationale : []
      }))
    };
  }
  if (kind === 'style-contract') {
    return { ...value, materials: asStringArray(value.materials), reference_ids: asStringArray(value.reference_ids), negative_style_constraints: asStringArray(value.negative_style_constraints) };
  }
  return value;
}

function commonErrors(value) {
  const errors = [];
  if (!isObject(value)) return ['artifact must be an object'];
  requireString(value, 'schema_version', errors);
  requireString(value, 'id', errors);
  if (!Number.isInteger(value.version) || value.version < 1) errors.push('version must be a positive integer');
  if (!ARTIFACT_STATUS.has(value.status)) errors.push('status is invalid');
  if (!isObject(value.source)) errors.push('source must be an object');
  return errors;
}

function validateArtifact(kind, value) {
  const errors = commonErrors(value);
  if (errors.length && !isObject(value)) return errors;
  if (kind === 'screen-contract') {
    ['screen_id', 'screen_name', 'purpose', 'primary_action'].forEach((key) => requireString(value, key, errors));
    ['secondary_actions', 'required_information', 'required_controls', 'states', 'edge_cases', 'data_dependencies'].forEach((key) => requireArray(value, key, errors));
    if (!isObject(value.design_constraints)) errors.push('design_constraints must be an object');
    if (!isObject(value.source_inventory)) errors.push('source_inventory must be an object');
    else ['requirement_functions', 'wireframe_controls', 'wireframe_information'].forEach((key) => requireArray(value.source_inventory, key, errors));
    if (!isObject(value.coverage)) errors.push('coverage must be an object');
    else {
      requireArray(value.coverage, 'covered_items', errors);
      requireArray(value.coverage, 'uncovered_items', errors);
      if (Array.isArray(value.coverage.uncovered_items) && value.coverage.uncovered_items.length) errors.push('coverage.uncovered_items must be empty');
    }
    const inventoryControls = [...(value.source_inventory?.requirement_functions || []), ...(value.source_inventory?.wireframe_controls || [])];
    const controls = [...(value.required_controls || []), ...(value.secondary_actions || []), ...(value.coverage?.covered_items || [])];
    const uncoveredControls = inventoryControls.filter((item) => !sourceItemCovered(item, controls));
    if (uncoveredControls.length) errors.push(`required_controls missing source items: ${uncoveredControls.join(', ')}`);
    const inventoryInformation = value.source_inventory?.wireframe_information || [];
    const information = [...(value.required_information || []), ...(value.coverage?.covered_items || [])];
    const uncoveredInformation = inventoryInformation.filter((item) => !sourceItemCovered(item, information));
    if (uncoveredInformation.length) errors.push(`required_information missing source items: ${uncoveredInformation.join(', ')}`);
  } else if (kind === 'layout-proposals') {
    requireString(value, 'screen_id', errors);
    requireArray(value, 'proposals', errors);
    if (Array.isArray(value.proposals) && value.proposals.length !== 3) errors.push('proposals must contain exactly three options');
    (value.proposals || []).forEach((proposal, index) => {
      if (!isObject(proposal)) { errors.push(`proposals[${index}] must be an object`); return; }
      ['id', 'name', 'strategy'].forEach((key) => requireString(proposal, key, errors));
      ['visual_hierarchy', 'interaction_flow', 'tradeoffs', 'rationale'].forEach((key) => requireArray(proposal, key, errors));
      if (!isObject(proposal.regions) || !Object.keys(proposal.regions).length) errors.push(`proposals[${index}].regions must be a non-empty object`);
      else {
        const ratios = [];
        Object.entries(proposal.regions).forEach(([key, region]) => {
          if (!isObject(region)) {
            errors.push(`proposals[${index}].regions.${key} must be an object with label and recommended_ratio`);
            return;
          }
          requireString(region, 'label', errors);
          const ratio = Number(region.recommended_ratio);
          if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) errors.push(`proposals[${index}].regions.${key}.recommended_ratio must be a number between 0 and 1`);
          else ratios.push(ratio);
        });
        const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
        if (ratios.length && (total < 0.9 || total > 1.1)) errors.push(`proposals[${index}].region ratios must total approximately 1.0 (received ${total.toFixed(3)})`);
      }
    });
  } else if (kind === 'style-contract') {
    requireString(value, 'style_id', errors);
    if (!isObject(value.visual_identity)) errors.push('visual_identity must be an object');
    ['colors', 'typography', 'geometry', 'lighting', 'components', 'composition'].forEach((key) => {
      if (!isObject(value[key])) errors.push(`${key} must be an object`);
    });
    requireArray(value, 'materials', errors);
    requireArray(value, 'reference_ids', errors);
  } else if (kind === 'font-manifest') {
    requireArray(value, 'fonts', errors);
    if (!isObject(value.roles)) errors.push('roles must be an object');
    errors.push(...validateFontManifest(value, { strict: value.status === 'approved' }));
  } else if (kind === 'component-contract') {
    requireArray(value, 'families', errors);
    errors.push(...validateComponentContract(value, { strict: value.status === 'approved' }));
  }
  return errors;
}

function extractJson(text) {
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  try { return JSON.parse(clean); } catch {}
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  for (let start = clean.indexOf('{'); start >= 0; start = clean.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < clean.length; index += 1) {
      const char = clean[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(clean.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  throw new Error('Model response did not contain valid JSON.');
}

function withCommonFields(value, defaults) {
  return {
    ...value,
    schema_version: String(value.schema_version || '1.0'),
    id: String(value.id || defaults.id),
    version: Number.isInteger(value.version) ? value.version : 1,
    status: ARTIFACT_STATUS.has(value.status) ? value.status : 'generated',
    source: isObject(value.source) ? value.source : defaults.source
  };
}

module.exports = { extractJson, normalizeArtifact, validateArtifact, withCommonFields };
