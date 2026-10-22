export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';
import { updateOrderStatus } from '@/server/services/order.service';
import { z } from 'zod';

const statusSchema = z.object({
  status: z.enum(['pending', 'cooking', 'ready', 'served', 'completed', 'cancelled']),
});

/** PATCH /api/v1/orders/:id/status — dipakai KDS & customer (track pesanan). */
export const PATCH = handler(async (req: Request, { params }: { params: { id: string } }) => {
  const { status } = statusSchema.parse(await req.json());
  return ok(updateOrderStatus(params.id, status));
});

export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT id, order_no AS orderNo, table_number AS tableNumber, customer_name AS customerName,
              source, subtotal, discount, service_charge AS serviceCharge, tax, total,
              status, payment_status AS paymentStatus, payment_method AS paymentMethod,
              cash_received AS cashReceived, change_amount AS change,
              created_at AS createdAt, paid_at AS paidAt
       FROM orders WHERE id = ? OR order_no = ?`
    )
    .get(params.id, params.id) as Record<string, unknown> | undefined;

  if (!order) return ok({ order: null }, { status: 404 });

  const items = db
    .prepare('SELECT id, menu_item_id AS menuItemId, name, price, quantity, notes, subtotal FROM order_items WHERE order_id = ?')
    .all(String(order.id));

  return ok({ order: { ...order, items } });
});