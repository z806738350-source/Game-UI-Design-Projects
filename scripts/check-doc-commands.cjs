#!/usr/bin/env node
// Validate that every `pnpm <script>` / `pnpm run <script>` command quoted in
// documentation actually exists in package.json. Read-only: never mutates
// files. Fenced bash blocks and inline backtick spans are both scanned, so a
// checklist item like `` `pnpm run fixture-e2e` `` fails docs-validate when
// the script does not exist. Exported as checkDocCommands(root) so negative
// fixtures can point the check at a synthetic workspace.
const fs = require('node:fs');
const path = require('node:path');

// pnpm built-ins that never map to package.json scripts.
const PNPM_BUILTINS = new Set([
  'install', 'i', 'add', 'remove', 'update', 'outdated', 'why', 'audit',
  'exec', 'dlx', 'publish', 'pack', 'store', 'config', 'init', 'setup',
  'rebuild', 'prune', 'fetch', 'link', 'unlink', 'import', 'install-test'
]);

// Documents that intentionally quote broken commands as defect evidence
// (audit verdicts); they are exempt from command validation.
const EXEMPT_DOCS = [
  'docs/Game UI Design Copilot 剩余整改任务与执行指导.md',
  'docs/Game-UI-Design-Copilot-v0.2.1-剩余未闭环要求与最终整改执行指导.md',
  'docs/Game UI Design Copilot PR #25 前端整合与新用户说明书审核结论.md'
];

function listMarkdownFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

// Returns an array of problem strings (empty = every quoted pnpm command
// resolves to a package.json script or a pnpm built-in).
function checkDocCommands(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const scripts = new Set(Object.keys(pkg.scripts || {}));

  const docsDir = path.join(root, 'docs');
  // 新用户说明书是单文件 HTML，内联代码块中的 pnpm 命令同样需要校验
  const guideHtml = path.join(docsDir, 'user', 'quick-start-guide.html');
  const candidates = [path.join(root, 'README.md'), ...(fs.existsSync(docsDir) ? listMarkdownFiles(docsDir) : []), ...(fs.existsSync(guideHtml) ? [guideHtml] : [])];
  const problems = [];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(root, file);
    if (EXEMPT_DOCS.includes(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    // Match `pnpm <name>` and `pnpm run <name>` anywhere (fences or inline).
    // The first captured character must be alphanumeric/colon/underscore so
    // flag-style invocations like `pnpm --filter app run build` never match.
    for (const match of text.matchAll(/\bpnpm(?:\s+run)?\s+([A-Za-z0-9:_][A-Za-z0-9:_-]*)/g)) {
      const name = match[1];
      if (PNPM_BUILTINS.has(name)) continue;
      if (!scripts.has(name)) problems.push(`${rel}: pnpm command references missing script \`${name}\``);
    }
  }
  return problems;
}

module.exports = { checkDocCommands };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const problems = checkDocCommands(root);
  if (problems.length) {
    console.error(`check-doc-commands: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-doc-commands: OK (every documented pnpm command resolves to a script or built-in)');
}
