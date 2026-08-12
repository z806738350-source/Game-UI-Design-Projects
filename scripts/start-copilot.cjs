const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronBinary = process.platform === 'darwin'
  ? path.join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : process.platform === 'win32'
    ? path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron');
const port = 5174;
const devServerUrl = `http://127.0.0.1:${port}`;

let viteProcess = null;
let electronProcess = null;
let shuttingDown = false;

function portIsOpen(targetPort, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: targetPort, host });
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }
    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function isCopilotServer() {
  if (!await portIsOpen(port)) return false;
  try {
    const response = await fetch(devServerUrl, { signal: AbortSignal.timeout(1000) });
    return response.ok && (await response.text()).includes('<title>Game UI Design Copilot</title>');
  } catch {
    return false;
  }
}

async function waitForCopilotServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCopilotServer()) return;
    if (viteProcess?.exitCode !== null) {
      throw new Error(`前端服务提前退出，代码：${viteProcess.exitCode}。`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('前端服务未能在 15 秒内启动。');
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChild(electronProcess);
  stopChild(viteProcess);
  process.exitCode = exitCode;
}

function verifyDependencies() {
  if (!fs.existsSync(viteEntry) || !fs.existsSync(electronBinary)) {
    throw new Error('项目依赖不完整，请先在项目目录运行 pnpm install。');
  }
}

async function checkReady() {
  verifyDependencies();
  const occupied = await portIsOpen(port);
  const reusable = occupied && await isCopilotServer();
  if (occupied && !reusable) {
    throw new Error(`端口 ${port} 正被其他应用占用。`);
  }
  console.log(JSON.stringify({ ok: true, dependencies: true, port, reusableServer: reusable }));
}

async function main() {
  verifyDependencies();
  const portOccupied = await portIsOpen(port);
  const reusableServer = portOccupied && await isCopilotServer();
  if (portOccupied && !reusableServer) {
    throw new Error(`端口 ${port} 正被其他应用占用，请关闭占用程序后重试。`);
  }

  if (!reusableServer) {
    console.log('正在启动 Game UI Design Copilot…');
    viteProcess = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1'], {
      cwd: projectRoot,
      stdio: 'inherit'
    });
    await waitForCopilotServer();
  } else {
    console.log('检测到现有前端服务，将直接复用。');
  }

  electronProcess = spawn(electronBinary, [projectRoot], {
    cwd: projectRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
    stdio: 'inherit'
  });
  electronProcess.once('error', (error) => {
    console.error(`无法启动桌面应用：${error.message}`);
    shutdown(1);
  });
  electronProcess.once('close', (code) => {
    electronProcess = null;
    stopChild(viteProcess);
    viteProcess = null;
    process.exitCode = code || 0;
  });
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
process.once('exit', () => {
  stopChild(electronProcess);
  stopChild(viteProcess);
});

if (require.main === module) {
  const command = process.argv.includes('--check') ? checkReady : main;
  command().catch((error) => {
    console.error(`启动失败：${error instanceof Error ? error.message : String(error)}`);
    shutdown(1);
  });
}

module.exports = { checkReady, isCopilotServer, portIsOpen, verifyDependencies };
