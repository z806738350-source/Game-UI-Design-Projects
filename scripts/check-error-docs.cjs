#!/usr/bin/env node
// Bidirectional check between electron/services/errorCodes.cjs (the frozen
// registry) and docs/dev/ERROR-CATALOG.md. Every registry key must appear in
// the catalog tables and every catalog code must exist in the registry.
// Exported as checkErrorDocs(root) so negative fixtures can point the check
// at a synthetic workspace; the CLI validates the real repository root.
const fs = require('node:fs');
const path = require('node:path');

// Backtick-quoted ALL_CAPS tokens inside markdown table rows.
function tableCodes(text) {
  const codes = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    for (const match of line.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)) codes.add(match[1]);
  }
  return codes;
}

// Returns an array of problem strings (empty = consistent). Split the catalog
// at the section headings so codes are matched against the correct table
// group; every registry group owns exactly one section. No exemptions: every
// registered code must be documented in its own section, and every documented
// table code must exist in that section's registry. Cross-referenced codes
// (e.g. `BINDING_COVERAGE_INCOMPLETE` mentioned inside the binding section
// prose) are tolerated only in non-table text.
function checkErrorDocs(root) {
  const registryPath = path.join(root, 'electron', 'services', 'errorCodes.cjs');
  const catalogPath = path.join(root, 'docs', 'dev', 'ERROR-CATALOG.md');
  const { ERROR_CODES, FIDELITY_ISSUE_CODES, BINDING_VALIDATION_CODES } = require(registryPath);
  const registry = {
    ERROR_CODES: Object.keys(ERROR_CODES),
    FIDELITY_ISSUE_CODES: Object.keys(FIDELITY_ISSUE_CODES),
    BINDING_VALIDATION_CODES: Object.keys(BINDING_VALIDATION_CODES)
  };

  if (!fs.existsSync(catalogPath)) {
    return [`missing ${path.relative(root, catalogPath)}`];
  }
  const catalog = fs.readFileSync(catalogPath, 'utf8');

  const sectionBounds = [
    ['ERROR_CODES', '## 一、管线错误码', '## 二、Fidelity 检查码'],
    ['FIDELITY_ISSUE_CODES', '## 二、Fidelity 检查码', '## 三、绑定语义校验码'],
    ['BINDING_VALIDATION_CODES', '## 三、绑定语义校验码', '## 四、校验机制']
  ];
  const sections = {};
  for (const [group, beginHeading, endHeading] of sectionBounds) {
    const begin = catalog.indexOf(beginHeading);
    if (begin === -1) return [`missing catalog section "${beginHeading}"`];
    const end = catalog.indexOf(endHeading, begin + beginHeading.length);
    sections[group] = end === -1 ? catalog.slice(begin) : catalog.slice(begin, end);
  }

  const problems = [];
  for (const [group, keys] of Object.entries(registry)) {
    const documented = tableCodes(sections[group]);
    for (const key of keys) if (!documented.has(key)) problems.push(`${group}.${key} is missing from ERROR-CATALOG.md`);
    for (const code of documented) {
      if (!keys.includes(code)) {
        problems.push(`ERROR-CATALOG.md ${group} section lists \`${code}\` but it is not registered in that group of errorCodes.cjs`);
      }
    }
  }
  return problems;
}

module.exports = { checkErrorDocs };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const problems = checkErrorDocs(root);
  if (problems.length) {
    console.error(`check-error-docs: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const { ERROR_CODES, FIDELITY_ISSUE_CODES, BINDING_VALIDATION_CODES } = require(path.join(root, 'electron', 'services', 'errorCodes.cjs'));
  console.log(`check-error-docs: OK (${Object.keys(ERROR_CODES).length} ERROR_CODES, ${Object.keys(FIDELITY_ISSUE_CODES).length} FIDELITY_ISSUE_CODES, ${Object.keys(BINDING_VALIDATION_CODES).length} BINDING_VALIDATION_CODES)`);
}
