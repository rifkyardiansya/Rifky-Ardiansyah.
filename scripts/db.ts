/**
 * Skrip CLI untuk database prototype.
 *
 *   npm run db:seed    -> isi data awal (menu, meja, bahan baku, jurnal pembuka)
 *   npm run db:reset   -> kosongkan & buat ulang data awal
 *   npm run db:status  -> ringkasan isi database
 *
 * Dijalankan dengan tsx agar bisa mengimpor langsung modul server-side.
 */

import fs from 'node:fs';
import { closeDb, getDb, dbFilePath } from '../src/server/db/client';
import { resetDatabase, runSeed } from '../src/server/db/seed';

const command = process.argv[2] ?? 'status';

/**
 * Mengosongkan database yang sedang aktif lalu mengisi ulang data awal.
 *
 * Hanya file yang ditunjuk `DATABASE_FILE` yang dihapus — bukan seluruh folder
 * `data/`. Database lain di sana (mis. `e2e-restoran.db`, `test-phase6.db`)
 * adalah milik jalur pengujian lain dan tidak boleh ikut hilang.
 */
function reset() {
  try {
    // SQLite menyimpan state tambahan pada file -wal dan -shm.
    for (const file of [dbFilePath, `${dbFilePath}-wal`, `${dbFilePath}-shm`]) {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true, maxRetries: 3, retryDelay: 300 });
    }
    console.log(`Database lama dihapus (${dbFilePath}). Jalankan \`npm run db:seed\` untuk membuat ulang.`);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY') throw error;
    console.log('File database sedang terkunci (dev server berjalan) — memakai mode truncate.');
  }

  resetDatabase();
  console.log('Seluruh tabel dikosongkan dan diisi ulang dengan data awal.');
}

if (command === 'reset') {
  reset();
} else if (command === 'seed') {
  const result = runSeed();
  console.log(result.skipped ? 'Database sudah berisi data — seed dilewati.' : 'Seed berhasil: data awal dibuat.');
} else {
  const db = getDb();
  const tables = [
    'users', 'accounts', 'categories', 'menu_items', 'menu_recipes', 'raw_materials', 'stock_items',
    'suppliers', 'restaurant_tables', 'orders', 'order_items', 'bookings', 'pos_sessions',
    'purchase_orders', 'ledger_entries', 'stock_movements', 'audit_logs',
  ];
  console.log(`Lokasi database: ${dbFilePath}\n`);
  console.log('Isi database:');
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number };
      console.log(`  ${t.padEnd(22)} ${String(row.c).padStart(5)} baris`);
    } catch {
      console.log(`  ${t.padEnd(22)}     -`);
    }
  }
  const totals = db
    .prepare('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS k FROM ledger_entries')
    .get() as { d: number; k: number };
  console.log(
    `\nJurnal: debit ${totals.d} | kredit ${totals.k} | ${Math.abs(totals.d - totals.k) < 1 ? 'SEIMBANG' : 'TIDAK SEIMBANG'}`
  );
}

closeDb();
process.exit(0);