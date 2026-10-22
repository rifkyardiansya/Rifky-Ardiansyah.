export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { COOKIE_NAME } from '@/server/auth/token';
import { handler, ok } from '@/server/http/api';

export const GET = handler(async () => {
  const db = getDb();
  const token = (await import('next/headers')).cookies().get(COOKIE_NAME)?.value;
  if (!token) return ok({ user: null });

  const { verifyToken } = await import('@/server/auth/token');
  const payload = await verifyToken(token);
  if (!payload) return ok({ user: null });

  const row = db
    .prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?')
    .get(payload.id) as { id: string; username: string; full_name: string; role: string; is_active: number } | undefined;

  if (!row?.is_active) return ok({ user: null });

  return ok({
    user: { id: row.id, username: row.username, fullName: row.full_name, role: row.role },
  });
});

export const DELETE = handler(async () => {
  const res = NextResponse.json({ success: true, data: { loggedOut: true } });
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
});