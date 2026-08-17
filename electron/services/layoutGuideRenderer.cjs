const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type); const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0); name.copy(output, 4); data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

function fillRect(pixels, width, height, bbox, value) {
  const [x, y, w, h] = bbox;
  const left = Math.max(0, Math.floor(x * width)); const top = Math.max(0, Math.floor(y * height));
  const right = Math.min(width, Math.ceil((x + w) * width)); const bottom = Math.min(height, Math.ceil((y + h) * height));
  for (let row = top; row < bottom; row += 1) for (let column = left; column < right; column += 1) pixels[row * width + column] = value;
}

function renderLayoutGuide(contract, outputWidth = 384) {
  const [canvasWidth, canvasHeight] = contract.canvas;
  const width = outputWidth; const height = Math.max(1, Math.round(outputWidth * canvasHeight / canvasWidth));
  const pixels = Buffer.alloc(width * height, 96);
  for (const region of contract.focal_regions || []) fillRect(pixels, width, height, region.bbox, 176);
  for (const region of contract.reserved_regions || []) fillRect(pixels, width, height, region.bbox, 32);
  const raw = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) { raw[row * (width + 1)] = 0; pixels.copy(raw, row * (width + 1) + 1, row * width, (row + 1) * width); }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return { buffer: png, width, height, hash: `sha256:${crypto.createHash('sha256').update(png).digest('hex')}` };
}

async function writeLayoutGuide(projectPath, screenId, contract) {
  const rendered = renderLayoutGuide(contract);
  const target = path.join(projectPath, 'screens', screenId, 'underlay-layout-guide.png');
  await fs.writeFile(target, rendered.buffer);
  return { id: `${screenId}-underlay-layout-guide`, path: `screens/${screenId}/underlay-layout-guide.png`, image_hash: rendered.hash, width: rendered.width, height: rendered.height, source: { underlay_contract: contract.id } };
}

module.exports = { renderLayoutGuide, writeLayoutGuide };

