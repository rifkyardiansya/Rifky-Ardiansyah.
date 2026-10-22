import { getRedis } from '../infra/redis';
import { getQueue, heartbeatWorker, RedisQueue, runWorker, type Queue, type JobResult } from './queue';
import { getScheduler } from './scheduler';
import { bootstrapQueue } from './jobs';

/**
 * Bootstrap worker (Phase 6).
 *
 * Menjalankan dua loop dalam satu proses:
 *  1. **Job loop** — mengambil job dari antrean Redis dan mengeksekusinya.
 *  2. **Schedule loop** — memeriksa tiap `tickIntervalMs` apakah ada job
 *     berulang yang jatuh tempo, lalu mengantrekannya.
 *
 * plus heartbeat ber-TTL supaya proses web tahu ada worker hidup.
 *
 * Bila Redis tidak dikonfigurasi, worker tidak dijalankan — pekerjaan langsung
 * dieksekusi inline oleh proses web (`runJobInline`), sehingga demo di laptop
 * tetap berfungsi tanpa Redis.
 */

export interface WorkerHandle {
  /** Menghentikan kedua loop. */
  stop(): Promise<void>;
  readonly workerId: string;
  readonly running: boolean;
}

export interface StartWorkerOptions {
  /** Seberapa sering schedule diperiksa. Default 30 detik. */
  tickIntervalMs?: number;
  /** Umur heartbeat. Default 30 detik. */
  heartbeatSeconds?: number;
  onLog?: (message: string) => void;
}

export async function startWorker(options: StartWorkerOptions = {}): Promise<WorkerHandle> {
  const log = options.onLog ?? ((message: string) => console.log(message));
  const tickIntervalMs = options.tickIntervalMs ?? 30_000;
  const heartbeatSeconds = options.heartbeatSeconds ?? 30;
  const workerId = `worker-${process.pid}`;

  bootstrapQueue();

  const redis = getRedis();
  const queue: Queue = getQueue();

  if (!redis || queue.backend !== 'redis') {
    log('[worker] REDIS_URL tidak disetel — mode in-memory aktif, pekerjaan dieksekusi inline oleh proses web.');
    return { workerId, running: false, stop: async () => {} };
  }

  const redisQueue = queue as RedisQueue;
  const state = { stopped: false };

  // Job loop: blocking BRPOPLPUSH dengan timeout pendek supaya stop() responsif.
  const stopJobs = await runWorker(redisQueue, {
    blockSeconds: 2,
    retryDelayMs: 2000,
    onJobResult: (result: JobResult) =>
      log(
        `[worker] job ${result.name} (${result.id}) ${result.status} dalam ${result.durationMs}ms` +
          (result.error ? ` — ${result.error}` : '')
      ),
  });

  // Schedule loop + heartbeat.
  const scheduleTimer = setInterval(() => {
    void (async () => {
      try {
        await heartbeatWorker(redis, workerId, heartbeatSeconds);
        const due = await getScheduler().tick();
        for (const item of due) {
          await redisQueue.enqueue(item.schedule.name, item.schedule.payload ?? {});
          log(`[worker] schedule "${item.schedule.name}" jatuh tempo → diantrekan`);
        }
      } catch (error) {
        log(`[worker] schedule loop bermasalah: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, tickIntervalMs);

  // Jadwalkan langsung agar worker yang baru start tidak menunggu interval penuh.
  await heartbeatWorker(redis, workerId, heartbeatSeconds);

  log(`[worker] aktif (${workerId}) · antrean=${redisQueue.keys.pending} · cek schedule tiap ${tickIntervalMs / 1000}s`);

  return {
    workerId,
    running: true,
    async stop() {
      if (state.stopped) return;
      state.stopped = true;
      clearInterval(scheduleTimer);
      await stopJobs();
      log('[worker] dihentikan');
    },
  };
}
