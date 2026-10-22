export const dynamic = 'force-dynamic';

import { handler, ok, requireUser } from '@/server/http/api';
import { receivePurchaseOrder } from '@/server/services/inventory.service';

/** POST /api/v1/inventory/purchase-orders/:id/receive — penerimaan barang (GRN). */
export const POST = handler(async (_req: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser('manager');
  return ok(receivePurchaseOrder(params.id, user.id));
});