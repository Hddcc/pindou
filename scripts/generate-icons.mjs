import {writeFile, mkdir} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
const output = new URL('../web/public/icons/', import.meta.url);
await mkdir(output, {recursive: true});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const b of buffer) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]);
}
for (const size of [192, 512]) {
  const raw = Buffer.alloc((size * 4 + 1) * size), grid = ['  GG  ', ' GGGG ', 'GGYYGG', 'GGYYGG', ' GGGG ', '  GG  '];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cellSize = size * .1, left = size * .2, gx = Math.floor((x - left) / cellSize), gy = Math.floor((y - left) / cellSize);
    const character = grid[gy]?.[gx];
    let rgb = [242, 247, 244];
    if (character && character !== ' ') {
      const gap = cellSize * .1, dx = (x - left) % cellSize, dy = (y - left) % cellSize;
      if (dx >= gap && dy >= gap && dx < cellSize - gap && dy < cellSize - gap) rgb = character === 'Y' ? [244, 207, 91] : [22, 112, 91];
    }
    const p = y * (size * 4 + 1) + 1 + x * 4; raw.set([...rgb, 255], p);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(new URL(`icon-${size}.png`, output), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
