export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { ApiError, handler, ok, requireUser } from '@/server/http/api';
import { payExistingOrder } from '@/server/services/order.service';

/** POST /api/v1/pos/transactions/:id/pay — pelunasan order yang sebelumnya belum dibayar. */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireUser('cashier');
  const body = z
    .object({
      method: z.enum(['cash', 'qris', 'debit', 'credit']),
      cashReceived: z.number().int().min(0).optional(),
    })
    .parse(await req.json());

  return ok(payExistingOrder(params.id, body.method, body.cashReceived));
});

/** GET /api/v1/pos/transactions/:id/pay — status pembayaran order. */
export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireUser('cashier');
  const db = getDb();
  const order = db
    .prepare('SELECT order_no AS orderNo, total, payment_status AS paymentStatus FROM orders WHERE id = ? OR order_no = ?')
    .get(params.id, params.id) as Record<string, unknown> | undefined;

  if (!order) throw new ApiError(404, 'Order tidak ditemukan.');
  return ok({ order });
});