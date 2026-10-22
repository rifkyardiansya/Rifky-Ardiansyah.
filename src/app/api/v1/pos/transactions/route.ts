export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok, requireUser } from '@/server/http/api';
import { RATE_LIMITS, clientKey, rateLimit } from '@/server/http/rate-limit';
import { placeOrder, placeOrderSchema } from '@/server/services/order.service';

/** POST /api/v1/pos/transactions — buat transaksi kasir (butuh sesi kasir terbuka). */
export const POST = handler(async (req: Request) => {
  const limit = await rateLimit(clientKey(req, 'pos-order'), RATE_LIMITS.order);
  if (!limit.allowed) {
    return ok({ message: 'Terlalu banyak transaksi dalam waktu singkat.', code: 'RATE_LIMITED' }, { status: 429 });
  }

  const user = await requireUser('cashier');
  const body = placeOrderSchema.parse(await req.json());

  const db = getDb();
  const open = db.prepare('SELECT id FROM pos_sessions WHERE closed_at IS NULL LIMIT 1').get();
  if (!open) {
    return ok(
      { message: 'Sesi kasir belum dibuka. Buka shift terlebih dahulu.', code: 'NO_OPEN_SESSION' },
      { status: 409 }
    );
  }

  const result = placeOrder({ ...body, source: 'pos_cashier' }, user.id);
  return ok(result, { status: 201 });
});

/** GET /api/v1/pos/transactions — 50 transaksi terakhir. */
export const GET = handler(async () => {
  await requireUser('cashier');
  const db = getDb();
  const transactions = db
    .prepare(
      `SELECT id, order_no AS orderNo, table_number AS tableNumber, customer_name AS customerName,
              source, subtotal, discount, service_charge AS serviceCharge, tax, total,
              status, payment_status AS paymentStatus, payment_method AS paymentMethod,
              cash_received AS cashReceived, change_amount AS change, created_at AS createdAt, paid_at AS paidAt
       FROM orders ORDER BY created_at DESC LIMIT 50`
    )
    .all();
  return ok({ transactions });
});