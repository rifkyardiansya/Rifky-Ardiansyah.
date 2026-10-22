/**
 * Redis palsu untuk pengembangan — menjalankan server RESP in-process.
 *
 * Berguna untuk mencoba jalur Redis (rate limiter terpusat + antrean job +
 * worker terjadwal) di laptop yang tidak punya Redis/Docker terpasang.
 *
 *   Terminal 1:  npm run redis:fake
 *   Terminal 2:  REDIS_URL=redis://127.0.0.1:6399 npm run dev
 *   Terminal 3:  REDIS_URL=redis://127.0.0.1:6399 npm run worker
 *
 * Peringatan: ini bukan Redis sungguhan — data disimpan di memori proses ini
 * dan hilang saat dihentikan. Jangan dipakai di produksi.
 */

import { startFakeRedis } from '../tests/helpers/fake-redis';

const PORT = Number(process.env.FAKE_REDIS_PORT ?? 6399);

async function main() {
  const server = await startFakeRedis(PORT);

  console.log(`[fake-redis] server RESP berjalan di ${server.url}`);
  console.log('[fake-redis] data hanya di memori — hilang saat proses dihentikan.');
  console.log('[fake-redis] tekan Ctrl+C untuk berhenti.');

  const shutdown = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[fake-redis] gagal start:', error);
  process.exit(1);
});
