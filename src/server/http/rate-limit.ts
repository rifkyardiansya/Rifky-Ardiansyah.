import { getSlidingWindowStore, type RateLimitResult, type SlidingWindowStore } from '../infra/kv';

/**
 * Rate limiter (sliding window).
 *
 * Fase 6: state kuota dipindahkan ke Redis bila `REDIS_URL` disetel, sehingga
 * batasa berlaku lintas instance dan bertahan melewati restart. Tanpa Redis,
 * sistem otomatis memakai penyimpanan in-memory — perilaku dan antarmukanya
 * identik, hanya skalabilitasnya yang berbeda.
 *
 * Catatan: kuota login hanya menghitung percobaan GAGAL (lihat `resetRateLimit`)
 * sehingga user yang sah tidak terkunci setelah login berulang kali.
 */

export type { RateLimitResult } from '../infra/kv';

export function rateLimitStore(): SlidingWindowStore {
  return getSlidingWindowStore();
}

export async function rateLimit(
  key: string,
  options: { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  return getSlidingWindowStore().hit(key, options.limit, options.windowMs);
}

/** Mengambil identitas klien dari header proxy (Vercel/Cloudflare/Nginx). */
export function clientKey(req: Request, scope = ''): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  return `${scope}:${ip}`;
}

/** Membersihkan bucket (dipanggil setelah autentikasi berhasil). */
export async function resetRateLimit(key: string): Promise<void> {
  await getSlidingWindowStore().reset(key);
}

/** Konfigurasi default per jenis endpoint. */
export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 5 * 60 * 1000 },
  register: { limit: 3, windowMs: 60 * 60 * 1000 },
  webhook: { limit: 120, windowMs: 60 * 1000 },
  order: { limit: 30, windowMs: 60 * 1000 },
  report: { limit: 60, windowMs: 60 * 1000 },
} as const;
