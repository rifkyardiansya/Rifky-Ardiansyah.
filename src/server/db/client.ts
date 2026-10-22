import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Infrastruktur: koneksi SQLite singleton.
 *
 * Pada prototype coursework, SQLite (file lokal) menggantikan PostgreSQL agar
 * demo dapat dijalankan tanpa Docker. Seluruh repository tetap memakai SQL
 * portabel, sehingga migrasi ke PostgreSQL cukup mengganti driver + DDL.
 */

const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = process.env.DATABASE_FILE ?? path.join(DB_DIR, 'restoran.db');

declare global {
  // eslint-disable-next-line no-var
  var __restoDb: Database.Database | undefined;
  // eslint-disable-next-line no-var
  var __restoDbInit: boolean | undefined;
}

/**
 * Migrasi bertahap: statement ALTER TABLE tidak bisa dipakai di schema.sql
 * karena tidak idempotent. Setiap kolom dicek dulu lewat PRAGMA table_info.
 */
function runMigrations(db: Database.Database) {
  const columns = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  const ensureColumn = (table: string, column: string, ddl: string) => {
    if (columns(table).includes(column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };

  // payments: perlu info channel, waktu expiry, dan waktu pembayaran sukses
  ensureColumn('payments', 'channel', 'channel TEXT');
  ensureColumn('payments', 'expires_at', 'expires_at TEXT');
  ensureColumn('payments', 'paid_at', 'paid_at TEXT');

  // pos_sessions: catatan shift & serang antrean
  ensureColumn('pos_sessions', 'note', 'note TEXT');

  const already = db
    .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE version = '002-payment-notification'")
    .get() as { c: number };
  if (already.c === 0) {
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      '002-payment-notification',
      nowISO()
    );
  }
}

function createConnection(): Database.Database {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Tunggu lebih lama bila ada proses lain (mis. dev server) yang sedang menulis
  db.pragma('busy_timeout = 5000');
  db.exec(fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'db', 'schema.sql'), 'utf-8'));
  runMigrations(db);
  return db;
}

/**
 * Koneksi harus di-cache pada `globalThis` agar HANYA SATU koneksi per proses.
 * Jika setiap pemanggilan membuat koneksi baru, transaksi yang sudah memegang
 * write-lock akan bentrok dengan koneksi lain ("database is locked").
 */
export function getDb(): Database.Database {
  if (!global.__restoDb) {
    global.__restoDb = createConnection();
    // Persiapan sekali jalan: mengisi database kosong dengan data demo.
    // Dipanggil secara lazy (bukan saat boot) agar modul native better-sqlite3
    // hanya dimuat di runtime Node yang memang membutuhkannya.
    void ensureSeeded(global.__restoDb);
  }
  return global.__restoDb;
}

let seeding: Promise<void> | null = null;

/**
 * Menjalankan DDL + seeding bila database masih kosong.
 *
 * Dijalankan secara lazy pada koneksi pertama supaya container baru siap
 * menerima traffic tanpa perlu `npm run db:seed` manual. Using {@link seeding}
 * sebagai guard mencegah rekursi (seed() sendiri memanggil getDb()).
 */
export async function ensureSeeded(db?: Database.Database) {
  if (seeding) return seeding;

  seeding = (async () => {
    try {
      const conn = db ?? getDb();
      const users = conn.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
      if (users.c === 0) {
        const { runSeed } = await import('./seed');
        runSeed();
        console.log('[db] database kosong — data demo berhasil dibuat otomatis');
      }
    } catch (error) {
      console.error('[db] gagal menyiapkan database:', error);
    }
  })();

  return seeding;
}

/** Menutup koneksi (dipakai oleh skrip CLI & teardown test). */
export function closeDb() {
  if (global.__restoDb) {
    global.__restoDb.close();
    global.__restoDb = undefined;
  }
}

export const dbFilePath = DB_FILE;

/** Membungkus sekumpulan operasi dalam satu transaksi atomik. */
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDb();
  return db.transaction(fn)(db);
}

export function nowISO() {
  return new Date().toISOString();
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}