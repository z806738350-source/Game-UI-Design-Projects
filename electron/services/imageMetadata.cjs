const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function gcd(a, b) {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

function canvasSpec(width, height) {
  const divisor = gcd(width, height);
  const orientation = height > width ? 'portrait' : width > height ? 'landscape' : 'square';
  return {
    width,
    height,
    orientation,
    aspect_ratio: `${width / divisor}:${height / divisor}`,
    generation_size: orientation === 'portrait' ? '864x1536' : orientation === 'landscape' ? '1536x864' : '1024x1024'
  };
}

function pngSize(bytes) {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) return null;
  return { format: 'png', mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { format: 'jpeg', mime: 'image/jpeg', height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    return { format: 'webp', mime: 'image/webp', width, height };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { format: 'webp', mime: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { format: 'webp', mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

async function readImageMetadata(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('不支持该图片格式。请使用 PNG、JPG 或 WebP；SVG 请先导出为位图。');
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('所选路径不是图片文件。');
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('图片超过 25MB，请压缩后重试。');
  const bytes = await fs.readFile(filePath);
  const metadata = imageMetadataFromBuffer(bytes);
  if (!metadata) throw new Error('图片内容无法识别或文件已损坏，请重新导出 PNG、JPG 或 WebP。');
  if (!metadata.width || !metadata.height || metadata.width > 16384 || metadata.height > 16384) {
    throw new Error('图片尺寸无效或超过 16384 像素上限。');
  }
  return { ...metadata, bytes: stat.size, canvas_spec: canvasSpec(metadata.width, metadata.height) };
}

function imageMetadataFromBuffer(bytes) {
  return pngSize(bytes) || jpegSize(bytes) || webpSize(bytes);
}

module.exports = { canvasSpec, imageMetadataFromBuffer, readImageMetadata };
