import crypto from 'node:crypto';
import { getRedis, RedisUnavailableError, type RedisConnection } from '../infra/redis';

/**
 * Antrean job (queue) untuk pekerjaan yang tidak boleh memblokir request HTTP.
 *
 * Seluruh pekerjaan berat — membuat laporan harian, mengirim notifikasi,
 *weep ulang status pesanan — dimasukkan ke sini lalu dieksekusi worker.
 * Antrean ada dalam dua bentuk:
 *
 *  - **Redis** (produksi / multi-instance): list `pending` (LPUSH) dan `active`
 *    (RPOPLPUSH), pola *reliable queue* klasik: job yang sedang diproses selalu
 *    ada di `active`, sehingga masih bisa ditemukan meski worker mati.
 *  - **In-memory** (demo laptop / test): array lokal, worker berjalan di proses
 *    yang sama memakai `setImmediate`.
 *
 * Kontrak `Queue` sama untuk keduanya, jadi service tidak perlu tahu backend
 * apa yang aktif — persis seperti target blueprint (BullMQ di atas Redis).
 */

export interface Job<T = Record<string, unknown>> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  maxAttempts: number;
  enqueuedAt: string;
}

export interface JobResult {
  id: string;
  name: string;
  status: 'completed' | 'failed';
  durationMs: number;
  /** Berapa kali handler benar-benar dipanggil. */
  attempts?: number;
  /** Nilai balik handler — dipakai pemanggil yang memerlukan hasil pekerjaan. */
  output?: unknown;
  error?: string;
}

export interface EnqueueOptions {
  /** Berapa kali job dicoba bila handler melempar error. Default 1. */
  maxAttempts?: number;
  /**
   * Paksa eksekusi di proses ini (dipakai endpoint cron agar respons tetap
   * sinkron, dan dipakai test agar tidak butuh worker terpisah).
   */
  inline?: boolean;
}

export interface QueueStats {
  backend: 'redis' | 'memory';
  pending: number;
  active: number;
  completed: number;
  failed: number;
  /** Job yang gagal setelah semua percobaan dan menunggu dihandled/discard. */
  deadLetter: number;
}

/**
 * Job yang sudah habis percobaan. Disimpan terpisah supaya (a) tidak hilang
 * diam-diam, (b) bisa diperiksa di panel admin, dan (c) bisa diantrekan ulang
 * setelah penyebabnya diperbaiki.
 */
export interface DeadLetterEntry {
  job: { id: string; name: string; data: unknown; maxAttempts: number; enqueuedAt: string };
  error: string;
  attempts: number;
  failedAt: string;
}

/** Riwayat singkat hasil pekerjaan terakhir (untuk panel monitoring). */
export interface HistoryEntry {
  id: string;
  name: string;
  status: 'completed' | 'failed';
  durationMs: number;
  error?: string;
  at: string;
}

export interface Queue {
  readonly backend: 'redis' | 'memory';
  enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<Job<T>>;
  stats(): Promise<QueueStats>;
  /** Job gagal permanen yang menunggu tindakan. */
  listDeadLetter(limit?: number): Promise<DeadLetterEntry[]>;
  /** Menantrekan ulang job dari dead-letter; mengembalikan jumlah yang dipindahkan. */
  retryDeadLetter(limit?: number): Promise<number>;
  /** Menyerahkan job yang sudah tidak mungkin succeeds. */
  purgeDeadLetter(): Promise<number>;
  /** Riwayat hasil pekerjaan terakhir. */
  history(limit?: number): Promise<HistoryEntry[]>;
  close(): Promise<void>;
}

export type JobHandler<T = Record<string, unknown>> = (job: Job<T>) => Promise<unknown> | unknown;

/**
 * Job dengan tipe data bebas — dipakai oleh registry & state internal antrean,
 * karena antrean bisa menampung job apa pun tanpa tahu tipe payload-nya.
 */
type AnyJob = Job<unknown>;

/* ---------------- Registry handler ---------------- */

interface Handler {
  run: (job: AnyJob) => Promise<unknown>;
}

const handlersGlobalKey = '__restoJobHandlers';

declare global {
  // eslint-disable-next-line no-var
  var __restoJobHandlers: Map<string, Handler> | undefined;
}

function handlerRegistry(): Map<string, Handler> {
  if (!global[handlersGlobalKey]) global[handlersGlobalKey] = new Map();
  return global[handlersGlobalKey]!;
}

/** Mendaftarkan handler untuk sebuah nama job (idempotent). */
export function registerJob<T = Record<string, unknown>>(name: string, run: JobHandler<T>) {
  handlerRegistry().set(name, {
    run: (job) => run(job as Job<T>) as Promise<unknown>,
  });
}

export function hasJobHandler(name: string): boolean {
  return handlerRegistry().has(name);
}

export function registeredJobs(): string[] {
  return [...handlerRegistry().keys()].sort();
}

export function createJob<T>(name: string, data: T, maxAttempts = 1): Job<T> {
  return {
    id: `${name}-${crypto.randomUUID().slice(0, 12)}`,
    name,
    data,
    attempts: 0,
    maxAttempts,
    enqueuedAt: new Date().toISOString(),
  };
}

/* ---------------- In-memory ---------------- */

interface MemoryQueueState {
  pending: AnyJob[];
  active: AnyJob[];
  completed: number;
  failed: number;
  deadLetter: DeadLetterEntry[];
  history: HistoryEntry[];
}

/** Batas riwayat yang disimpan di memori (dipangkas setiap kali penuh). */
const HISTORY_LIMIT = 100;

const memoryGlobalKey = '__restoMemoryQueue';

declare global {
  // eslint-disable-next-line no-var
  var __restoMemoryQueue: MemoryQueueState | undefined;
}

function memoryState(): MemoryQueueState {
  if (!global[memoryGlobalKey]) {
    global[memoryGlobalKey] = { pending: [], active: [], completed: 0, failed: 0, deadLetter: [], history: [] };
  }
  return global[memoryGlobalKey]!;
}

/** Mencatat hasil job ke riwayat (dipangkas agar tidak tumbuh tanpa batas). */
export function pushHistory(state: { history: HistoryEntry[] }, entry: HistoryEntry) {
  state.history.unshift(entry);
  if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
}

let draining = false;

/** Menjalankan job satu per satu di proses ini (tanpa blocking event loop). */
export function drainMemoryQueue(): void {
  if (draining) return;
  draining = true;

  setImmediate(async () => {
    const state = memoryState();
    try {
      while (state.pending.length > 0) {
        const job = state.pending.shift()!;
        state.active.push(job);
        await executeJob(job, (result) => settleMemoryJob(state, job, result));
        state.active = state.active.filter((item) => item.id !== job.id);
      }
    } finally {
      draining = false;
    }
  });
}

export class MemoryQueue implements Queue {
  readonly backend = 'memory' as const;

  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<Job<T>> {
    const job = createJob(name, data, options.maxAttempts ?? 1);
    const state = memoryState();

    if (options.inline || !handlerRegistry().has(name)) {
      // Handler tidak dikenal (mis. hanya process web yang meng-antre) — dieksekusi
      // langsung agar tidak menumpuk pekerjaan yang tidak akan pernah berjalan.
      state.active.push(job);
      await executeJob(job, (result) => settleMemoryJob(state, job, result));
      state.active = state.active.filter((item) => item.id !== job.id);
      return job;
    }

    state.pending.push(job);
    drainMemoryQueue();
    return job;
  }

  async stats(): Promise<QueueStats> {
    const state = memoryState();
    return {
      backend: 'memory',
      pending: state.pending.length,
      active: state.active.length,
      completed: state.completed,
      failed: state.failed,
      deadLetter: state.deadLetter.length,
    };
  }

  async listDeadLetter(limit = 50): Promise<DeadLetterEntry[]> {
    return memoryState().deadLetter.slice(0, limit);
  }

  async retryDeadLetter(limit = 50): Promise<number> {
    const state = memoryState();
    const batch = state.deadLetter.splice(0, limit);
    for (const entry of batch) {
      state.pending.push({
        id: entry.job.id,
        name: entry.job.name,
        data: entry.job.data,
        attempts: 0,
        maxAttempts: entry.job.maxAttempts,
        enqueuedAt: new Date().toISOString(),
      });
    }
    if (batch.length > 0) drainMemoryQueue();
    return batch.length;
  }

  async purgeDeadLetter(): Promise<number> {
    const state = memoryState();
    const removed = state.deadLetter.length;
    state.deadLetter = [];
    return removed;
  }

  async history(limit = 50): Promise<HistoryEntry[]> {
    return memoryState().history.slice(0, limit);
  }

  async close(): Promise<void> {
    const state = memoryState();
    state.pending = [];
    state.active = [];
  }
}

/** Menerjemahkan hasil job menjadi pembaruan state antrean in-memory. */
function settleMemoryJob(state: MemoryQueueState, job: AnyJob, result: JobResult) {
  if (result.status === 'completed') state.completed += 1;
  else {
    state.failed += 1;
    state.deadLetter.unshift(toDeadLetter(job, result));
    if (state.deadLetter.length > 100) state.deadLetter.length = 100;
  }

  pushHistory(state, {
    id: result.id,
    name: result.name,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error,
    at: new Date().toISOString(),
  });
}

function toDeadLetter(job: AnyJob, result: JobResult): DeadLetterEntry {
  return {
    job: {
      id: job.id,
      name: job.name,
      data: job.data,
      maxAttempts: job.maxAttempts,
      enqueuedAt: job.enqueuedAt,
    },
    error: result.error ?? 'tidak diketahui',
    attempts: Math.max(1, job.maxAttempts),
    failedAt: new Date().toISOString(),
  };
}

/* ---------------- Redis ---------------- */

export interface RedisQueueKeys {
  pending: string;
  active: string;
  completed: string;
  failed: string;
  deadLetter: string;
  history: string;
}

export function redisQueueKeys(queueName: string): RedisQueueKeys {
  return {
    pending: `resto:queue:${queueName}:pending`,
    active: `resto:queue:${queueName}:active`,
    completed: `resto:queue:${queueName}:completed`,
    failed: `resto:queue:${queueName}:failed`,
    deadLetter: `resto:queue:${queueName}:dead`,
    history: `resto:queue:${queueName}:history`,
  };
}

/**
 * Antrean di atas Redis. `enqueue()` hanya menghantarkan job — pemrosesannya
 * dilakukan oleh worker (`worker.ts`) yang memindahkan job dari `pending` ke
 * `active` dengan BRPOPLPUSH sehingga tidak ada job yang hilang.
 */
export class RedisQueue implements Queue {
  readonly backend = 'redis' as const;

  constructor(
    readonly redis: RedisConnection,
    readonly keys: RedisQueueKeys = redisQueueKeys('default')
  ) {}

  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<Job<T>> {
    const job = createJob(name, data, options.maxAttempts ?? 1);
    await this.redis.lpush(this.keys.pending, JSON.stringify(job));
    return job;
  }

  async stats(): Promise<QueueStats> {
    const [pending, active, completed, failed, deadLetter] = await Promise.all([
      this.redis.llen(this.keys.pending),
      this.redis.llen(this.keys.active),
      this.redis.get(this.keys.completed),
      this.redis.get(this.keys.failed),
      this.redis.llen(this.keys.deadLetter),
    ]);
    return {
      backend: 'redis',
      pending,
      active,
      completed: Number(completed ?? 0),
      failed: Number(failed ?? 0),
      deadLetter,
    };
  }

  async listDeadLetter(limit = 50): Promise<DeadLetterEntry[]> {
    const raw = await this.redis.lrange(this.keys.deadLetter, 0, limit - 1);
    return raw.map(parseEntry).filter((entry): entry is DeadLetterEntry => entry !== null);
  }

  async retryDeadLetter(limit = 50): Promise<number> {
    const entries = await this.listDeadLetter(limit);
    let moved = 0;

    for (const entry of entries) {
      await this.enqueue(entry.job.name, entry.job.data, { maxAttempts: entry.job.maxAttempts });
      await this.redis.lrem(this.keys.deadLetter, JSON.stringify(entry));
      moved += 1;
    }

    return moved;
  }

  async purgeDeadLetter(): Promise<number> {
    const total = await this.redis.llen(this.keys.deadLetter);
    const entries = await this.listDeadLetter(total || 1);
    for (const entry of entries) {
      await this.redis.lrem(this.keys.deadLetter, JSON.stringify(entry));
    }
    return entries.length;
  }

  async history(limit = 50): Promise<HistoryEntry[]> {
    const raw = await this.redis.lrange(this.keys.history, 0, limit - 1);
    return raw.map(parseEntry).filter((entry): entry is HistoryEntry => entry !== null);
  }

  async close(): Promise<void> {
    // Sengaja tidak menghapus antrean: job yang sudah masuk harus tetap diproses
    // worker lain yang mungkin masih hidup.
  }
}

/** Parse aman untuk entri yang Maybe rusak (mis. ditulis versi kode lama). */
function parseEntry<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/* ---------------- Eksekusi & pemilihan backend ---------------- */

/**
 * Menjalankan satu job dengan percobaan ulang + backoff eksponensial.
 *
 * Backoff penting: tanpa jeda, job yang gagal karena masalah sementara (database
 * sedang write, Redis lambat) akan langsung mencoba lagi dan membebani sistem
 * tepat saat ia paling tidak sehat. Handler yang melempar error dicatat, bukan
 * dilempar ke pemanggil — antrean tidak boleh menjatuhkan request HTTP.
 */
export async function executeJob(
  job: AnyJob,
  onSettled?: (result: JobResult) => void | Promise<void>,
  options: { retryBaseDelayMs?: number } = {}
): Promise<JobResult> {
  const started = Date.now();
  const handler = handlerRegistry().get(job.name);
  const baseDelay = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;

  if (!handler) {
    const result: JobResult = {
      id: job.id,
      name: job.name,
      status: 'failed',
      durationMs: Date.now() - started,
      error: `tidak ada handler terdaftar untuk job "${job.name}"`,
    };
    await onSettled?.(result);
    return result;
  }

  let lastError: unknown;
  const total = Math.max(1, job.maxAttempts);

  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      const output = await handler.run({ ...job, attempts: attempt });
      const result: JobResult = {
        id: job.id,
        name: job.name,
        status: 'completed',
        durationMs: Date.now() - started,
        attempts: attempt,
        output,
      };
      await onSettled?.(result);
      return result;
    } catch (error) {
      lastError = error;
      console.error(`[queue] job ${job.name} (${job.id}) percobaan ${attempt}/${total} gagal:`, error);

      if (attempt < total && baseDelay > 0) {
        // 250ms, 500ms, 1000ms, ... (dibatasi agar tidak menahan worker terlalu lama)
        await delay(Math.min(baseDelay * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS));
      }
    }
  }

  const result: JobResult = {
    id: job.id,
    name: job.name,
    status: 'failed',
    durationMs: Date.now() - started,
    attempts: total,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
  await onSettled?.(result);
  return result;
}

/** Jeda retry pertama; naiknya dua kali lipat setiap percobaan. */
const RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 5000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const queueGlobalKey = '__restoQueue';

declare global {
  // eslint-disable-next-line no-var
  var __restoQueue: Queue | undefined;
}

/** Antrean proses ini: Redis bila dikonfigurasi, selain itu in-memory. */
export function getQueue(): Queue {
  const signature = process.env.REDIS_URL ?? '';
  const existing = global[queueGlobalKey];
  if (existing && (existing as { signature?: string }).signature === signature) return existing;

  const redis = getRedis();
  const queue: Queue = redis ? new RedisQueue(redis) : new MemoryQueue();
  (queue as { signature?: string }).signature = signature;
  global[queueGlobalKey] = queue;
  return queue;
}

/** Melempar bila Redis gagal — dipakai worker agar tidak diam-diam sisa job. */
export function isRedisFailure(error: unknown): boolean {
  return error instanceof RedisUnavailableError;
}

/**
 * Menjalankan job inline lewat pipeline yang sama dengan worker, lalu
 * mengembalikan hasilnya.
 *
 * Dipakai oleh endpoint cron agar respons tetap sinkron pada konfigurasi tanpa
 * Redis, dan dipakai test agar tidak perlu menjalankan worker terpisah.
 */
export async function runJobInline<T>(
  name: string,
  data: T,
  maxAttempts = 1
): Promise<JobResult> {
  const job = createJob(name, data, maxAttempts);
  const result = await executeJob(job);
  if (result.status === 'failed') {
    console.error(`[queue] job inline ${name} gagal: ${result.error}`);
    await recordSettledJob(job, result);
  }
  return result;
}

/**
 * Mencatat hasil job yang tidak diproses worker (jalur inline) ke riwayat dan
 * dead-letter, supaya kegagalan inline tidak hilang tanpa jejak.
 */
export async function recordSettledJob(job: AnyJob, result: JobResult): Promise<void> {
  const queue = getQueue();

  if (queue.backend === 'memory') {
    settleMemoryJob(memoryState(), job, result);
    return;
  }

  const redisQueue = queue as RedisQueue;
  const entry: HistoryEntry = {
    id: result.id,
    name: result.name,
    status: result.status,
    durationMs: result.durationMs,
    error: result.error,
    at: new Date().toISOString(),
  };

  try {
    await redisQueue.redis.lpush(redisQueue.keys.history, JSON.stringify(entry));
    if (result.status === 'failed') {
      await redisQueue.redis.lpush(redisQueue.keys.deadLetter, JSON.stringify(toDeadLetter(job, result)));
    }
  } catch {
    // Pencatatan tidak boleh menjadi sumber kegagalan baru.
  }
}

/* ---------------- Heartbeat worker ---------------- */

/**
 * Kunci heartbeat dengan TTL pendek: ada = ada worker yang hidup dan memproses
 * antrean. Dipakai endpoint cron untuk memutuskan "antrekan ke worker" atau
 * "kerjakan di sini saja".
 *
 * Hanya satu kunci dipakai (bukan satu per worker) karena yang ditanyakan
 * adalah "adakah worker?", bukan "berapa worker" — jumlah worker ada di stats.
 */
const HEARTBEAT_KEY = 'resto:queue:worker';

export async function heartbeatWorker(redis: RedisConnection, id: string, ttlSeconds = 30): Promise<void> {
  await redis.set(HEARTBEAT_KEY, id, ttlSeconds);
}

export async function hasLiveWorker(redis: RedisConnection): Promise<boolean> {
  try {
    return await redis.exists(HEARTBEAT_KEY);
  } catch {
    return false;
  }
}


/* ---------------- Worker loop (Redis) ---------------- */

export interface WorkerOptions {
  /** Berapa lama BRPOPLPUSH menunggu sebelum memeriksa ulang antrean. */
  blockSeconds?: number;
  /** Jeda sebelum percobaan ulang job (dasar untuk backoff eksponensial). */
  retryBaseDelayMs?: number;
  /** Jeda sebelum job gagal dicatat — memberi worker lain kesempatan. */
  retryDelayMs?: number;
  onJobResult?: (result: JobResult) => void;
}

/**
 * Loop worker: ambil satu job (blocking), jalankan, lalu acknowledge dengan
 * menghapus salinannya dari list `active`.
 *
 * Dipanggil oleh `scripts/worker.ts` (proses terpisah) dan oleh
 * `startInlineWorker()` (dalam proses, saat `QUEUE_INLINE` aktif).
 */
export async function runWorker(
  queue: RedisQueue,
  options: WorkerOptions = {}
): Promise<() => Promise<void>> {
  const blockSeconds = options.blockSeconds ?? 5;
  const running = { value: true };

  const loop = async () => {
    while (running.value) {
      let payload: string | null = null;
      try {
        payload = await queue.redis.brpoplpush(queue.keys.pending, queue.keys.active, blockSeconds);
      } catch (error) {
        if (isRedisFailure(error)) {
          await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 2000));
          continue;
        }
        throw error;
      }

      if (!payload) continue;

      let job: AnyJob;
      try {
        job = JSON.parse(payload) as AnyJob;
      } catch {
        console.error('[queue] payload rusak, dibuang:', payload.slice(0, 200));
        await queue.redis.lrem(queue.keys.active, payload);
        continue;
      }

      const result = await executeJob(
        job,
        async (settled) => {
          // Acknowledge: job selesai diproses (berhasil maupun gagal) → hapus dari `active`.
          await queue.redis.lrem(queue.keys.active, payload as string);
          const counter = settled.status === 'completed' ? queue.keys.completed : queue.keys.failed;
          await queue.redis.incr(counter);

          const historyEntry: HistoryEntry = {
            id: settled.id,
            name: settled.name,
            status: settled.status,
            durationMs: settled.durationMs,
            error: settled.error,
            at: new Date().toISOString(),
          };
          await queue.redis.lpush(queue.keys.history, JSON.stringify(historyEntry));

          if (settled.status === 'failed') {
            // Job gagal permanen → simpan di dead-letter agar bisa diperiksa
            // dan diantrekan ulang dari panel admin.
            await queue.redis.lpush(queue.keys.deadLetter, JSON.stringify(toDeadLetter(job, settled)));
          }
        },
        { retryBaseDelayMs: options.retryBaseDelayMs }
      );

      options.onJobResult?.(result);
    }
  };

  const finished = loop().catch((error) => {
    console.error('[queue] worker loop berhenti karena error:', error);
  });

  return async () => {
    running.value = false;
    await finished;
  };
}
