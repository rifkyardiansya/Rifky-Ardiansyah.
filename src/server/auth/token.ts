import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getDb } from '../db/client';

export const ROLES = ['customer', 'cashier', 'manager', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const COOKIE_NAME = 'rn_session';
export const ACCESS_TTL = '2h';

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'restoran-nusantara-prototype-secret-key-2026'
);

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export async function signToken(user: SessionUser) {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setIssuer('restoran-nusantara')
    .setExpirationTime(ACCESS_TTL)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: 'restoran-nusantara' });
    return {
      id: String(payload.id),
      username: String(payload.username),
      fullName: String(payload.fullName),
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  const row = getDb()
    .prepare('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?')
    .get(payload.id) as { id: string; username: string; full_name: string; role: Role; is_active: number } | undefined;

  if (!row || !row.is_active) return null;
  return { id: row.id, username: row.username, fullName: row.full_name, role: row.role };
}

/** Hirarki wewenang: admin > manager > cashier > customer */
const RANK: Record<Role, number> = { customer: 0, cashier: 1, manager: 2, admin: 3 };

export function hasRole(user: SessionUser | null, minimum: Role): boolean {
  if (!user) return false;
  return RANK[user.role] >= RANK[minimum];
}

export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  cashier: 'Kasir',
  manager: 'Manager',
  admin: 'Administrator',
};