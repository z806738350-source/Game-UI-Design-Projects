'use strict';

// Negative fixtures for the docs fact-source gate (F-02): the three validators
// must FAIL when the documentation drifts from truth — a wrong pnpm command,
// an error code missing from (or unregistered in) ERROR-CATALOG, or a README
// tree that drops a key artifact. Each check function accepts an injectable
// root so synthetic workspaces can be built under os.tmpdir(). The real
// repository must stay green as the positive control.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const { checkErrorDocs } = require('./check-error-docs.cjs');
const { checkDocCommands } = require('./check-doc-commands.cjs');
const { checkProjectTree } = require('./check-project-tree.cjs');

function makeTempRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-fact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// --- check-error-docs --------------------------------------------------------

const REGISTRY_FIXTURE = `module.exports = {
  ERROR_CODES: Object.freeze({ PIPELINE_OK: 'PIPELINE_OK' }),
  FIDELITY_ISSUE_CODES: Object.freeze({ FIDELITY_OK: 'FIDELITY_OK' }),
  BINDING_VALIDATION_CODES: Object.freeze({ BINDING_OK: 'BINDING_OK' })
};
`;

function catalogFixture({ pipelineRow, fidelityRow, bindingRow, bindingHeading = '## 三、绑定语义校验码' }) {
  return [
    '# CATALOG',
    '',
    '## 一、管线错误码',
    '',
    '| 码 | 说明 |',
    '| --- | --- |',
    pipelineRow,
    '',
    '## 二、Fidelity 检查码',
    '',
    '| 码 | 说明 |',
    '| --- | --- |',
    fidelityRow,
    '',
    bindingHeading,
    '',
    '| 码 | 说明 |',
    '| --- | --- |',
    bindingRow,
    '',
    '## 四、校验机制',
    ''
  ].join('\n');
}

function buildErrorDocsFixture(t, catalogText, registryText = REGISTRY_FIXTURE) {
  const root = makeTempRoot(t);
  write(root, 'electron/services/errorCodes.cjs', registryText);
  write(root, 'docs/dev/ERROR-CATALOG.md', catalogText);
  return root;
}

test('check-error-docs: consistent synthetic catalog passes', (t) => {
  const root = buildErrorDocsFixture(t, catalogFixture({
    pipelineRow: '| `PIPELINE_OK` | ok |',
    fidelityRow: '| `FIDELITY_OK` | ok |',
    bindingRow: '| `BINDING_OK` | ok |'
  }));
  assert.deepEqual(checkErrorDocs(root), []);
});

test('check-error-docs: registry code missing from catalog fails', (t) => {
  const root = buildErrorDocsFixture(t, catalogFixture({
    pipelineRow: '| `PIPELINE_OK` | ok |',
    fidelityRow: '| `FIDELITY_OK` | ok |',
    bindingRow: '| `BINDING_OTHER` | placeholder |'
  }));
  const problems = checkErrorDocs(root);
  assert.ok(problems.some((p) => p.includes('BINDING_VALIDATION_CODES.BINDING_OK is missing from ERROR-CATALOG.md')), problems.join('\n'));
});

test('check-error-docs: documented but unregistered code fails', (t) => {
  const root = buildErrorDocsFixture(t, catalogFixture({
    pipelineRow: '| `PIPELINE_OK` | ok |',
    fidelityRow: '| `FIDELITY_OK` | ok |',
    bindingRow: '| `BINDING_OK` | ok |\n| `BINDING_FAKE_CODE` | ghost |'
  }));
  const problems = checkErrorDocs(root);
  assert.ok(problems.some((p) => p.includes('`BINDING_FAKE_CODE`') && p.includes('not registered')), problems.join('\n'));
});

test('check-error-docs: missing catalog section fails', (t) => {
  const root = buildErrorDocsFixture(t, catalogFixture({
    pipelineRow: '| `PIPELINE_OK` | ok |',
    fidelityRow: '| `FIDELITY_OK` | ok |',
    bindingRow: '| `BINDING_OK` | ok |',
    bindingHeading: '## 三、别的标题'
  }));
  const problems = checkErrorDocs(root);
  assert.ok(problems.some((p) => p.includes('missing catalog section')), problems.join('\n'));
});

test('check-error-docs: missing trailing boundary heading fails instead of swallowing prose', (t) => {
  const catalog = catalogFixture({
    pipelineRow: '| `PIPELINE_OK` | ok |',
    fidelityRow: '| `FIDELITY_OK` | ok |',
    bindingRow: '| `BINDING_OK` | ok |'
  }).replace('## 四、校验机制', '## 四、别的标题');
  const root = buildErrorDocsFixture(t, catalog);
  const problems = checkErrorDocs(root);
  assert.ok(problems.some((p) => p.includes('missing catalog section "## 四、校验机制"')), problems.join('\n'));
});

// --- check-doc-commands --------------------------------------------------------

function buildCommandFixture(t, readmeText, scripts = { build: 'vite build' }) {
  const root = makeTempRoot(t);
  write(root, 'package.json', JSON.stringify({ name: 'fixture', scripts }, null, 2));
  write(root, 'README.md', readmeText);
  return root;
}

test('check-doc-commands: valid script and pnpm built-ins pass', (t) => {
  const root = buildCommandFixture(t, '# T\n\n```bash\npnpm install\npnpm run build\n```\n');
  assert.deepEqual(checkDocCommands(root), []);
});

test('check-doc-commands: nonexistent script fails (wrong command)', (t) => {
  const root = buildCommandFixture(t, '# T\n\nRun `pnpm run fixture-e2e` before release.\n');
  const problems = checkDocCommands(root);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('missing script `fixture-e2e`'), problems[0]);
});

test('check-doc-commands: broken command inside docs/ also fails', (t) => {
  const root = buildCommandFixture(t, '# T\n');
  write(root, 'docs/dev/GUIDE.md', 'Then `pnpm nonexistent-gate`.\n');
  const problems = checkDocCommands(root);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('docs/dev/GUIDE.md'), problems[0]);
});

test('check-doc-commands: flag-style invocation is not mistaken for a script', (t) => {
  const root = buildCommandFixture(t, '# T\n\n```bash\npnpm --filter app run build\npnpm -w build\n```\n', { build: 'vite build' });
  assert.deepEqual(checkDocCommands(root), []);
});

// --- check-project-tree --------------------------------------------------------

const PROJECT_TREE_FACT = {
  schema_version: '1.0',
  root_files: ['project.json'],
  workflow_files: ['workflow/state.json'],
  global_artifact_paths: ['style/style-contract.json'],
  screen_artifact_files: ['composition-output.json', 'fidelity-report.json'],
  screen_support_paths: ['inputs.json'],
  golden_workspace: 'golden',
  golden_required_files: ['project.json']
};

const TREE_REGISTRY_FIXTURE = `module.exports = {
  GLOBAL_ARTIFACTS: Object.freeze({ 'style-contract': 'style/style-contract.json' }),
  SCREEN_ARTIFACTS: Object.freeze({
    'composition-output': 'composition-output.json',
    'fidelity-report': 'fidelity-report.json'
  })
};
`;

const COMPLETE_TREE_LINES = [
  'project/',
  '├── project.json',
  '├── workflow/',
  '│   └── state.json',
  '├── style/',
  '│   └── style-contract.json',
  '└── screens/',
  '    └── main/',
  '        ├── composition-output.json',
  '        ├── fidelity-report.json',
  '        └── inputs.json'
];

function buildTreeFixture(t, { treeLines = COMPLETE_TREE_LINES, fact = PROJECT_TREE_FACT, registry = TREE_REGISTRY_FIXTURE, goldenFiles = ['project.json'] } = {}) {
  const root = makeTempRoot(t);
  write(root, 'docs/schemas/project-directory.required.json', JSON.stringify(fact, null, 2));
  write(root, 'README.md', `# T\n\n<!-- PROJECT_TREE:BEGIN -->\n${treeLines.join('\n')}\n<!-- PROJECT_TREE:END -->\n`);
  write(root, 'electron/services/artifactRegistry.cjs', registry);
  for (const rel of goldenFiles) write(root, path.join(fact.golden_workspace || 'golden', rel), '{}');
  return root;
}

test('check-project-tree: consistent synthetic workspace passes', (t) => {
  const root = buildTreeFixture(t);
  assert.deepEqual(checkProjectTree(root), []);
});

test('check-project-tree: README missing a key artifact fails', (t) => {
  const root = buildTreeFixture(t, { treeLines: COMPLETE_TREE_LINES.filter((line) => !line.includes('composition-output.json')) });
  const problems = checkProjectTree(root);
  assert.ok(problems.some((p) => p.includes('README.md PROJECT_TREE: missing required path composition-output.json')), problems.join('\n'));
});

test('check-project-tree: missing PROJECT_TREE markers fails', (t) => {
  const root = buildTreeFixture(t);
  write(root, 'README.md', '# T\n\nproject.json\n');
  const problems = checkProjectTree(root);
  assert.ok(problems.some((p) => p.includes('PROJECT_TREE:BEGIN/END')), problems.join('\n'));
});

test('check-project-tree: leaf documented under the wrong parent fails', (t) => {
  // Regression guard for the inputs/requirement.md migration: every token is
  // present in the tree text, but requirement.md sits at the workspace root
  // instead of under screens/main/inputs/, so the gate must still fail.
  const fact = { ...PROJECT_TREE_FACT, screen_support_paths: ['inputs/requirement.md'] };
  const wrongParentTree = [
    'project/',
    '├── inputs/',
    '│   └── requirement.md',
    '└── screens/',
    '    └── main/',
    '        ├── inputs/',
    '        └── composition-output.json'
  ];
  const root = buildTreeFixture(t, { fact, treeLines: wrongParentTree });
  const problems = checkProjectTree(root);
  assert.ok(problems.some((p) => p.includes('missing required path inputs/requirement.md')), problems.join('\n'));
});

test('check-project-tree: nested leaf under the correct screen parent passes', (t) => {
  const fact = {
    schema_version: '1.0',
    root_files: [],
    workflow_files: [],
    global_artifact_paths: [],
    screen_artifact_files: ['composition-output.json'],
    screen_support_paths: ['inputs/requirement.md'],
    golden_workspace: 'golden',
    golden_required_files: ['project.json']
  };
  const registry = `module.exports = {
  GLOBAL_ARTIFACTS: Object.freeze({}),
  SCREEN_ARTIFACTS: Object.freeze({ 'composition-output': 'composition-output.json' })
};
`;
  const correctTree = [
    'project/',
    '└── screens/',
    '    └── main/',
    '        ├── composition-output.json',
    '        └── inputs/',
    '            └── requirement.md'
  ];
  const root = buildTreeFixture(t, { fact, registry, treeLines: correctTree });
  assert.deepEqual(checkProjectTree(root), []);
});

test('check-project-tree: golden workspace missing core evidence fails', (t) => {
  const root = buildTreeFixture(t, { goldenFiles: [] });
  fs.mkdirSync(path.join(root, 'golden'), { recursive: true });
  const problems = checkProjectTree(root);
  assert.ok(problems.some((p) => p.includes('golden workspace: missing core evidence file project.json')), problems.join('\n'));
});

test('check-project-tree: undocumented registry artifact fails', (t) => {
  const registry = `module.exports = {
  GLOBAL_ARTIFACTS: Object.freeze({ 'style-contract': 'style/style-contract.json' }),
  SCREEN_ARTIFACTS: Object.freeze({
    'composition-output': 'composition-output.json',
    'fidelity-report': 'fidelity-report.json',
    'ghost-artifact': 'ghost.json'
  })
};
`;
  const root = buildTreeFixture(t, { registry });
  const problems = checkProjectTree(root);
  assert.ok(problems.some((p) => p.includes("'ghost-artifact'") && p.includes('ghost.json')), problems.join('\n'));
});

// --- real repository positive control + CLI wiring -----------------------------

test('real repository: all three fact-source checks pass', () => {
  assert.deepEqual(checkErrorDocs(repoRoot), []);
  assert.deepEqual(checkDocCommands(repoRoot), []);
  assert.deepEqual(checkProjectTree(repoRoot), []);
});

test('real repository: four docs gate CLIs exit 0', () => {
  for (const script of ['check-docs.cjs', 'check-error-docs.cjs', 'check-doc-commands.cjs', 'check-project-tree.cjs']) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${script} failed:\n${result.stdout}${result.stderr}`);
  }
});
