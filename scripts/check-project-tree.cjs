#!/usr/bin/env node
// Project-directory fact-integrity check (F-02/B). Three-way validation:
//   1. The README tree between <!-- PROJECT_TREE:BEGIN/END --> documents every
//      path required by docs/schemas/project-directory.required.json.
//   2. The golden fixture workspace contains the core evidence file set.
//   3. electron/services/artifactRegistry.cjs defines no official artifact
//      that the machine fact source leaves undocumented.
// Read-only: never mutates files. Exported as checkProjectTree(root) so
// negative fixtures can point the check at a synthetic workspace.
const fs = require('node:fs');
const path = require('node:path');

// Rebuild the set of full relative paths documented by a box-drawing tree
// block. Depth comes from the column of the ├─/└─ connector (4 columns per
// level); a bare top-level directory entry (e.g. `project/`) is treated as
// the container root and stripped from every path. A leaf documented under
// the wrong parent therefore never matches its required path.
function documentedTreePaths(treeText) {
  const paths = new Set();
  const dirStack = []; // dirStack[i] = directory name at depth i
  let hasRootDir = false;
  for (const rawLine of treeText.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const connectorIndexes = [line.indexOf('├── '), line.indexOf('└── ')].filter((index) => index !== -1);
    const connectorIndex = connectorIndexes.length ? Math.min(...connectorIndexes) : -1;
    let depth;
    let name;
    if (connectorIndex === -1) {
      depth = 0;
      name = line.trim();
      dirStack.length = 0;
      hasRootDir = false;
    } else {
      depth = Math.floor(connectorIndex / 4) + 1;
      name = line.slice(connectorIndex + 4).trim();
      dirStack.length = Math.max(hasRootDir ? 1 : 0, depth);
    }
    name = (name.split(/\s+#/)[0] || '').trim(); // drop trailing annotation
    if (!name) continue;
    const isDir = name.endsWith('/');
    const entry = isDir ? name.slice(0, -1) : name;
    if (depth === 0 && isDir) {
      hasRootDir = true;
      dirStack[0] = entry;
      continue;
    }
    const segments = [...dirStack.slice(0, depth), entry];
    paths.add((hasRootDir ? segments.slice(1) : segments).join('/'));
    if (isDir) dirStack[depth] = entry;
  }
  return paths;
}

// Screen-scoped entries live under screens/{screen_id}/ in the tree, so they
// match any documented path that ends with the required suffix beneath a
// screens/ directory; all other groups require an exact path.
function isDocumented(paths, relativePath, screenScoped) {
  if (screenScoped) {
    for (const documented of paths) {
      if (documented.endsWith(`/${relativePath}`) && documented.includes('screens/')) return true;
    }
    return false;
  }
  return paths.has(relativePath);
}

// Returns an array of problem strings (empty = all three sources agree).
function checkProjectTree(root) {
  const problems = [];
  const factPath = path.join(root, 'docs', 'schemas', 'project-directory.required.json');
  const readmePath = path.join(root, 'README.md');
  if (!fs.existsSync(factPath)) {
    return [`missing ${path.relative(root, factPath)}`];
  }
  const fact = JSON.parse(fs.readFileSync(factPath, 'utf8'));

  // --- 1. README PROJECT_TREE block -----------------------------------------
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf8') : '';
  if (!readme) {
    problems.push('README.md: missing');
  } else {
    const begin = readme.indexOf('<!-- PROJECT_TREE:BEGIN -->');
    const end = readme.indexOf('<!-- PROJECT_TREE:END -->');
    if (begin === -1 || end === -1 || end <= begin) {
      problems.push('README.md: missing or misordered <!-- PROJECT_TREE:BEGIN/END --> markers');
    }
    const tree = begin !== -1 && end > begin ? readme.slice(begin, end) : '';
    const paths = documentedTreePaths(tree);
    for (const group of ['root_files', 'workflow_files', 'global_artifact_paths', 'screen_artifact_files', 'screen_support_paths']) {
      const screenScoped = group === 'screen_artifact_files' || group === 'screen_support_paths';
      for (const required of fact[group] || []) {
        if (!isDocumented(paths, required, screenScoped)) problems.push(`README.md PROJECT_TREE: missing required path ${required} (${group})`);
      }
    }
  }

  // --- 2. Golden fixture workspace core set ---------------------------------
  const goldenRoot = path.join(root, fact.golden_workspace || '');
  if (!fact.golden_workspace || !fs.existsSync(goldenRoot)) {
    problems.push(`golden workspace not found at ${fact.golden_workspace || '<unset>'}`);
  } else {
    for (const required of fact.golden_required_files || []) {
      if (!fs.existsSync(path.join(goldenRoot, required))) problems.push(`golden workspace: missing core evidence file ${required}`);
    }
  }

  // --- 3. Artifact Registry fully documented --------------------------------
  const { GLOBAL_ARTIFACTS, SCREEN_ARTIFACTS } = require(path.join(root, 'electron', 'services', 'artifactRegistry.cjs'));
  const documentedGlobal = new Set(fact.global_artifact_paths || []);
  const documentedScreen = new Set(fact.screen_artifact_files || []);
  for (const [kind, relative] of Object.entries(GLOBAL_ARTIFACTS)) {
    if (!documentedGlobal.has(relative)) problems.push(`artifactRegistry.cjs: official global artifact '${kind}' (${relative}) is not in project-directory.required.json`);
  }
  for (const [kind, relative] of Object.entries(SCREEN_ARTIFACTS)) {
    if (!documentedScreen.has(relative)) problems.push(`artifactRegistry.cjs: official screen artifact '${kind}' (${relative}) is not in project-directory.required.json`);
  }
  return problems;
}

module.exports = { checkProjectTree };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const problems = checkProjectTree(root);
  if (problems.length) {
    console.error(`check-project-tree: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-project-tree: OK (README tree, golden workspace, registry coverage)');
}
