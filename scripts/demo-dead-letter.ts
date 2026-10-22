/**
 * Skrip demo — membuat satu job yang selalu gagal, untuk melihat dead-letter
 * queue bekerja pada panel admin.
 *
 *   REDIS_URL=redis://127.0.0.1:6399 npx tsx scripts/demo-dead-letter.ts
 */

import { registerJob, getQueue } from '../src/server/queue/queue';
import { resetRedis } from '../src/server/infra/redis';

async function main() {
  registerJob('demo-job-gagal', () => {
    throw new Error('kegagalan buatan untuk demo');
  });

  const job = await getQueue().enqueue('demo-job-gagal', { demo: true }, { maxAttempts: 1 });
  console.log('[demo] job diantrekan:', job.id);

  // Tutup koneksi Redis supaya proses ini selesai (worker yang memproses job).
  resetRedis();
}

main().catch((error) => {
  console.error('[demo] gagal:', error);
  process.exit(1);
});
