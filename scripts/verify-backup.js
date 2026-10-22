/**
 * Memverifikasi integritas arsip backup.
 *   node scripts/verify-backup.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BACKUP_DIR = path.join(process.cwd(), 'backup');

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

function listZip(file) {
  const buf = fs.readFileSync(file);

  // Temukan End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD tidak ditemukan — file bukan ZIP valid');

  const total = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const files = [];

  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Central directory rusak');
    const method = buf.readUInt16LE(ptr + 10);
    const crc = buf.readUInt32LE(ptr + 16);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString('utf-8');

    // Verifikasi isi: baca local header lalu inflate
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;

    const okSize = data.length === uncompressedSize;
    const okCrc = crc32(data) === crc;

    files.push({ name, size: uncompressedSize, okSize, okCrc });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return { files, total: buf.length };
}

function main() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log('Folder backup/ belum ada. Jalankan `npm run backup` terlebih dahulu.');
    process.exit(1);
  }

  const zips = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.zip'));
  if (zips.length === 0) {
    console.log('Belum ada arsip ZIP di folder backup/.');
    process.exit(1);
  }

  zips.forEach((name) => {
    const file = path.join(BACKUP_DIR, name);
    const { files, total } = listZip(file);
    const broken = files.filter((f) => !f.okSize || !f.okCrc);

    console.log('');
    console.log(`Arsip : ${name}`);
    console.log(`Ukuran ZIP   : ${(total / 1024).toFixed(1)} KB`);
    console.log(`Jumlah file  : ${files.length}`);
    console.log(`Total ukuran : ${(files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)} KB (setelah dekompresi)`);
    console.log(`CRC & ukuran : ${broken.length === 0 ? 'SEMUA VALID ✓' : `${broken.length} BERKAS RUSAK ✗`}`);
    console.log('');
    console.log('Daftar berkas:');
    files
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((f) => console.log(`  ${f.okCrc && f.okSize ? '✓' : '✗'} ${f.name}  (${(f.size / 1024).toFixed(1)} KB)`));

    const required = [
      'package.json',
      'README.md',
      'docs/PROGRESS.md',
      'src/app/page.tsx',
      'src/lib/store.tsx',
      'src/server/db/schema.sql',
      'src/server/services/order.service.ts',
      'src/server/services/payment.service.ts',
      'src/app/api/v1/events/route.ts',
      'src/app/api/v1/cron/daily-report/route.ts',
      'src/server/services/schedule.service.ts',
      'scripts/smoke-phase5.ts',
      'playwright.config.ts',
      '.eslintrc.json',
      'Dockerfile',
      'docker-compose.yml',
      'tests/domain.test.ts',
      'tests/phase2.test.ts',
      'tests/e2e/auth.spec.ts',
      'tests/e2e/pos-booking.spec.ts',
      'tests/e2e/inventory-reports.spec.ts',
      'tests/e2e/customer.spec.ts',
    ];
    const names = new Set(files.map((f) => f.name));
    const missing = required.filter((r) => !names.has(r));
    console.log('');
    console.log(
      missing.length === 0
        ? `Berkas wajib: SEMUA ADA (${required.length}/${required.length}) ✓`
        : `Berkas wajib HILANG: ${missing.join(', ')} ✗`
    );
    console.log('');

    process.exitCode = broken.length === 0 && missing.length === 0 ? 0 : 1;
  });
}

main();