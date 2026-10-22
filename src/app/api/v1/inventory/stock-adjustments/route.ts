export const dynamic = 'force-dynamic';

import { getDb, nowISO } from '@/server/db/client';
import { handler, ok, requireUser } from '@/server/http/api';
import { adjustStock, adjustSchema } from '@/server/services/inventory.service';

/** POST /api/v1/inventory/stock-adjustments — stock opname / penyesuaian stok. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser('manager');
  const body = adjustSchema.parse(await req.json());
  const result = adjustStock(body, user.id);

  getDb()
    .prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip_address, created_at)
       VALUES (?, ?, 'ADJUST_STOCK', 'raw_materials', ?, 'local', ?)`
    )
    .run(`aud-${crypto.randomUUID().slice(0, 8)}`, user.id, body.rawMaterialId, nowISO());

  return ok(result);
});