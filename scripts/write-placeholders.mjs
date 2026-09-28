import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "connection-test", "assets");
fs.mkdirSync(root, { recursive: true });

writePng(path.join(root, "background.png"), 1920, 1080, (x, y) => {
  const vignette = Math.max(0, 18 - Math.floor((Math.abs(x - 960) + Math.abs(y - 540)) / 80));
  return [18 + vignette, 28 + vignette, 42 + vignette, 255];
});

writePng(path.join(root, "dialogue-frame.png"), 1600, 250, (x, y, width, height) => {
  const border = x < 10 || y < 10 || x >= width - 10 || y >= height - 10;
  if (border) return [150, 196, 214, 255];
  return [8, 18, 28, 210];
});

writePng(path.join(root, "cursor.png"), 48, 32, (x, y) => {
  const inArrow = x >= 4 && x <= 28 && y >= 8 && y <= 24 && y - 8 >= (28 - x) * 0.35 && 24 - y >= (28 - x) * 0.35;
  if (inArrow) return [233, 246, 255, 255];
  return [0, 0, 0, 0];
});

function writePng(file, width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y, width, height);
      const index = row + 1 + x * 4;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
      raw[index + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
