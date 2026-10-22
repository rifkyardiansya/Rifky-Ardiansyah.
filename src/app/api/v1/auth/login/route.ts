export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { runSeed } from '@/server/db/seed';
import { verifyPassword } from '@/server/auth/password';
import { COOKIE_NAME, signToken, type Role } from '@/server/auth/token';
import { fail, handler, ok } from '@/server/http/api';
import { RATE_LIMITS, clientKey, rateLimit, resetRateLimit } from '@/server/http/rate-limit';

const loginSchema = z.object({
  username: z.string().min(3, 'Username minimal 3 karakter'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
});

export const POST = handler(async (req: Request) => {
  // Pembatasan brute-force: maksimal 5 percobaan GAGAL / 5 menit / IP.
  const limitKey = clientKey(req, 'login');
  const limit = await rateLimit(limitKey, RATE_LIMITS.login);
  if (!limit.allowed) {
    return fail(
      `Terlalu banyak percobaan login. Coba lagi dalam ${limit.retryAfterSeconds} detik.`,
      429,
      'RATE_LIMITED'
    );
  }

  const body = loginSchema.parse(await req.json());
  const db = getDb();

  const user = db
    .prepare('SELECT id, username, full_name, role, password_hash, is_active FROM users WHERE username = ?')
    .get(body.username.trim().toLowerCase()) as
    | { id: string; username: string; full_name: string; role: Role; password_hash: string; is_active: number }
    | undefined;

  if (!user || !user.is_active || !verifyPassword(body.password, user.password_hash)) {
    return fail('Username atau password salah.', 401, 'INVALID_CREDENTIALS');
  }

  // Berhasil login -> bersihkan penghitung kegagalan.
  await resetRateLimit(limitKey);

  const session = { id: user.id, username: user.username, fullName: user.full_name, role: user.role };
  const token = await signToken(session);

  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip_address, created_at)
     VALUES (?, ?, 'LOGIN', 'users', ?, ?, ?)`
  ).run(
    `aud-${crypto.randomUUID().slice(0, 8)}`,
    user.id,
    user.id,
    req.headers.get('x-forwarded-for') ?? 'local',
    new Date().toISOString()
  );

  const res = NextResponse.json({ success: true, data: session });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 2,
  });
  return res;
});

/** health-check: sekaligus memicu seed otomatis bila database masih kosong. */
export const GET = handler(async () => {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
  if (count === 0) runSeed();
  return ok({ seeded: count === 0, userCount: count === 0 ? (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c : count });
});