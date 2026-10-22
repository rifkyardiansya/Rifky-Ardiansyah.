import crypto from 'node:crypto';
import { getRedis, RedisUnavailableError, type RedisConnection } from './redis';

/**
 * Penyimpanan "key-value" generik untuk lapisan infrastruktur: saat ini dipakai
 * rate limiter (sliding window). Semua state disimpan per-kunci dengan TTL
 * sehingga tidak perlu migrasi skema dan key-nya dibersihkan Redis sendiri.
 */

export type StoreBackend = 'redis' | 'memory';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
}

export interface SlidingWindowStore {
  readonly backend: StoreBackend;
  /** Mencatat satu percobaan; mengembalikan status kuota setelahnya. */
  hit(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitResult>;
  /** Membersihkan kuota (dipanggil setelah login berhasil). */
  reset(key: string): Promise<void>;
}

/* ---------------- In-memory (fallback) ---------------- */

interface Bucket {
  hits: number[];
}

const globalKey = '__restoSlidingWindow';

declare global {
  // eslint-disable-next-line no-var
  var __restoSlidingWindow: Map<string, Bucket> | undefined;
}

function buckets(): Map<string, Bucket> {
  if (!global[globalKey]) global[globalKey] = new Map();
  return global[globalKey]!;
}

/**
 * Sliding window berbasis Map. Perilaku ini adalah rujukan (baseline) yang
 * harus sama dengan implementasi Redis — perbedaan keduanya diuji di
 * `tests/phase6.test.ts` agar tidak ada regresi diam-diam.
 */
export class MemorySlidingWindowStore implements SlidingWindowStore {
  readonly backend = 'memory' as const;

  async hit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
    const store = buckets();
    const windowStart = now - windowMs;
    const bucket = store.get(key) ?? { hits: [] };

    bucket.hits = bucket.hits.filter((t) => t > windowStart);

    if (bucket.hits.length >= limit) {
      const oldest = bucket.hits[0];
      store.set(key, bucket);
      return {
        allowed: false,
        remaining: 0,
        limit,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    bucket.hits.push(now);
    store.set(key, bucket);

    // Pembersihan berkala agar Map tidak tumbuh tanpa batas.
    if (store.size > 5000) {
      for (const [k, v] of store) {
        if (!v.hits.some((t) => t > windowStart)) store.delete(k);
      }
    }

    return { allowed: true, remaining: limit - bucket.hits.length, limit, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    buckets().delete(key);
  }
}

/* ---------------- Redis ---------------- */

/**
 * Sliding window memakai sorted set: setiap permintaan disimpan sebagai member
 * dengan score = timestamp, sehingga jendela "bergeser" secara alami (permintaan
 * yang sudah keluar dari jendela dihapus dengan ZREMRANGEBYSCORE).
 *
 * Koordinasi antar-instance tidak atomik tanpa Lua, namun untuk rate limiting
 * hal ini aman: pada kasus terburuk beberapa permintaan yang datang bersamaan
 * menembus batas dalam milidikit yang sama — jauh di bawah toleransi rate
 * limiter pada umumnya.
 */
export class RedisSlidingWindowStore implements SlidingWindowStore {
  readonly backend = 'redis' as const;

  constructor(private readonly redis: RedisConnection) {}

  private key(key: string) {
    return `resto:rl:${key}`;
  }

  async hit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
    const zkey = this.key(key);
    const windowStart = now - windowMs;

    await this.redis.zremrangebyscore(zkey, '-inf', windowStart);
    const used = await this.redis.zcard(zkey);

    // TTL sedikit lebih panjang dari jendela agar key benar-benar hilang sendiri.
    const ttlSeconds = Math.ceil(windowMs / 1000) + 1;

    if (used >= limit) {
      const oldest = await this.redis.zrangebyscoreWithScores(zkey, '-inf', '+inf');
      await this.redis.expire(zkey, ttlSeconds);
      const oldestAt = oldest[0]?.score ?? now;
      return {
        allowed: false,
        remaining: 0,
        limit,
        retryAfterSeconds: Math.max(1, Math.ceil((oldestAt + windowMs - now) / 1000)),
      };
    }

    // Member unik: timestamp yang sama (permintaan paralel) tidak menimpa.
    await this.redis.zadd(zkey, now, `${now}-${crypto.randomUUID().slice(0, 8)}`);
    await this.redis.expire(zkey, ttlSeconds);

    return { allowed: true, remaining: limit - used - 1, limit, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }
}

/**
 * Store yang dipakai aplikasi: Redis bila dikonfigurasi dan dapat dihubungi,
 * selain itu in-memory.
 *
 * Kegagalan Redis tidak boleh menjatuhkan seluruh endpoint — karena itu setiap
 * panggilan dibungkus percobaan ulang ke store memori.
 */
export class FallbackSlidingWindowStore implements SlidingWindowStore {
  readonly backend: StoreBackend;

  private readonly primary: SlidingWindowStore | null;
  private readonly secondary: SlidingWindowStore;

  constructor() {
    this.secondary = new MemorySlidingWindowStore();
    const redis = getRedis();
    this.primary = redis ? new RedisSlidingWindowStore(redis) : null;
    this.backend = this.primary ? 'redis' : 'memory';
  }

  async hit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
    if (!this.primary) return this.secondary.hit(key, limit, windowMs, now);
    try {
      return await this.primary.hit(key, limit, windowMs, now);
    } catch (error) {
      if (!(error instanceof RedisUnavailableError)) throw error;
      return this.secondary.hit(key, limit, windowMs, now);
    }
  }

  async reset(key: string): Promise<void> {
    if (!this.primary) return this.secondary.reset(key);
    try {
      await this.primary.reset(key);
    } catch (error) {
      if (!(error instanceof RedisUnavailableError)) throw error;
      await this.secondary.reset(key);
    }
  }
}

const globalStoreKey = '__restoSlidingWindowStore';

declare global {
  // eslint-disable-next-line no-var
  var __restoSlidingWindowStore: SlidingWindowStore | undefined;
}

/** Store proses — dibuat ulang bila `REDIS_URL` berubah (test & reload). */
export function getSlidingWindowStore(): SlidingWindowStore {
  const signature = process.env.REDIS_URL ?? '';
  const existing = global[globalStoreKey];
  if (existing && (existing as { signature?: string }).signature === signature) return existing;
  const store = new FallbackSlidingWindowStore();
  (store as { signature?: string }).signature = signature;
  global[globalStoreKey] = store;
  return store;
}
