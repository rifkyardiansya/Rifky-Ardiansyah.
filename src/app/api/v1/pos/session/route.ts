export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { getDb, nowISO } from '@/server/db/client';
import { ApiError, handler, ok, requireUser } from '@/server/http/api';

/** POST /api/v1/pos/session — buka shift kasir (jika ada session terbuka akan Ditolak). */
export const POST = handler(async (req: Request) => {
  const user = await requireUser('cashier');
  const body = z
    .object({ openingCash: z.number().int().min(0).default(0), cashierName: z.string().max(80).optional() })
    .parse(await req.json().catch(() => ({})));

  const db = getDb();
  const open = db.prepare('SELECT id FROM pos_sessions WHERE closed_at IS NULL LIMIT 1').get();
  if (open) throw new ApiError(409, 'Masih ada sesi kasir yang terbuka.');

  const id = `ses-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO pos_sessions (id, cashier_id, cashier_name, opening_cash, expected_cash, opened_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, user.id, body.cashierName ?? user.fullName, body.openingCash, body.openingCash, nowISO());

  return ok({ id, cashierName: body.cashierName ?? user.fullName, openingCash: body.openingCash, isOpen: true }, { status: 201 });
});

/** PATCH /api/v1/pos/session — tutup shift & cetak Z-Report. */
export const PATCH = handler(async (req: Request) => {
  await requireUser('cashier');
  const body = z.object({ closingCash: z.number().int().min(0) }).parse(await req.json());

  const db = getDb();
  const session = db
    .prepare(
      `SELECT id, cashier_name, opening_cash, expected_cash, total_transactions, total_revenue, opened_at
       FROM pos_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`
    )
    .get() as
    | { id: string; cashier_name: string; opening_cash: number; expected_cash: number; total_transactions: number; total_revenue: number; opened_at: string }
    | undefined;

  if (!session) throw new ApiError(409, 'Tidak ada sesi kasir terbuka.');

  const byMethod = db
    .prepare(
      `SELECT COALESCE(payment_method,'-') AS method, COUNT(*) AS orders, SUM(total) AS revenue
       FROM orders WHERE payment_status = 'paid' GROUP BY payment_method`
    )
    .all();

  db.prepare('UPDATE pos_sessions SET closing_cash = ?, closed_at = ? WHERE id = ?')
    .run(body.closingCash, nowISO(), session.id);

  const expected = session.expected_cash ?? session.opening_cash;

  return ok({
    sessionId: session.id,
    cashierName: session.cashier_name,
    openedAt: session.opened_at,
    closedAt: nowISO(),
    openingCash: session.opening_cash,
    expectedCash: expected,
    closingCash: body.closingCash,
    difference: body.closingCash - expected,
    totalTransactions: session.total_transactions,
    totalRevenue: session.total_revenue,
    byMethod,
  });
});

/** GET /api/v1/pos/session — sesi kasir yang sedang berjalan. */
export const GET = handler(async () => {
  const db = getDb();
  const session = db
    .prepare(
      `SELECT ps.id, ps.cashier_id AS cashierId, ps.cashier_name AS cashierName,
              ps.opening_cash AS openingCash, ps.closing_cash AS closingCash,
              COALESCE(ps.expected_cash, ps.opening_cash) AS expectedCash,
              ps.total_transactions AS totalTransactions, ps.total_revenue AS totalRevenue,
              ps.opened_at AS startTime, ps.closed_at AS endTime
       FROM pos_sessions ps WHERE ps.closed_at IS NULL ORDER BY ps.opened_at DESC LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;

  return ok({ session: session ? { ...session, isOpen: true } : null });
});