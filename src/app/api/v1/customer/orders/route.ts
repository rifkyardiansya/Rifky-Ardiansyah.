export const dynamic = 'force-dynamic';

import { handler, ok, requireUser } from '@/server/http/api';
import { placeOrder, placeOrderSchema } from '@/server/services/order.service';

/** POST /api/v1/customer/orders — pemesanan mandiri via scan barcode (publik). */
export const POST = handler(async (req: Request) => {
  const body = placeOrderSchema.parse(await req.json());
  // Endpoint publik untuk scan QR: customer belum tentu punya akun.
  const user = await requireUser('customer').catch(() => null);
  const result = placeOrder({ ...body, source: 'customer_qr' }, user?.id ?? null);
  return ok(result, { status: 201 });
});