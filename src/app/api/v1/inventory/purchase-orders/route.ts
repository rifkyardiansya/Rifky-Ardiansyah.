export const dynamic = 'force-dynamic';

import { handler, ok, requireUser } from '@/server/http/api';
import { createPurchaseOrder, poSchema } from '@/server/services/inventory.service';

/** POST /api/v1/inventory/purchase-orders — buat purchase order ke supplier. */
export const POST = handler(async (req: Request) => {
  await requireUser('manager');
  const body = poSchema.parse(await req.json());
  return ok(createPurchaseOrder(body), { status: 201 });
});