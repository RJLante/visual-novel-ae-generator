import fs from "node:fs";

export function readImageSize(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 24 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buf.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc2) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  throw new Error(`无法读取图片尺寸，第一版只支持 PNG 和 JPEG：${filePath}`);
}
