export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { ApiError, handler, ok, requireUser } from '@/server/http/api';

/** GET /api/v1/pos/receipt/:id — data struk 80mm untuk dicetak. */
export const GET = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireUser('cashier');
  const db = getDb();

  const order = db
    .prepare(
      `SELECT id, order_no AS orderNo, table_number AS tableNumber, customer_name AS customerName,
              source, subtotal, discount, service_charge AS serviceCharge, tax, total,
              status, payment_status AS paymentStatus, payment_method AS paymentMethod,
              cash_received AS cashReceived, change_amount AS change, created_at AS createdAt, paid_at AS paidAt
       FROM orders WHERE id = ? OR order_no = ?`
    )
    .get(params.id, params.id) as Record<string, unknown> | undefined;

  if (!order) throw new ApiError(404, 'Struk tidak ditemukan.');

  const items = db
    .prepare(
      `SELECT id, menu_item_id AS menuItemId, name, price, quantity, notes, subtotal
       FROM order_items WHERE order_id = ?`
    )
    .all(String(order.id));

  return ok({
    order: { ...order, items },
    store: {
      name: 'Restoran Nusantara',
      address: 'Jl. Merdeka Raya No. 45, Jakarta',
      phone: '(021) 555-0199',
      npwp: '01.234.567.8-901.000',
    },
  });
});