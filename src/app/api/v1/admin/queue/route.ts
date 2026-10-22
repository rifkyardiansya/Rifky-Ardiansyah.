import { handler, ok, requireUser } from '@/server/http/api';
import { getQueue, hasLiveWorker, registeredJobs } from '@/server/queue/queue';
import { getScheduler } from '@/server/queue/scheduler';
import { defaultSchedules } from '@/server/queue/jobs';
import { redisStatus, getRedis } from '@/server/infra/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Monitoring antrean job & infrastruktur (Phase 7).
 *
 * Menampilkan apa yang biasanya tak terlihat di demo: apakah Redis terhubung,
 * berapa job yang tertunda, job mana yang gagal permanen (dead-letter), dan
 * apakah jadwal harian benar-benar terdaftar.
 *
 * Hanya admin — isinya membocorkan struktur internal & pesan error job.
 */
export const GET = handler(async (req: Request) => {
  await requireUser('admin');

  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Number(searchParams.get('limit') ?? 20));
  const queue = getQueue();

  const stats = await queue.stats();
  const [deadLetter, history] = await Promise.all([
    queue.listDeadLetter(limit),
    queue.history(limit),
  ]);

  const scheduler = getScheduler();
  const registered = scheduler.registered();
  const builtIn = new Set(defaultSchedules().map((s) => s.name));

  // Jadwal yang akan datang: "kapan dijalankan berikutnya".
  const schedules = await Promise.all(
    registered.map(async (schedule) => ({
      name: schedule.name,
      kind: schedule.atHour !== undefined ? `harian ${String(schedule.atHour).padStart(2, '0')}:00 WIB` : `tiap ${Math.round((schedule.everyMs ?? 0) / 1000)} detik`,
      builtIn: builtIn.has(schedule.name),
      nextRunAt: new Date(await scheduler.nextRunAt(schedule.name)).toISOString(),
    }))
  );

  const redis = getRedis();

  return ok({
    backend: queue.backend,
    redis: redisStatus(),
    // Tanpa worker hidup, jadwal di bawah hanya "terdaftar" — tidak ada yang
    // mengeksekusinya. Panel perlu tahu ini agar tidak menyesatkan.
    workerAlive: redis ? await hasLiveWorker(redis) : false,
    stats,
    deadLetter,
    history,
    jobs: registeredJobs(),
    schedules,
  });
});

/** POST — antrekan ulang job yang tersangkut di dead-letter. */
export const POST = handler(async (req: Request) => {
  await requireUser('admin');

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(50, Number((body as { limit?: number }).limit ?? 20));
  const queue = getQueue();

  const requeued = await queue.retryDeadLetter(limit);
  return ok({ requeued });
});

/** DELETE — buang job yang tidak mungkin lagi berhasil. */
export const DELETE = handler(async () => {
  await requireUser('admin');

  const purged = await getQueue().purgeDeadLetter();
  return ok({ purged });
});
