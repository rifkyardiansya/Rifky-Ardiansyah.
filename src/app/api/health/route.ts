import crypto from 'node:crypto';
import { dbFilePath, ensureSeeded, getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';
import { listenerCount } from '@/server/realtime/bus';
import { redisStatus } from '@/server/infra/redis';
import { getQueue } from '@/server/queue/queue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BOOTED_AT = Date.now();

/**
 * GET /api/health — health-check untuk Docker, load balancer, dan uptime monitor.
 *
 * Liveness  -> proses merespons (status selalu 200 selama route hidup)
 * Readiness -> database dapat diakses, ter-seed, dan jurnal seimbang
 *
 * Redis & antrean bersifat opsional (Phase 6): bila tidak dikonfigurasi,
 * pemeriksaan dilewati dan sistem tetap `healthy` — hanya lewat mode in-memory.
 */
export const GET = handler(async () => {
  const checks: Record<string, { ok: boolean; detail?: string; ms?: number }> = {};

  // Pastikan database siap (lazy seed) sebelum diperiksa
  await ensureSeeded();

  // 1. Database
  const dbStart = Date.now();
  try {
    const row = getDb()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM menu_items)          AS menuItems,
           (SELECT COUNT(*) FROM restaurant_tables)  AS tables,
           (SELECT COUNT(*) FROM accounts)            AS accounts,
           (SELECT COUNT(*) FROM ledger_entries)      AS ledgerEntries,
           (SELECT COALESCE(SUM(debit),0) FROM ledger_entries)  AS totalDebit,
           (SELECT COALESCE(SUM(credit),0) FROM ledger_entries) AS totalCredit`
      )
      .get() as Record<string, number>;

    checks.database = {
      ok: true,
      ms: Date.now() - dbStart,
      detail: `${row.menuItems} menu, ${row.tables} meja, ${row.ledgerEntries} baris jurnal`,
    };

    // Jurnal harus seimbang — bila tidak, sistem dalam kondisi tidak sehat
    const balanced = Math.abs(row.totalDebit - row.totalCredit) < 1;
    checks.ledgerBalance = {
      ok: balanced,
      detail: balanced
        ? `seimbang (${row.totalDebit.toLocaleString('id-ID')})`
        : `TIDAK SEIMBANG: Dr ${row.totalDebit} vs Cr ${row.totalCredit}`,
    };
  } catch (error) {
    checks.database = { ok: false, detail: error instanceof Error ? error.message : 'tidak diketahui' };
  }

  // 2. Realtime (SSE bus)
  checks.realtime = { ok: true, detail: `${listenerCount()} subscriber aktif` };

  // 3. Infrastruktur opsional (Phase 6): Redis + antrean job.
  const redis = redisStatus();
  checks.queue = { ok: true, detail: 'antrean in-memory (Redis tidak dikonfigurasi)' };

  if (redis.configured) {
    const queueStart = Date.now();
    try {
      const stats = await getQueue().stats();
      // Status koneksi dibaca ulang SETELAH perintah pertama: `getQueue()` yang
      // memulai koneksi, jadi `redisStatus()` yang di atas masih "belum terhubung".
      const live = redisStatus();
      // Redis tidak bisa dihubungi tidak menjatuhkan aplikasi: rate limiter dan
      // antrean otomatis jatuh ke mode in-memory. Jadi status tetap `ok`, dan
      // koneksinya dilaporkan lewat `detail` ( alerting lewat monitoring).
      checks.redis = {
        ok: true,
        ms: Date.now() - queueStart,
        detail: live.connected
          ? 'terhubung'
          : 'belum terhubung — memakai mode in-memory sampai Redis tersedia',
      };
      checks.queue = {
        ok: true,
        detail: `backend ${stats.backend} · tertunda ${stats.pending} · aktif ${stats.active} · selesai ${stats.completed} · gagal ${stats.failed}`,
      };
    } catch (error) {
      checks.redis = {
        ok: true,
        detail: `tidak dapat diakses (${error instanceof Error ? error.message : 'tidak diketahui'}) — memakai mode in-memory`,
      };
    }
  }

  const healthy = Object.values(checks).every((c) => c.ok);

  return ok(
    {
      status: healthy ? 'healthy' : 'degraded',
      version: process.env.APP_VERSION ?? '1.0.0',
      commit: process.env.GIT_COMMIT ?? null,
      environment: process.env.NODE_ENV ?? 'development',
      runtime: process.env.NEXT_RUNTIME ?? 'nodejs',
      uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
      processUptime: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      databaseFile: dbFilePath,
      requestId: crypto.randomUUID().slice(0, 8),
      checks,
    },
    { status: healthy ? 200 : 503 }
  );
});