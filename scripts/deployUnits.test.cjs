'use strict';

// 双版本 unit 模板门禁。失败场景是 2026-09-02 线上实际发生的：经典版 unit 的路径类变量
// 取自与单版本回滚 unit 共享的 online.env，其中 DESIGN_COPILOT_DIST_ROOT 指向
// /opt/game-ui-design-copilot-online/current/dist，于是 activate-dual-version.sh 一移动
// current，钉住在 20260812-113232-f9dc444 的经典版后端就开始下发含图库入口的新前端，
// 而它自己没有 /api/gallery 路由。Git 历史能说明改过什么，但挡不住下一次有人把内联钉住
// 的变量「简化」回 EnvironmentFile，因此这里保留一条针对模板文本的断言。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const deployDir = path.join(repoRoot, 'deploy', 'online');
const CLASSIC_RELEASE_DIR = '@@CLASSIC_RELEASE_DIR@@';
const CLASSIC_DATA_ROOT = '/var/lib/game-ui-design-copilot-online';
const CLASSIC_PINNED_RELEASE = '20260812-113232-f9dc444';

const readDeployFile = (name) => fs.readFileSync(path.join(deployDir, name), 'utf8');

// ExecStart 里的内联环境变量：/usr/bin/env 与真正可执行文件之间的 KEY=VALUE 序列。
function inlineEnvOfExecStart(unitText) {
  const line = unitText.split('\n').find((entry) => entry.startsWith('ExecStart='));
  assert.ok(line, 'unit 模板必须有 ExecStart');
  const tokens = line.slice('ExecStart='.length).split(/\s+/);
  const assignments = [];
  for (const token of tokens.slice(1)) {
    if (!/^[A-Z_][A-Z0-9_]*=/.test(token)) break;
    assignments.push(token);
  }
  return assignments;
}

// 返回违规列表而不是直接断言，好让同一个函数既能校验仓库模板（正向对照），
// 也能校验被人为改坏的模板（负向对照）。
function auditClassicUnit(unitText) {
  const problems = [];
  const env = inlineEnvOfExecStart(unitText);
  const distRoot = env.find((entry) => entry.startsWith('DESIGN_COPILOT_DIST_ROOT='));
  const dataRoot = env.find((entry) => entry.startsWith('DESIGN_COPILOT_DATA_ROOT='));

  if (distRoot !== `DESIGN_COPILOT_DIST_ROOT=${CLASSIC_RELEASE_DIR}/dist`) {
    problems.push(`DIST_ROOT 未内联钉住到经典版自己的 release：${distRoot || '缺失'}`);
  }
  if (dataRoot !== `DESIGN_COPILOT_DATA_ROOT=${CLASSIC_DATA_ROOT}`) {
    problems.push(`DATA_ROOT 未内联钉住到经典版数据根：${dataRoot || '缺失'}`);
  }
  if (/\/current(?:\/|\b)/.test(unitText)) {
    problems.push('模板引用了可变的 current 符号链接');
  }
  const placeholders = new Set(unitText.match(/@@[A-Z_]+@@/g) || []);
  for (const placeholder of placeholders) {
    if (placeholder !== CLASSIC_RELEASE_DIR) problems.push(`未知占位符 ${placeholder}，部署脚本不会替换它`);
  }
  const rendered = unitText.split(CLASSIC_RELEASE_DIR).join(`/opt/game-ui-design-copilot-online/releases/${CLASSIC_PINNED_RELEASE}`);
  if (/@@/.test(rendered)) problems.push('替换后仍残留占位符');
  return problems;
}

test('经典版 unit 模板把 DIST_ROOT 与 DATA_ROOT 钉在自己的 release 上', () => {
  assert.deepEqual(auditClassicUnit(readDeployFile('game-ui-design-copilot-classic.service')), []);
});

test('改回从共享 env 继承路径的经典版 unit 会被门禁拦下', () => {
  // 2026-09-02 之前的模板原文：两个路径变量都不在 ExecStart 里。
  const drifted = readDeployFile('game-ui-design-copilot-classic.service')
    .replace(/ DESIGN_COPILOT_DATA_ROOT=\S+/, '')
    .replace(/ DESIGN_COPILOT_DIST_ROOT=\S+/, '');
  const problems = auditClassicUnit(drifted);
  assert.equal(problems.length, 2, problems.join('；'));
  assert.match(problems[0], /DIST_ROOT 未内联钉住/);
  assert.match(problems[1], /DATA_ROOT 未内联钉住/);

  // 另一种改法：内联但指向 current，等价于把漂移写进模板本身。
  const viaCurrent = readDeployFile('game-ui-design-copilot-classic.service')
    .replace('DESIGN_COPILOT_DIST_ROOT=@@CLASSIC_RELEASE_DIR@@/dist', 'DESIGN_COPILOT_DIST_ROOT=/opt/game-ui-design-copilot-online/current/dist');
  const currentProblems = auditClassicUnit(viaCurrent);
  assert.ok(currentProblems.some((entry) => /current 符号链接/.test(entry)), currentProblems.join('；'));
});

test('新版 unit 模板与 prepare 脚本让每个 release 只跑自己的代码与前端', () => {
  const currentUnit = readDeployFile('game-ui-design-copilot-current.service');
  assert.match(currentUnit, /^WorkingDirectory=@@CURRENT_RELEASE_DIR@@$/m);
  assert.match(currentUnit, /^ExecStart=\S*node @@CURRENT_RELEASE_DIR@@\/server\/webServer\.cjs$/m);
  assert.ok(!/\/current(?:\/|\b)/.test(currentUnit), '新版 unit 不得引用 current 符号链接');

  // 新版的 DIST_ROOT 由 prepare 脚本按候选 release 重写进独立的 current.env，
  // 这条断言盯住那个机制：一旦改成静态模板值，新版就会与经典版犯同一类错。
  const prepare = readDeployFile('prepare-dual-version.sh');
  assert.match(prepare, /DESIGN_COPILOT_DIST_ROOT=\$release_dir\/dist/);
  assert.match(prepare, /DESIGN_COPILOT_DATA_ROOT=\$data_root\/version-data\/v2/);
  // 经典版 unit 每次都从候选 release 的模板重装，所以仓库模板就是线上的事实来源。
  assert.match(prepare, /sed "s\|@@CLASSIC_RELEASE_DIR@@\|\$classic_release\|g" "\$release_dir\/deploy\/online\/game-ui-design-copilot-classic\.service"/);
  assert.match(prepare, /^classic_unit=\/etc\/systemd\/system\/game-ui-design-copilot-classic\.service$/m);
  assert.match(prepare, /install -o root -g root -m 0644 "\$classic_unit_tmp" "\$classic_unit"/);

  // systemctl start 对已运行的经典版是空操作，改过的 unit 进不了运行中的进程；
  // 只有内容变了才 restart。少了这一步，模板修复在线上等于没修。
  const cmpCall = 'if test -f "$classic_unit" && cmp -s "$classic_unit_tmp" "$classic_unit"; then classic_unit_changed=0; fi';
  const installCall = 'install -o root -g root -m 0644 "$classic_unit_tmp" "$classic_unit"';
  assert.match(prepare, /if test "\$classic_unit_changed" -eq 1; then\n\s+systemctl restart game-ui-design-copilot-classic\.service/);

  // 顺序本身就是正确性的一部分：install 会覆盖线上 unit，cmp 必须在它之前比对，
  // 否则两边恒等、classic_unit_changed 永远是 0，restart 分支永不执行——正好复活本次修的 bug。
  // 单纯 assert.match 挡不住换序（实测两条都仍然匹配），所以这里比位置。
  const assertCmpBeforeInstall = (text) => {
    const cmpAt = text.indexOf(cmpCall);
    const installAt = text.indexOf(installCall);
    assert.ok(cmpAt > -1, 'prepare 必须用 cmp 比对渲染后的经典版 unit');
    assert.ok(installAt > -1, 'prepare 必须安装渲染后的经典版 unit');
    assert.ok(cmpAt < installAt, 'cmp 必须在 install 覆盖线上 unit 之前，否则永远判定「未变化」');
  };
  assertCmpBeforeInstall(prepare);
  const swapped = prepare.replace(cmpCall, '@@CMP@@').replace(installCall, cmpCall).replace('@@CMP@@', installCall);
  assert.throws(() => assertCmpBeforeInstall(swapped), /cmp 必须在 install/, '换序后门禁必须报错');

  // 预检必须证明钉住真的生效在运行进程上，而不是只看装好的 unit 文件。四项都要查：
  // 只查 DIST_ROOT 时，把模板里的 RELEASE_ID 改成新 release id 不会被发现（审查实测），
  // 经典版会顶着「新版」标识跑旧码，而路由的版本标签正是从上游取的。
  assert.match(prepare, /if test ! -r "\/proc\/\$classic_pid\/environ"; then/, 'dash 下管道内重定向失败不触发 set -e，必须先分清「读不到」与「值漂移」');
  assert.match(prepare, /classic_dist_root=\$\(printf '%s\\n' "\$classic_env" \| sed -n 's\|\^DESIGN_COPILOT_DIST_ROOT=\|\|p'\)/);
  assert.match(prepare, /classic_data_root=\$\(printf '%s\\n' "\$classic_env" \| sed -n 's\|\^DESIGN_COPILOT_DATA_ROOT=\|\|p'\)/);
  assert.match(prepare, /classic_release_id=\$\(printf '%s\\n' "\$classic_env" \| sed -n 's\|\^DESIGN_COPILOT_RELEASE_ID=\|\|p'\)/);
  assert.match(prepare, /classic_cwd=\$\(readlink -f "\/proc\/\$classic_pid\/cwd"\)/);
  assert.match(prepare, /test "\$classic_dist_root" != "\$classic_release\/dist"/);
  assert.match(prepare, /test "\$classic_data_root" != "\$data_root"/);
  assert.match(prepare, /test "\$classic_release_id" != "\$classic_expected_id"/);
  assert.match(prepare, /test "\$classic_cwd" != "\$classic_release"/);
  assert.match(prepare, /classic-not-pinned/);
  // 断言只提取路径与 id，不得把整个进程环境打印出来（那里有 FEISHU_APP_SECRET、SESSION_SECRET）。
  assert.ok(!/echo[^\n]*"\$classic_env"/.test(prepare), '不得打印整个进程环境');
  const envUses = (prepare.match(/"\$classic_env"/g) || []).length;
  const envExtractions = (prepare.match(/printf '%s\\n' "\$classic_env"/g) || []).length;
  assert.equal(envUses, envExtractions, '进程环境只能经 printf 逐键提取，不得整体使用');
  assert.ok(envExtractions >= 3, '至少提取 DIST_ROOT、DATA_ROOT、RELEASE_ID 三个键');

  // 候选被拒时只在真的动过经典版 unit 时才回滚它：因新版侧原因失败不该重启默认落地的经典版。
  assert.match(prepare, /if test "\$classic_unit_changed" -eq 1; then\n\s+if test -f "\$classic_unit_backup"; then/);
  assert.match(prepare, /install -o root -g root -m 0644 "\$classic_unit_backup" "\$classic_unit"/);
  assert.match(prepare, /systemctl restart game-ui-design-copilot-classic\.service \|\| true/);
  // 首次部署原本没有经典版 unit：先停服再删，避免 unit 已删而进程仍在跑。
  assert.match(prepare, /systemctl stop game-ui-design-copilot-classic\.service \|\| true/);
  // cleanup 跑在 EXIT trap 里，标志必须在使用前初始化，否则 set -u 下早期失败会中断回滚。
  const initAt = prepare.indexOf('classic_unit_changed=0');
  const trapAt = prepare.indexOf('trap cleanup EXIT');
  assert.ok(initAt > -1 && trapAt > -1 && initAt < trapAt, 'classic_unit_changed 必须在注册 EXIT trap 之前初始化');
});

test('经典版钉住的 release id 在模板与部署脚本里必须一致', () => {
  // 三处硬编码同一个 release id（模板内联 RELEASE_ID、prepare 的 classic_release、本测试）。
  // 只改其中一处会让经典版后端与前端/标识分属两个 release，正是本次修复的同一类缺陷。
  const template = readDeployFile('game-ui-design-copilot-classic.service');
  const prepare = readDeployFile('prepare-dual-version.sh');
  const pinned = CLASSIC_PINNED_RELEASE;
  assert.match(template, new RegExp(`DESIGN_COPILOT_RELEASE_ID=${pinned}`), '模板内联的 RELEASE_ID');
  assert.match(template, new RegExp(`^WorkingDirectory=@@CLASSIC_RELEASE_DIR@@$`, 'm'), '模板的 WorkingDirectory 用占位符，由 prepare 替换成钉住目录');
  assert.match(prepare, new RegExp(`^classic_release="\\$install_root/releases/${pinned}"$`, 'm'), 'prepare 的 classic_release');
  assert.ok(template.split(pinned).length - 1 >= 1, '模板必须内联钉住 RELEASE_ID');
  assert.ok(template.split(CLASSIC_RELEASE_DIR).length - 1 >= 3, '模板必须在 WorkingDirectory、DIST_ROOT 与 ExecStart 三处用钉住目录占位符');
});
