#!/usr/bin/env node
/**
 * docs-validate gate: structural validation for execution-grade docs.
 * Checks: required files, template headings, JSON fence parseability,
 * and referenced repo paths. Read-only: never mutates files. The full
 * docs gate is `pnpm test:docs`, which additionally runs check-error-docs,
 * check-doc-commands, and check-project-tree.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const errors = [];

const CONTRACT_DOCS = [
  'STYLE-CONTRACT-2.0', 'FONT-MANIFEST', 'COMPONENT-CONTRACT',
  'SCREEN-CONTRACT', 'COMPONENT-BINDINGS', 'APPROVED-LAYOUT',
  'UNDERLAY-CONTRACT', 'UNDERLAY-CRITIQUE', 'COMPOSITION-MANIFEST',
  'COMPOSITION-OUTPUT', 'FIDELITY-REPORT'
];
const USER_DOCS = [
  'EXISTING-PROJECT-SOP', 'STRICT-CONTINUATION-GUIDE',
  'WORKBENCH-GUIDE', 'FAILURE-RECOVERY'
];
const DEV_DOCS = [
  'PIPELINE-STATE-MACHINE', 'ARTIFACT-DEPENDENCY-GRAPH',
  'API-IPC-REFERENCE', 'PROJECT-DIRECTORY', 'ERROR-CATALOG',
  'PROVIDER-TROUBLESHOOTING', 'MIGRATION-ROLLBACK', 'RELEASE-CHECKLIST'
];

const REQUIRED_FILES = [
  ...CONTRACT_DOCS.map((name) => `docs/contracts/${name}.md`),
  ...USER_DOCS.map((name) => `docs/user/${name}.md`),
  ...DEV_DOCS.map((name) => `docs/dev/${name}.md`),
  // 新用户使用说明书是单文件 HTML（浏览器直接打开），同样纳入存在性与 README 索引校验
  'docs/user/quick-start-guide.html',
  'README.md', 'CHANGELOG.md'
];

// Headings every contract doc must carry (numbering differs per template).
const CONTRACT_HEADINGS = [
  '概述', 'Artifact 标识与存储', 'Schema 字段表', '批准与信任模型',
  '状态机', '错误码', 'strict 与 guided 模式', '合法 JSON 示例',
  '非法 JSON 示例', '存量数据兼容', '与其他契约的关系', '源码指针',
  '测试指针', '验收清单', '版本与变更记录'
];

function fail(message) {
  errors.push(message);
}

// 1. Required files exist.
for (const rel of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(root, rel))) fail(`missing required doc: ${rel}`);
}

// 2. Contract template headings present (exact match after stripping
// numbering and trailing parenthetical qualifiers).
function normalizeHeading(line) {
  return line
    .replace(/^## /, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/（[^）]*）/g, '')
    .trim();
}
for (const name of CONTRACT_DOCS) {
  const file = path.join(root, `docs/contracts/${name}.md`);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const headingTitles = text.split('\n')
    .filter((line) => /^## /.test(line))
    .map(normalizeHeading);
  for (const heading of CONTRACT_HEADINGS) {
    if (!headingTitles.includes(heading)) fail(`docs/contracts/${name}.md: missing heading "${heading}"`);
  }
}

// 3. ```json fences parse.
function checkJsonFences(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const fencePattern = /```json\n([\s\S]*?)```/g;
  let match;
  let index = 0;
  while ((match = fencePattern.exec(text)) !== null) {
    index += 1;
    try {
      JSON.parse(match[1]);
    } catch (error) {
      fail(`${rel}: json fence #${index} does not parse (${error.message})`);
    }
  }
}
for (const rel of REQUIRED_FILES) if (rel.endsWith('.md')) checkJsonFences(rel);

// 4. Backticked repo paths resolve (repo-root-relative, no globs/templates).
const PATH_PREFIXES = ['electron/', 'src/', 'scripts/', 'tests/', 'server/', 'docs/'];
function checkRepoPaths(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const tokenPattern = /`([^`\s]+)`/g;
  let match;
  while ((match = tokenPattern.exec(text)) !== null) {
    const token = match[1];
    if (/[{*]/.test(token)) continue;
    if (!PATH_PREFIXES.some((prefix) => token.startsWith(prefix))) continue;
    const bare = token.split('#')[0];
    if (!fs.existsSync(path.join(root, bare))) fail(`${rel}: referenced path not found: ${bare}`);
  }
}
for (const rel of REQUIRED_FILES) if (rel.endsWith('.md')) checkRepoPaths(rel);

// 5. README index consistency: every required doc listed on its own line.
const readmePath = path.join(root, 'README.md');
if (fs.existsSync(readmePath)) {
  const readmeLines = fs.readFileSync(readmePath, 'utf8').split('\n');
  for (const name of [...CONTRACT_DOCS, ...USER_DOCS, ...DEV_DOCS]) {
    const entry = `${name}.md`;
    if (!readmeLines.some((line) => line.includes(entry))) fail(`README.md: missing doc index entry for ${entry}`);
  }
  if (!readmeLines.some((line) => line.includes('quick-start-guide.html'))) fail('README.md: missing doc index entry for quick-start-guide.html');
}

if (errors.length > 0) {
  console.error(`check-docs: ${errors.length} problem(s) found`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`OK (${REQUIRED_FILES.length} docs validated: ${CONTRACT_DOCS.length} contracts, ${USER_DOCS.length} user, ${DEV_DOCS.length} dev)`);
