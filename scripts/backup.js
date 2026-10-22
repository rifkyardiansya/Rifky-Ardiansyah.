/**
 * Membuat backup arsip ZIP berisi seluruh source project.
 *
 * Tidak memakai library eksternal: format ZIP ditulis manual memakai
 * `zlib.deflateRawSync` + CRC32. Ini membuat script bisa dijalankan di
 * Windows/Linux/macOS tanpa masalah path yang mengandung spasi.
 *
 * Yang DIKECUALIKAN (dapat diregenerate):
 *   node_modules/  -> npm install
 *   .next/         -> npm run build
 *   data/          -> npm run db:seed
 *   *.log          -> log runtime
 *   backup/        -> folder ini sendiri
 *
 *   npm run backup
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.cwd();
const BACKUP_DIR = path.join(ROOT, 'backup');
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  'data',
  'backup',
  'coverage',
  '.git',
  'test-results',
  'playwright-report',
]);
const ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  'postcss.config.js',
  'tailwind.config.js',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
  '.eslintrc.json',
  '.dockerignore',
  '.gitignore',
  '.env.example',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'README.md',
]);

/* ------------------------------- CRC32 ------------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/* -------------------------------- ZIP -------------------------------- */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const dosDate = (((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, date: dosDate };
}

function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const stamp = dosDateTime(new Date());

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf-8');
    const raw = entry.data;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4); // made by (UNIX)
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

/* ------------------------------ Collect ------------------------------ */
function collect(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...collect(full, rel));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.log') || entry.name.endsWith('.tsbuildinfo')) continue;
    if (base === '' && !ROOT_FILES.has(entry.name)) continue;

    out.push({ name: rel, data: fs.readFileSync(full) });
  }
  return out;
}

function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const entries = collect(ROOT);

  // Snapshot database ikut disertakan sebagai bukti state demo.
  const dataDir = path.join(ROOT, 'data');
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) {
      if (f.endsWith('.db')) {
        entries.push({
          name: `database-snapshot/${f}`,
          data: fs.readFileSync(path.join(dataDir, f)),
        });
      }
    }
  }

  const stampDate = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUP_DIR, `restoran-nusantara-${stampDate}.zip`);
  fs.writeFileSync(target, createZip(entries));

  const sizeKb = Math.round(fs.statSync(target).size / 1024);
  const lines = entries.reduce((n, e) => n + e.data.toString('utf-8').split('\n').length, 0);

  console.log('');
  console.log('Backup berhasil dibuat');
  console.log('─────────────────────────────────────────');
  console.log(`  file    : ${path.basename(target)}`);
  console.log(`  path    : ${target}`);
  console.log(`  file    : ${entries.length} berkas`);
  console.log(`  baris   : ${lines.toLocaleString('id-ID')} baris kode`);
  console.log(`  ukuran  : ${sizeKb} KB`);
  console.log('');
  console.log('Dikecualikan (dapat diregenerate):');
  console.log('  node_modules/  -> npm install');
  console.log('  .next/         -> npm run build');
  console.log('  data/          -> npm run db:seed');
  console.log('  backup/        -> folder ini sendiri');
  console.log('  test-results/  -> npm run test:e2e');
  console.log('');
  console.log('Untuk memulihkan: unzip arsip, lalu jalankan');
  console.log('  npm install && npm run db:seed && npm run dev');
}

main();