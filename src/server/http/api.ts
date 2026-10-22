import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getSessionUser, hasRole, type Role, type SessionUser } from '../auth/token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

/**
 * Wrapper untuk route handler: catch error terpusat (validasi Zod, ApiError,
 * dan error tak terduga) sehingga setiap route tetap ringkas.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response> | Response
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.message, error.status, error.code);
      if (error instanceof ZodError) {
        const detail = error.issues
          .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
          .join('; ');
        return fail(`Validasi gagal — ${detail}`, 422, 'VALIDATION_ERROR');
      }
      console.error('[api] unhandled error:', error);
      return fail('Terjadi kesalahan pada server.', 500, 'INTERNAL_ERROR');
    }
  };
}

export async function requireUser(minimum: Role = 'customer'): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, 'Anda harus login terlebih dahulu.', 'UNAUTHORIZED');
  if (!hasRole(user, minimum)) {
    throw new ApiError(403, `Akses ditolak. Minimal role: ${minimum}.`, 'FORBIDDEN');
  }
  return user;
}