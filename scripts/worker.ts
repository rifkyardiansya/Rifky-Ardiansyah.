/**
 * CLI worker — proses terpisah dari server web.
 *
 * Menjalankan antrean job & penjadwalan laporan harian tanpa bergantung pada
 * cron eksternal (GitHub Actions / Vercel Cron).
 *
 *   npm run worker
 *   REDIS_URL=redis://localhost:6379 npm run worker
 *
 * Tanpa `REDIS_URL`, worker keluar dengan pesan informsif karena pekerjaan
 * sudah dieksekusi inline oleh proses web.
 */

import { closeDb, ensureSeeded } from '../src/server/db/client';
import { startWorker } from '../src/server/queue/worker';

async function main() {
  await ensureSeeded();

  const handle = await startWorker();
  if (!handle.running) return;

  const shutdown = async (signal: string) => {
    console.log(`\n[worker] menerima ${signal}, mematikan…`);
    await handle.stop();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[worker] gagal start:', error);
  process.exit(1);
});
