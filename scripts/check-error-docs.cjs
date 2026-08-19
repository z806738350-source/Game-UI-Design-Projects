#!/usr/bin/env node
// Bidirectional check between electron/services/errorCodes.cjs (the frozen
// registry) and docs/dev/ERROR-CATALOG.md. Every registry key must appear in
// the catalog tables and every catalog code must exist in the registry.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const registryPath = path.join(ROOT, 'electron', 'services', 'errorCodes.cjs');
const catalogPath = path.join(ROOT, 'docs', 'dev', 'ERROR-CATALOG.md');

const { ERROR_CODES, FIDELITY_ISSUE_CODES } = require(registryPath);
const registry = { ERROR_CODES: Object.keys(ERROR_CODES), FIDELITY_ISSUE_CODES: Object.keys(FIDELITY_ISSUE_CODES) };

if (!fs.existsSync(catalogPath)) {
  console.error(`check-error-docs: missing ${path.relative(ROOT, catalogPath)}`);
  process.exit(1);
}
const catalog = fs.readFileSync(catalogPath, 'utf8');

// Split the catalog at the Fidelity section heading so codes are matched
// against the correct table group.
const fidelityHeadingIndex = catalog.indexOf('## 二、Fidelity 检查码');
const sections = {
  ERROR_CODES: fidelityHeadingIndex === -1 ? catalog : catalog.slice(0, fidelityHeadingIndex),
  FIDELITY_ISSUE_CODES: fidelityHeadingIndex === -1 ? '' : catalog.slice(fidelityHeadingIndex)
};

// Backtick-quoted ALL_CAPS tokens inside markdown table rows.
function tableCodes(text) {
  const codes = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    for (const match of line.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)) codes.add(match[1]);
  }
  return codes;
}

// The fidelity section text includes later sections (BINDING_* notes,
// verification notes); restrict to table rows that name a registered code.
const problems = [];
for (const [group, keys] of Object.entries(registry)) {
  const documented = tableCodes(sections[group]);
  for (const key of keys) if (!documented.has(key)) problems.push(`${group}.${key} is missing from ERROR-CATALOG.md`);
  for (const code of documented) {
    if (code.startsWith('BINDING_')) continue; // documented separately as validation messages
    if (!registry.ERROR_CODES.includes(code) && !registry.FIDELITY_ISSUE_CODES.includes(code)) {
      problems.push(`ERROR-CATALOG.md lists \`${code}\` but errorCodes.cjs does not define it`);
    }
    if (group === 'ERROR_CODES' && registry.FIDELITY_ISSUE_CODES.includes(code) && !registry.ERROR_CODES.includes(code)) {
      problems.push(`\`${code}\` is a FIDELITY_ISSUE_CODE but documented in the ERROR_CODES tables`);
    }
  }
}

if (problems.length) {
  console.error(`check-error-docs: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`check-error-docs: OK (${registry.ERROR_CODES.length} ERROR_CODES, ${registry.FIDELITY_ISSUE_CODES.length} FIDELITY_ISSUE_CODES)`);
