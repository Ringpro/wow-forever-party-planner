// Draws the small status dots the Discord board uses as app emojis: a filled circle in the
// middle of a transparent square, so it shows at about the size of a letter.
import { deflateSync } from "node:zlib";

export const DOT_COLOURS = {
  yes: [0x23, 0xa5, 0x5a],
  maybe: [0xf0, 0xb2, 0x32],
  no: [0xda, 0x37, 0x3c],
  unknown: [0x6d, 0x71, 0x7b],
} as const;

const SIZE = 128;
const RADIUS = 40;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG of one anti-aliased dot. */
export function dotPng([r, g, b]: readonly [number, number, number]): Buffer {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  const centre = (SIZE - 1) / 2;
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x - centre, y - centre);
      const alpha = Math.max(0, Math.min(1, RADIUS + 0.5 - distance));
      const at = y * (SIZE * 4 + 1) + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = Math.round(alpha * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}
