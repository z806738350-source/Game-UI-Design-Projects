const fs = require('node:fs/promises');
const path = require('node:path');

async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

let writeSequence = 0;

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  // Date.now() 粒度不足以区分同毫秒并发写入，序列号保证 tmp 路径唯一。
  writeSequence = (writeSequence + 1) % 1_000_000;
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${writeSequence}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
  return value;
}

module.exports = { ensureDir, readJson, writeJson };
