import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { startFakeRedis, type FakeRedisServer } from './helpers/fake-redis';

/**
 * Uji Phase 6 — Redis + antrean job.
 *
 * Redis sungguhan tidak tersedia di mesin uji, jadi `tests/helpers/fake-redis.ts`
 * menjalankan server RESP in-process. Dengan begitu klien RESP, rate limiter
 * berbasis sorted set, antrean job, dan penjadwal bisa diuji sungguhan (bukan
 * hanya jalur in-memory).
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const TEST_DB = path.join(DATA_DIR, 'test-phase6.db');
process.env.DATABASE_FILE = TEST_DB;

function resetDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(TEST_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'db', 'schema.sql'), 'utf-8'));
  db.close();
  resetDatabase();
}

const { resetDatabase } = await import('../src/server/db/seed');
const { getDb, closeDb } = await import('../src/server/db/client');
const { RedisConnection, RedisUnavailableError, resetRedis, redisStatus } = await import(
  '../src/server/infra/redis'
);
const { MemorySlidingWindowStore, RedisSlidingWindowStore, FallbackSlidingWindowStore } = await import(
  '../src/server/infra/kv'
);
const queueModule = await import('../src/server/queue/queue');
const { RepeatScheduler, nextDailyOccurrence, getScheduler, resetScheduler } = await import(
  '../src/server/queue/scheduler'
);
const jobs = await import('../src/server/queue/jobs');
const { startWorker } = await import('../src/server/queue/worker');

const {
  registerJob,
  runJobInline,
  executeJob,
  createJob,
  MemoryQueue,
  RedisQueue,
  redisQueueKeys,
  runWorker,
  heartbeatWorker,
  hasLiveWorker,
} = queueModule;

/* ------------------------------------------------------------------ */
/* Klien Redis                                                        */
/* ------------------------------------------------------------------ */

describe('klien Redis (RESP)', () => {
  let server: FakeRedisServer;
  let redis: InstanceType<typeof RedisConnection>;

  beforeAll(async () => {
    server = await startFakeRedis();
    redis = new RedisConnection({ url: server.url, commandTimeoutMs: 3000 });
    await redis.connect();
  });

  afterAll(async () => {
    redis.close();
    await server.close();
  });

  beforeEach(() => server.flush());

  it('PING dan status koneksi', async () => {
    expect(await redis.ping()).toBe(true);
    expect(redis.connected).toBe(true);
  });

  it('SET / GET / DEL / EXISTS', async () => {
    await redis.set('resto:test', 'halo');
    expect(await redis.get('resto:test')).toBe('halo');
    expect(await redis.exists('resto:test')).toBe(true);

    await redis.set('resto:ttl', 'sebentar', 30);
    expect(await redis.get('resto:ttl')).toBe('sebentar');

    expect(await redis.del('resto:test')).toBe(1);
    expect(await redis.get('resto:test')).toBeNull();
    expect(await redis.exists('resto:test')).toBe(false);
  });

  it('sorted set: ZADD, ZCARD, ZRANGEBYSCORE WITHSCORES, ZREMRANGEBYSCORE', async () => {
    await redis.zadd('resto:z', 100, 'a');
    await redis.zadd('resto:z', 200, 'b');
    await redis.zadd('resto:z', 300, 'c');
    expect(await redis.zcard('resto:z')).toBe(3);

    const entries = await redis.zrangebyscoreWithScores('resto:z', 0, 250);
    expect(entries).toEqual([
      { member: 'a', score: 100 },
      { member: 'b', score: 200 },
    ]);

    expect(await redis.zremrangebyscore('resto:z', '-inf', 150)).toBe(1);
    expect(await redis.zcard('resto:z')).toBe(2);
  });

  it('list: LPUSH, RPOP, RPOPLPUSH, LREM, LLEN', async () => {
    await redis.lpush('resto:l', 'satu');
    await redis.lpush('resto:l', 'dua');
    expect(await redis.llen('resto:l')).toBe(2);

    const moved = await redis.rpoplpush('resto:l', 'resto:active');
    expect(moved).toBe('satu');
    expect(await redis.llen('resto:l')).toBe(1);
    expect(await redis.llen('resto:active')).toBe(1);

    expect(await redis.lrem('resto:active', 'satu')).toBe(1);
    expect(await redis.llen('resto:active')).toBe(0);
  });

  it('balasan error Redis (WRONGTYPE) ditolak tanpa mematikan koneksi', async () => {
    const { RedisReplyError } = await import('../src/server/infra/redis');
    await redis.set('resto:string', 'bukan-zset');

    await expect(redis.zcard('resto:string')).rejects.toBeInstanceOf(RedisReplyError);
    // Koneksi harus tetap hidup setelah reply error.
    expect(await redis.ping()).toBe(true);
  });

  it('koneksi ke port yang tidak ada melempar RedisUnavailableError', async () => {
    const dead = new RedisConnection({ url: 'redis://127.0.0.1:1', connectTimeoutMs: 500, commandTimeoutMs: 500 });
    await expect(dead.exec('PING')).rejects.toBeInstanceOf(RedisUnavailableError);
    expect(dead.connected).toBe(false);
    dead.close();
  });

  it('password dari REDIS_URL tidak pernah dibocorkan oleh redisStatus()', () => {
    process.env.REDIS_URL = 'redis://user:rahasia@127.0.0.1:6379/0';
    resetRedis();
    const status = redisStatus();
    expect(status.configured).toBe(true);
    expect(status.url).not.toContain('rahasia');
    expect(status.url).toContain('***');
    resetRedis();
    delete process.env.REDIS_URL;
  });
});

/* ------------------------------------------------------------------ */
/* Rate limiter                                                       */
/* ------------------------------------------------------------------ */

describe('rate limiter sliding window', () => {
  const options = { limit: 3, windowMs: 60_000 };

  it('store in-memory: menolak setelah kuota habis', async () => {
    const store = new MemorySlidingWindowStore();
    const t0 = 1_000_000;

    expect((await store.hit('ip-a', options.limit, options.windowMs, t0)).allowed).toBe(true);
    expect((await store.hit('ip-a', options.limit, options.windowMs, t0 + 1)).allowed).toBe(true);
    expect((await store.hit('ip-a', options.limit, options.windowMs, t0 + 2)).allowed).toBe(true);

    const fourth = await store.hit('ip-a', options.limit, options.windowMs, t0 + 3);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('store in-memory: jendela bergeser — permintaan lama dilepas', async () => {
    const store = new MemorySlidingWindowStore();
    const t0 = 1_000_000;
    for (let i = 0; i < options.limit; i += 1) {
      expect((await store.hit('ip-b', options.limit, options.windowMs, t0 + i)).allowed).toBe(true);
    }
    expect((await store.hit('ip-b', options.limit, options.windowMs, t0 + 4)).allowed).toBe(false);

    // Setelah seluruh jendela bergeser, kuota tersedia lagi.
    expect((await store.hit('ip-b', options.limit, options.windowMs, t0 + options.windowMs + 1)).allowed).toBe(true);
  });

  it('store in-memory: reset membersihkan kuota', async () => {
    const store = new MemorySlidingWindowStore();
    const t0 = 1_000_000;
    for (let i = 0; i < options.limit; i += 1) await store.hit('ip-c', options.limit, options.windowMs, t0);
    expect((await store.hit('ip-c', options.limit, options.windowMs, t0 + 1)).allowed).toBe(false);

    await store.reset('ip-c');
    expect((await store.hit('ip-c', options.limit, options.windowMs, t0 + 2)).allowed).toBe(true);
  });

  it('store Redis: perilaku sama dengan in-memory', async () => {
    const server = await startFakeRedis();
    const redis = new RedisConnection({ url: server.url });
    const store = new RedisSlidingWindowStore(redis);
    const t0 = 2_000_000;

    try {
      const results = [] as boolean[];
      for (let i = 0; i < 5; i += 1) {
        results.push((await store.hit('ip-r', options.limit, options.windowMs, t0 + i)).allowed);
      }
      expect(results).toEqual([true, true, true, false, false]);

      // Kunci terpisah tidak saling memengaruhi.
      expect((await store.hit('ip-r2', options.limit, options.windowMs, t0)).allowed).toBe(true);

      // Jendela bergeser: 2 request pertama sudah keluar dari jendela, sehingga
      // tersisa 1 hit aktif dan kuota tersisa 1.
      const shifted = await store.hit('ip-r', options.limit, options.windowMs, t0 + options.windowMs + 1);
      expect(shifted.allowed).toBe(true);
      expect(shifted.remaining).toBe(1);

      await store.reset('ip-r');
      expect((await store.hit('ip-r', options.limit, options.windowMs, t0 + options.windowMs + 2)).remaining).toBe(2);
    } finally {
      redis.close();
      await server.close();
    }
  });

  it('store Redis: key diberi TTL sehingga hilang sendiri', async () => {
    const server = await startFakeRedis();
    const redis = new RedisConnection({ url: server.url });
    const store = new RedisSlidingWindowStore(redis);

    try {
      await store.hit('ip-ttl', 5, 1000, 5_000_000);
      expect(server.commands).toContain('EXPIRE');
      expect(await redis.exists('resto:rl:ip-ttl')).toBe(true);
    } finally {
      redis.close();
      await server.close();
    }
  });

  it('fallback: Redis mati tidak menjatuhkan permintaan', async () => {
    const dead = new RedisConnection({ url: 'redis://127.0.0.1:1', connectTimeoutMs: 300, commandTimeoutMs: 300 });
    const store = new FallbackSlidingWindowStore();
    // Disarmasi: paksa store memakai primary yang mati.
    (store as unknown as { primary: unknown }).primary = new RedisSlidingWindowStore(dead);

    const first = await store.hit('ip-down', 2, 60_000);
    expect(first.allowed).toBe(true);
    expect((await store.hit('ip-down', 2, 60_000)).allowed).toBe(true);
    expect((await store.hit('ip-down', 2, 60_000)).allowed).toBe(false);

    await store.reset('ip-down');
    expect((await store.hit('ip-down', 2, 60_000)).allowed).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Antrean job                                                        */
/* ------------------------------------------------------------------ */

describe('antrean job', () => {
  beforeEach(() => {
    resetDb();
  });

  it('job inline menjalankan handler dan mengembalikan hasilnya', async () => {
    registerJob('test-double', (job) => ({ echo: job.data.value as number }));
    const result = await runJobInline<{ value: number }>('test-double', { value: 21 });

    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ echo: 21 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('job tanpa handler ditandai gagal, bukan melempar error', async () => {
    const result = await runJobInline('test-tidak-ada', {});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('tidak ada handler');
  });

  it('percobaan ulang mengikuti maxAttempts', async () => {
    let attempts = 0;
    registerJob('test-flaky', () => {
      attempts += 1;
      if (attempts < 3) throw new Error('gagal sementara');
      return 'sukses';
    });

    const result = await runJobInline('test-flaky', {}, 3);
    expect(attempts).toBe(3);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('sukses');
  });

  it('gagal setelah|maxAttempts| percobaan', async () => {
    let attempts = 0;
    registerJob('test-selalu-gagal', () => {
      attempts += 1;
      throw new Error('selalu gagal');
    });

    const result = await runJobInline('test-selalu-gagal', {}, 2);
    expect(attempts).toBe(2);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('selalu gagal');
  });

  it('antrean in-memory menjalankan job dan mencatat statistik', async () => {
    const queue = new MemoryQueue();
    await queue.close();

    // State antrean in-memory adalah singleton per proses, jadi dibandingkan
    // selisihnya — bukan angka absolut — agar tidak bergantung test lain.
    const before = await queue.stats();

    registerJob('test-queue', () => 'ok');
    await queue.enqueue('test-queue', {});
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stats = await queue.stats();
    expect(stats.backend).toBe('memory');
    expect(stats.pending).toBe(0);
    expect(stats.completed - before.completed).toBe(1);
    expect(stats.failed).toBe(before.failed);
    expect(stats.deadLetter).toBe(before.deadLetter);
  });

  it('worker Redis memproses job dari antrean dan meng-acknowledge-nya', async () => {
    const server = await startFakeRedis();
    const redis = new RedisConnection({ url: server.url });
    const keys = redisQueueKeys(`test-${Date.now()}`);
    const queue = new RedisQueue(redis, keys);

    try {
      const seen: string[] = [];
      registerJob('test-worker', (job) => {
        seen.push(job.id);
      });

      const stop = await runWorker(queue, { blockSeconds: 1 });
      const job = await queue.enqueue('test-worker', { hello: 'dunia' });

      const deadline = Date.now() + 8000;
      let stats = await queue.stats();
      while (stats.completed === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        stats = await queue.stats();
      }
      await stop();

      expect(seen).toEqual([job.id]);
      expect(stats.completed).toBe(1);
      // Reliable queue: tidak ada job yang tertinggal di list `active`.
      expect(stats.active).toBe(0);
      expect(stats.pending).toBe(0);
    } finally {
      redis.close();
      await server.close();
    }
  });

  it('worker Redis menandai job yang handler-nya gagal sebagai failed', async () => {
    const server = await startFakeRedis();
    const redis = new RedisConnection({ url: server.url });
    const queue = new RedisQueue(redis, redisQueueKeys(`test-fail-${Date.now()}`));

    try {
      registerJob('test-worker-gagal', () => {
        throw new Error('handler pecah');
      });

      const stop = await runWorker(queue, { blockSeconds: 1 });
      await queue.enqueue('test-worker-gagal', {}, { maxAttempts: 2 });

      const deadline = Date.now() + 8000;
      let stats = await queue.stats();
      while (stats.failed === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        stats = await queue.stats();
      }
      await stop();

      expect(stats.failed).toBe(1);
      expect(stats.active).toBe(0);

      // Job yang gagal permanen harus tersimpan di dead-letter, bukan hilang.
      expect(stats.deadLetter).toBe(1);
      const dead = await queue.listDeadLetter();
      expect(dead).toHaveLength(1);
      expect(dead[0].job.name).toBe('test-worker-gagal');
      expect(dead[0].attempts).toBe(2);
      expect(dead[0].error).toContain('handler pecah');
    } finally {
      redis.close();
      await server.close();
    }
  });

  it('dead-letter bisa diantrekan ulang dan dibuang', async () => {
    const server = await startFakeRedis();
    const redis = new RedisConnection({ url: server.url });
    const queue = new RedisQueue(redis, redisQueueKeys(`test-dlq-${Date.now()}`));

    try {
      await queue.enqueue('test-dlq', { tag: 'a' }, { maxAttempts: 1 });
      await queue.redis.lpush(queue.keys.deadLetter, JSON.stringify({
        job: { id: 'job-x', name: 'test-dlq', data: { tag: 'x' }, maxAttempts: 1, enqueuedAt: '2026-01-01T00:00:00.000Z' },
        error: 'kegagalan buatan',
        attempts: 1,
        failedAt: '2026-01-01T00:00:05.000Z',
      }));

      expect(await queue.stats()).toMatchObject({ deadLetter: 1 });

      const requeued = await queue.retryDeadLetter();
      expect(requeued).toBe(1);
      expect((await queue.stats()).deadLetter).toBe(0);
      // Job kembali ke antrean aktif untuk diproses worker.
      expect((await queue.stats()).pending).toBe(2);

      await queue.redis.del(queue.keys.pending);
      await queue.enqueue('test-dlq', {}, { maxAttempts: 1 });
      await queue.redis.lpush(queue.keys.deadLetter, JSON.stringify({
        job: { id: 'job-y', name: 'test-dlq', data: {}, maxAttempts: 1, enqueuedAt: '2026-01-01T00:00:00.000Z' },
        error: 'buang',
        attempts: 1,
        failedAt: '2026-01-01T00:00:05.000Z',
      }));

      expect(await queue.purgeDeadLetter()).toBe(1);
      expect((await queue.stats()).deadLetter).toBe(0);
    } finally {
      redis.close();
      await server.close();
    }
  });

  it('riwayat pekerjaan tersimpan untuk panel monitoring', async () => {
    const server = await startFakeRedis();
    const redis = new RedisConnection({ url: server.url });
    const queue = new RedisQueue(redis, redisQueueKeys(`test-history-${Date.now()}`));

    try {
      const stop = await runWorker(queue, { blockSeconds: 1 });
      await queue.enqueue('test-worker', { a: 1 });

      const deadline = Date.now() + 8000;
      let history = await queue.history();
      while (history.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        history = await queue.history();
      }
      await stop();

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ name: 'test-worker', status: 'completed' });
      expect(typeof history[0].at).toBe('string');
    } finally {
      redis.close();
      await server.close();
    }
  });

  it('retry memakai backoff — jeda naik untuk tiap percobaan', async () => {
    const gaps: number[] = [];
    let previous = Date.now();
    let attempts = 0;

    registerJob('test-backoff', () => {
      const now = Date.now();
      gaps.push(now - previous);
      previous = now;
      attempts += 1;
      throw new Error('gagal');
    });

    const result = await executeJob(createJob('test-backoff', {}, 3), undefined, {
      retryBaseDelayMs: 80,
    });

    expect(result.status).toBe('failed');
    expect(attempts).toBe(3);
    // Percobaan pertama tidak menunggu; berikutnya naik: 80ms lalu 160ms.
    expect(gaps[0]).toBeLessThan(60);
    expect(gaps[1]).toBeGreaterThanOrEqual(70);
    expect(gaps[2]).toBeGreaterThan(gaps[1]! - 60);
    expect(result.attempts).toBe(3);
  });

  it('heartbeat worker terdeteksi lewat Redis', async () => {
    const server = await startFakeRedis();
    const redis = new RedisConnection({ url: server.url });

    try {
      expect(await hasLiveWorker(redis)).toBe(false);
      await heartbeatWorker(redis, 'worker-test', 30);
      expect(await hasLiveWorker(redis)).toBe(true);
    } finally {
      redis.close();
      await server.close();
    }
  });

  it('startWorker berjalan dalam mode in-memory bila Redis tidak dikonfigurasi', async () => {
    delete process.env.REDIS_URL;
    resetRedis();

    const logs: string[] = [];
    const handle = await startWorker({ onLog: (message) => logs.push(message) });

    expect(handle.running).toBe(false);
    expect(logs.join(' ')).toContain('in-memory');
    await handle.stop();
  });
});

/* ------------------------------------------------------------------ */
/* Penjadwal                                                          */
/* ------------------------------------------------------------------ */

describe('penjadwal job berulang', () => {
  it('occurrence harian berikutnya dihitung dalam zona WIB', () => {
    // 2026-10-15 20:00 WIB = 13:00 UTC
    const now = Date.parse('2026-10-15T13:00:00.000Z');
    const next = nextDailyOccurrence(now, 23);

    // Occurrence pertama = 2026-10-15 23:00 WIB = 16:00 UTC
    expect(new Date(next).toISOString()).toBe('2026-10-15T16:00:00.000Z');

    // Setelah jam 23 WIB, lompat ke hari berikutnya (WIB, bukan UTC).
    const afterMidnight = Date.parse('2026-10-15T17:00:00.000Z'); // 2026-10-16 00:00 WIB
    expect(new Date(nextDailyOccurrence(afterMidnight, 23)).toISOString()).toBe('2026-10-16T16:00:00.000Z');
  });

  it('schedule harian tidak memicu sebelum waktunya', async () => {
    const scheduler = new RepeatScheduler();
    scheduler.register({ name: 'daily', atHour: 23, payload: {} });

    expect(await scheduler.tick(Date.parse('2026-10-15T10:00:00.000Z'))).toEqual([]);
  });

  it('schedule harian memicu sekali lalu menggeser ke hari berikutnya', async () => {
    const scheduler = new RepeatScheduler();
    scheduler.register({ name: 'daily', atHour: 23, payload: {} });

    // Tick sebelum jadwal: jadwal pertama dicatat (2026-10-15 23:00 WIB).
    expect(await scheduler.tick(Date.parse('2026-10-15T10:00:00.000Z'))).toEqual([]);
    expect(new Date(await scheduler.nextRunAt('daily')).toISOString()).toBe('2026-10-15T16:00:00.000Z');

    // Lewat jadwal 23:00 WIB -> job Released ke antrean, jadwal geser ke besok.
    const due = await scheduler.tick(Date.parse('2026-10-15T16:00:30.000Z'));
    expect(due).toHaveLength(1);
    expect(due[0].schedule.name).toBe('daily');
    expect(new Date(await scheduler.nextRunAt('daily')).toISOString()).toBe('2026-10-16T16:00:00.000Z');

    // Tidak memicu lagi pada hari yang sama.
    expect(await scheduler.tick(Date.parse('2026-10-15T16:01:00.000Z'))).toEqual([]);
  });

  it('schedule berbasis interval bergeser sebesar interval', async () => {
    const scheduler = new RepeatScheduler();
    scheduler.register({ name: 'retry', everyMs: 60_000, payload: {} });

    const t0 = Date.parse('2026-10-15T00:00:00.000Z');
    expect(await scheduler.tick(t0)).toEqual([]);
    expect(await scheduler.tick(t0 + 59_000)).toEqual([]);
    expect(await scheduler.tick(t0 + 60_000)).toHaveLength(1);
    expect(await scheduler.nextRunAt('retry', t0 + 60_000)).toBe(t0 + 120_000);
  });

  it('schedule bawaan: laporan harian 23:00 WIB & retry outbox tiap 5 menit', () => {
    const schedules = jobs.defaultSchedules();
    const daily = schedules.find((s) => s.name === jobs.JOB_DAILY_REPORT);
    const retry = schedules.find((s) => s.name === jobs.JOB_NOTIFICATION_RETRY);

    expect(daily?.atHour).toBe(23);
    expect(retry?.everyMs).toBe(5 * 60 * 1000);
  });
});

/* ------------------------------------------------------------------ */
/* Integrasi job dengan domain                                        */
/* ------------------------------------------------------------------ */

describe('job domain lewat antrean', () => {
  beforeEach(() => {
    resetDb();
    jobs.bootstrapQueue();
  });

  it('job laporan harian membuat laporan dan idempotent per tanggal', async () => {
    const date = '2026-03-05';

    const first = await jobs.runDailyReportJob(date, { inline: true });
    expect(first.created).toBe(true);
    expect((first.report as { date: string }).date).toBe(date);

    const second = await jobs.runDailyReportJob(date, { inline: true });
    expect(second.created).toBe(false);

    const reports = getDb()
      .prepare("SELECT COUNT(*) AS c FROM financial_reports WHERE report_type = 'daily-summary' AND period = ?")
      .get(date) as { c: number };
    expect(reports.c).toBe(1);
  });

  it('job laporan harian mengirim notifikasi ke manager', async () => {
    const date = '2026-03-06';
    await jobs.runDailyReportJob(date, { inline: true });

    const notes = getDb()
      .prepare("SELECT COUNT(*) AS c FROM notifications WHERE template = 'daily_report' AND body LIKE ?")
      .get(`%${date}%`) as { c: number };
    expect(notes.c).toBeGreaterThan(0);
  });

  it('job retry notifikasi mengirim ulang baris yang menggantung di status queued', async () => {
    getDb()
      .prepare(
        `INSERT INTO notifications (id, channel, recipient, template, subject, body, status, created_at)
         VALUES ('ntf-gantung', 'email', 'dulu@example.test', 'order_received', 'x', 'y', 'queued', ?)`
      )
      .run(new Date().toISOString());

    const result = await jobs.runNotificationRetryJob(50);
    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ retried: 1, sent: 1, failed: 0 });

    const row = getDb().prepare('SELECT status FROM notifications WHERE id = ?').get('ntf-gantung') as {
      status: string;
    };
    expect(row.status).toBe('sent');
  });

  it('job retry notifikasi menandai gagal bila penerima kosong', async () => {
    getDb()
      .prepare(
        `INSERT INTO notifications (id, channel, recipient, template, subject, body, status, created_at)
         VALUES ('ntf-tanpa-tujuan', 'sms', '   ', 'order_received', 'x', 'y', 'queued', ?)`
      )
      .run(new Date().toISOString());

    const result = await jobs.runNotificationRetryJob(50);
    expect(result.output).toEqual({ retried: 1, sent: 0, failed: 1 });
  });

  it('jurnal tetap seimbang setelah job laporan harian dijalankan', async () => {
    await jobs.runDailyReportJob('2026-03-07', { inline: true });

    const totals = getDb()
      .prepare('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM ledger_entries')
      .get() as { d: number; c: number };
    expect(Math.abs(totals.d - totals.c)).toBeLessThan(1);
  });
});

/* ------------------------------------------------------------------ */
/* Integrasi penuh: worker Redis menjalankan schedule jatuh tempo      */
/* ------------------------------------------------------------------ */

describe('worker Redis menjalankan schedule terjadwal', () => {
  const date = '2026-03-09';

  afterAll(async () => {
    delete process.env.REDIS_URL;
    resetRedis();
    resetScheduler();
    closeDb();
  });

  it('schedule jatuh tempo diantrekan, worker mengeksekusi, laporan terbentuk', async () => {
    resetDb();

    const server = await startFakeRedis();
    process.env.REDIS_URL = server.url;
    resetRedis();
    resetScheduler();

    jobs.bootstrapQueue();

    const handle = await startWorker({ tickIntervalMs: 100, heartbeatSeconds: 30 });
    expect(handle.running).toBe(true);

    // startWorker memasang schedule bawaan; timpa dengan tanggal spesifik agar
    // hasil job mudah diamati.
    getScheduler().register({ name: jobs.JOB_DAILY_REPORT, atHour: 23, payload: { date } });

    // Paksa jadwal jatuh tempo: inilah yang dilakukan worker setiap tick.
    const redis = new RedisConnection({ url: server.url });
    await redis.set(`resto:schedule:${jobs.JOB_DAILY_REPORT}`, String(Date.now() - 60_000));

    const deadline = Date.now() + 10_000;
    let created = 0;
    while (Date.now() < deadline) {
      created = (
        getDb()
          .prepare("SELECT COUNT(*) AS c FROM financial_reports WHERE report_type = 'daily-summary' AND period = ?")
          .get(date) as { c: number }
      ).c;
      if (created > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await handle.stop();

    try {
      // Job benar-benar dieksekusi worker, bukan inline oleh proses pemanggil.
      expect(created).toBe(1);

      const note = getDb()
        .prepare("SELECT COUNT(*) AS c FROM notifications WHERE template = 'daily_report' AND body LIKE ?")
        .get(`%${date}%`) as { c: number };
      expect(note.c).toBeGreaterThan(0);

      // Antrean kosong kembali: job tidak mengendap di list `active`.
      const queue = new RedisQueue(redis);
      const stats = await queue.stats();
      expect(stats.pending).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.completed).toBeGreaterThanOrEqual(1);
    } finally {
      redis.close();
      await server.close();
    }
  }, 30_000);
});
