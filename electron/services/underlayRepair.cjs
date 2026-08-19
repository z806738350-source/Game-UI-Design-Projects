function planRepairTask(critique, capabilities, input = {}) {
const { ERROR_CODES, FIDELITY_ISSUE_CODES } = require('./errorCodes.cjs');
  const gate = require('./underlayCritique.cjs').reviewGate(critique);
  const attempt = Number(input.attempt || 1);
  const maximum = Number(input.maxAutomaticAttempts || 2);
  if (attempt > maximum) throw Object.assign(new Error('Automatic underlay repair limit reached; manual review is required.'), { code: ERROR_CODES.UNDERLAY_REPAIR_LIMIT });
  if (!gate.blocking.length) throw new Error('Underlay has no unwaived blocking issues to repair.');
  return {
    schema_version: '2.0', id: `${critique.id}-repair-${attempt}`, version: 1, status: 'generated',
    source: { critique: critique.id, parent_underlay_id: critique.source?.underlay, underlay_contract: critique.source?.underlay_contract }, repair_mode: capabilities.supports_inpaint ? 'inpaint' : 'regenerate',
    target_regions: [...new Set(gate.blocking.map((item) => item.slot_id).filter(Boolean))],
    attempt, max_automatic_attempts: maximum,
    instructions: gate.blocking.map((item) => `remove ${item.type}; ${item.reason}`), preserve_regions: input.preserveRegions || []
  };
}

async function executeRepairTask({ task, contract, critique, capabilities, providerClient, providerConfig, sourcePath, overlayPath, componentBoardPath, maskPath, size, prompt }) {
  if (task.repair_mode === 'inpaint' && (!capabilities.supports_inpaint || !maskPath)) throw Object.assign(new Error('Inpaint capability or repair mask is unavailable.'), { code: ERROR_CODES.INPAINT_NOT_AVAILABLE });
  if (!sourcePath || !overlayPath || !componentBoardPath) throw Object.assign(new Error('Repair requires parent Underlay, Review Overlay, and component board files.'), { code: ERROR_CODES.REPAIR_EVIDENCE_INCOMPLETE });
  const result = await providerClient.repairImage(providerConfig, {
    mode: task.repair_mode, prompt, sourcePath, overlayPath, componentBoardPath, maskPath, size,
    model: providerConfig.imageModel, maxReferenceImages: capabilities.max_reference_images
  });
  const imageUrl = result?.image_url || result?.url;
  if (!imageUrl) throw Object.assign(new Error('Repair provider returned no image.'), { code: ERROR_CODES.REPAIR_OUTPUT_MISSING });
  return { ...result, image_url: imageUrl, repair_mode: task.repair_mode, parent_underlay_id: critique.source.underlay, repair_task_id: task.id, contract_id: contract.id };
}

module.exports = { executeRepairTask, planRepairTask };
