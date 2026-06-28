// gen-icons.js — creates blue square PNGs using only Node built-ins (zlib)
// Run: node frontend/scripts/gen-icons.js from repo root
const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf  = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size, r, g, b) {
  // IHDR: width, height, bit-depth=8, colorType=2 (RGB), compression=0, filter=0, interlace=0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; ihdrData[9] = 2;

  // Raw pixel data: each row = 1 filter byte (0) + width*3 RGB bytes
  const rowLen  = 1 + size * 3;
  const rawData = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    rawData[off] = 0; // filter None
    for (let x = 0; x < size; x++) {
      rawData[off + 1 + x * 3]     = r;
      rawData[off + 1 + x * 3 + 1] = g;
      rawData[off + 1 + x * 3 + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdrData),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// D7 blue: #1d4ed8
const [R, G, B] = [0x1d, 0x4e, 0xd8];

const outDir = path.join(__dirname, "..", "public");
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, "icon-192.png"), makePNG(192, R, G, B));
fs.writeFileSync(path.join(outDir, "icon-512.png"), makePNG(512, R, G, B));

console.log("✓ icon-192.png  (" + fs.statSync(path.join(outDir, "icon-192.png")).size + " bytes)");
console.log("✓ icon-512.png  (" + fs.statSync(path.join(outDir, "icon-512.png")).size + " bytes)");
