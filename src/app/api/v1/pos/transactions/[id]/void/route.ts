export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { getDb, nowISO } from '@/server/db/client';
import { handler, ok, requireUser } from '@/server/http/api';
import { updateOrderStatus } from '@/server/services/order.service';

/** POST /api/v1/pos/transactions/:id/void — pembatalan transaksi (minimal role manager). */
export const POST = handler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireUser('manager');
  const body = z.object({ reason: z.string().max(200).default('Tanpa alasan') }).parse(
    await req.json().catch(() => ({}))
  );

  updateOrderStatus(params.id, 'cancelled');
  getDb()
    .prepare('UPDATE orders SET void_reason = ?, updated_at = ? WHERE id = ?')
    .run(body.reason, nowISO(), params.id);

  return ok({ id: params.id, status: 'cancelled', reason: body.reason });
});