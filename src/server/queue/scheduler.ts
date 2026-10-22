import { getRedis, RedisUnavailableError } from '../infra/redis';

/**
 * Penjadwal job berulang (repeatable job).
 *
 * Tujuan Phase 6: laporan harian tidak lagi bergantung pada cron eksternal
 * (GitHub Actions / Vercel Cron). `scripts/worker.ts` menjalankan loop penjadwal
 * yang setiap 30 detik memeriksa apakah ada schedule yang sudah jatuh tempo.
 *
 * State `nextRunAt` disimpan per schedule — di Redis bila tersedia, di memori
 * bila tidak — sehingga restart worker tidak membuat laporan terpicu dua kali
 * (selain idempotensi per tanggal yang sudah dijamin `schedule.service`).
 */

export type ScheduleBackend = 'redis' | 'memory';

export interface Schedule {
  /** Nama job yang akan diantrekan saat schedule jatuh tempo. */
  name: string;
  /** Interval dalam milidetik (diabaikan bila `atHour` diisi). */
  everyMs?: number;
  /**
   * Jam eksekusi pertama per hari dalam zona WIB (UTC+7).
   * Bila diisi, schedule berjalan setiap hari pada jam tersebut — bukan
   * "setiap N jam sejak worker start".
   */
  atHour?: number;
  /** Data yang disertakan ke job. */
  payload?: Record<string, unknown>;
  /** Zona waktu sederhana; aplikasi ini selalu memakai WIB (UTC+7). */
  offsetHours?: number;
}

export interface DueSchedule {
  schedule: Schedule;
  nextRunAt: number;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Occurrence harian berikutnya (pukul `hour` waktu lokal) strictly setelah `now`. */
export function nextDailyOccurrence(now: number, hour: number, offsetHours = 7): number {
  const offset = offsetHours * 60 * 60 * 1000;
  const local = now + offset;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  let target = dayStart + hour * 60 * 60 * 1000;
  if (target <= local) target += DAY_MS;
  return target - offset;
}

/** Interval berikutnya (untuk schedule berbasis `everyMs`). */
export function nextInterval(now: number, everyMs: number): number {
  return now + everyMs;
}

interface StateStore {
  backend: ScheduleBackend;
  read(name: string): Promise<number | null>;
  write(name: string, value: number): Promise<void>;
}

class MemoryStateStore implements StateStore {
  readonly backend = 'memory' as const;
  private readonly values = new Map<string, number>();
  async read(name: string) {
    return this.values.get(name) ?? null;
  }
  async write(name: string, value: number) {
    this.values.set(name, value);
  }
}

class RedisStateStore implements StateStore {
  readonly backend = 'redis' as const;
  constructor(private readonly keyPrefix = 'resto:schedule:') {}
  async read(name: string) {
    const value = await getRedis()?.get(`${this.keyPrefix}${name}`);
    return value === null || value === undefined ? null : Number(value);
  }
  async write(name: string, value: number) {
    await getRedis()?.set(`${this.keyPrefix}${name}`, String(value));
  }
}

class FallbackStateStore implements StateStore {
  readonly backend: ScheduleBackend;
  private readonly primary: StateStore | null;
  private readonly secondary = new MemoryStateStore();

  constructor() {
    const redis = getRedis();
    this.primary = redis ? new RedisStateStore() : null;
    this.backend = this.primary ? 'redis' : 'memory';
  }

  private async withFallback<T>(fn: (store: StateStore) => Promise<T>): Promise<T> {
    if (!this.primary) return fn(this.secondary);
    try {
      return await fn(this.primary);
    } catch (error) {
      if (!(error instanceof RedisUnavailableError)) throw error;
      return fn(this.secondary);
    }
  }

  read(name: string) {
    return this.withFallback((store) => store.read(name));
  }

  write(name: string, value: number) {
    return this.withFallback((store) => store.write(name, value));
  }
}

export class RepeatScheduler {
  readonly backend: ScheduleBackend;

  private readonly store: StateStore;
  private readonly schedules = new Map<string, Schedule>();

  constructor(store: StateStore = new FallbackStateStore()) {
    this.store = store;
    this.backend = store.backend;
  }

  register(schedule: Schedule): void {
    this.schedules.set(schedule.name, schedule);
  }

  registered(): Schedule[] {
    return [...this.schedules.values()];
  }

  /** Kapan schedule ini akan dijalankan berikutnya. */
  async nextRunAt(name: string, now = Date.now()): Promise<number> {
    const stored = await this.store.read(name);
    if (stored !== null && Number.isFinite(stored)) return stored;

    const schedule = this.schedules.get(name);
    if (!schedule) return now;

    // Jadwal pertama harus langsung disimpan — kalau tidak, tick berikutnya
    // akan menghitung ulang dari `now` dan schedule tidak pernah jatuh tempo.
    const computed = this.computeNext(schedule, now);
    await this.store.write(name, computed);
    return computed;
  }

  private computeNext(schedule: Schedule, now: number): number {
    if (schedule.atHour !== undefined) return nextDailyOccurrence(now, schedule.atHour, schedule.offsetHours ?? 7);
    return nextInterval(now, schedule.everyMs ?? 60_000);
  }

  /**
   * Mengembalikan schedule yang sudah jatuh tempo lalu menggeser waktu
   * berikutnya. `now` dapat di-inject agar mudah diuji.
   */
  async tick(now = Date.now()): Promise<DueSchedule[]> {
    const due: DueSchedule[] = [];

    for (const schedule of this.schedules.values()) {
      const next = await this.nextRunAt(schedule.name, now);
      if (next > now) continue;

      await this.store.write(schedule.name, this.computeNext(schedule, now));
      due.push({ schedule, nextRunAt: next });
    }

    return due;
  }
}

const schedulerGlobalKey = '__restoScheduler';

declare global {
  // eslint-disable-next-line no-var
  var __restoScheduler: RepeatScheduler | undefined;
}

export function getScheduler(): RepeatScheduler {
  const signature = process.env.REDIS_URL ?? '';
  const existing = global[schedulerGlobalKey];
  if (existing && (existing as { signature?: string }).signature === signature) return existing;

  const scheduler = new RepeatScheduler();
  (scheduler as { signature?: string }).signature = signature;
  global[schedulerGlobalKey] = scheduler;
  return scheduler;
}

/** Membuang penjadwal proses (dipakai test saat REDIS_URL berubah). */
export function resetScheduler(): void {
  global[schedulerGlobalKey] = undefined;
}
