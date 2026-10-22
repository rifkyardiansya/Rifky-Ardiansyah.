export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { hashPassword } from '@/server/auth/password';
import { fail, handler, ok } from '@/server/http/api';

const registerSchema = z.object({
  username: z.string().min(3, 'Username minimal 3 karakter').max(30),
  fullName: z.string().min(2, 'Nama lengkap minimal 2 karakter').max(80),
  email: z.string().email('Format email tidak valid'),
  phone: z.string().max(30).optional(),
  password: z.string().min(6, 'Password minimal 6 karakter'),
});

export const POST = handler(async (req: Request) => {
  const body = registerSchema.parse(await req.json());
  const db = getDb();
  const id = `u-${crypto.randomUUID().slice(0, 8)}`;

  try {
    db.prepare(
      `INSERT INTO users (id, username, full_name, email, phone, password_hash, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'customer', 1, ?)`
    ).run(
      id,
      body.username.trim().toLowerCase(),
      body.fullName,
      body.email.toLowerCase(),
      body.phone ?? null,
      hashPassword(body.password),
      new Date().toISOString()
    );
  } catch {
    return fail('Username atau email sudah terdaftar.', 409, 'DUPLICATE');
  }

  return ok({ id, username: body.username, role: 'customer' }, { status: 201 });
});