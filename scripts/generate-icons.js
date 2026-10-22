/**
 * Membuat ikon PWA (192 & 512 px) sebagai PNG tanpa dependency gambar.
 *
 * Format PNG ditulis manual: signature + IHDR + IDAT (zlib) + IEND.
 * Ikon berupa kuadrat orange dengan glyph "Nl" (.Restoran Nusantara).
 *
 *   node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(process.cwd(), 'public', 'icons');

/* ------------------------------ PNG writer ----------------------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePng(file, size, pixelFn) {
  const raw = Buffer.alloc(size * (size * 4 + 1));

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  fs.writeFileSync(file, png);
  return png.length;
}

/* ------------------------------- Drawing ------------------------------- */
/** Setengah lingkaran + garis tinggi, menyerupai piring/garpu. */
function icon(x, y, size) {
  const cx = size / 2;
  const cy = size / 2;
  const u = size / 32; // unit grid

  const orange = [234, 88, 12, 255];
  const cream = [255, 247, 237, 255];
  const dark = [55, 20, 6, 255];

  // Sudut membulat -> transparan
  const radius = size * 0.22;
  const cornerX = Math.min(x, size - 1 - x);
  const cornerY = Math.min(y, size - 1 - y);
  if (cornerX < radius && cornerY < radius) {
    const dx = radius - cornerX;
    const dy = radius - cornerY;
    if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];
  }

  // Lingkaran piring
  const dist = Math.hypot(x - cx, y - cy);
  const plateR = size * 0.36;

  // Garis "N" di tengah
  const nx = (x - cx) / u;
  const ny = (y - cy) / u;
  const stroke = 2.4;
  const inN =
    (Math.abs(nx) <= stroke && Math.abs(ny) <= 6) ||
    (Math.abs(ny) <= stroke && Math.abs(nx) <= 4.5) ||
    (Math.abs(nx + 4.5) <= stroke && Math.abs(ny) <= 6);
  const inDiagonal = Math.abs(nx + ny - 1.5) <= stroke * 0.9 && Math.abs(ny) <= 6 && Math.abs(nx) <= 5;

  if (inN || inDiagonal) return dark;

  // Cincin luar piring
  const ringOuter = plateR;
  const ringInner = plateR * 0.82;
  if (dist <= ringOuter && dist >= ringInner) return cream;

  // Isi piring
  if (dist < ringInner) {
    // Garis pemisah piring
    if (Math.abs(ny + 1.2) <= 0.9 && Math.abs(nx) <= 5.2) return [253, 186, 116, 255];
    return orange;
  }

  return orange;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const results = [];
  for (const size of [192, 512]) {
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    const bytes = writePng(file, size, icon);
    results.push({ size, bytes });
  }

  // Favicon 32px untuk tab browser
  const favicon = path.join(process.cwd(), 'src', 'app', 'favicon.ico');
  if (!fs.existsSync(favicon)) {
    writePng(path.join(process.cwd(), 'src', 'app', 'icon-32.png'), 32, icon);
  }

  console.log('');
  console.log('Ikon PWA berhasil dibuat:');
  results.forEach((r) => {
    console.log(`  icon-${r.size}.png — ${r.size}x${r.size}, ${(r.bytes / 1024).toFixed(1)} KB`);
  });
  console.log(`  lokasi: ${path.relative(process.cwd(), OUT_DIR)}`);
  console.log('');
}

main();