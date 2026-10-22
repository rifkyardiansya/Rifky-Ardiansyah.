import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'restoran-nusantara-prototype-secret-key-2026'
);

const RANK = { customer: 0, cashier: 1, manager: 2, admin: 3 } as const;
type Role = keyof typeof RANK;

/** Route yang membutuhkan login + minimal role tertentu. */
const PROTECTED: { prefix: string; minRole: Role }[] = [
  { prefix: '/pos', minRole: 'cashier' },
  { prefix: '/inventory', minRole: 'manager' },
  { prefix: '/reports', minRole: 'manager' },
  { prefix: '/notifications', minRole: 'manager' },
  { prefix: '/admin', minRole: 'admin' },
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const rule = PROTECTED.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!rule) return NextResponse.next();

  const token = req.cookies.get('rn_session')?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  try {
    const { payload } = await jwtVerify(token, secret, { issuer: 'restoran-nusantara' });
    const role = String(payload.role) as Role;
    if (RANK[role] >= RANK[rule.minRole]) return NextResponse.next();
  } catch {
    /* token tidak valid → treat sebagai guest */
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('denied', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/pos/:path*', '/inventory/:path*', '/reports/:path*', '/notifications/:path*', '/admin/:path*'],
};