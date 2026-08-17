function planRepairTask(critique, capabilities, input = {}) {
  const gate = require('./underlayCritique.cjs').reviewGate(critique);
  const attempt = Number(input.attempt || 1);
  const maximum = Number(input.maxAutomaticAttempts || 2);
  if (attempt > maximum) throw Object.assign(new Error('Automatic underlay repair limit reached; manual review is required.'), { code: 'UNDERLAY_REPAIR_LIMIT' });
  if (!gate.blocking.length) throw new Error('Underlay has no unwaived blocking issues to repair.');
  return {
    schema_version: '2.0', id: `${critique.id}-repair-${attempt}`, version: 1, status: 'generated',
    source: { critique: critique.id }, repair_mode: capabilities.supports_inpaint ? 'inpaint' : 'regenerate',
    target_regions: [...new Set(gate.blocking.map((item) => item.slot_id).filter(Boolean))],
    attempt, max_automatic_attempts: maximum,
    instructions: gate.blocking.map((item) => `remove ${item.type}; ${item.reason}`), preserve_regions: input.preserveRegions || []
  };
}

module.exports = { planRepairTask };
