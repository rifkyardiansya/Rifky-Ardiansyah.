export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';

/** GET /api/v1/inventory — daftar bahan, alert, dan mutasi stok. */
export const GET = handler(async () => {
  const db = getDb();
  const materials = db
    .prepare(
      `SELECT m.id, m.sku, m.name, m.category, m.unit, m.min_stock AS minStock, m.unit_cost AS unitCost,
              m.expiry_date AS expiryDate, s.quantity AS currentStock, m.supplier_id AS supplierId,
              COALESCE(sup.name, '-') AS supplierName
       FROM raw_materials m JOIN stock_items s ON s.raw_material_id = m.id
       LEFT JOIN suppliers sup ON sup.id = m.supplier_id ORDER BY m.name`
    )
    .all() as Record<string, number | string>[];

  const lowStock = materials.filter((m) => Number(m.currentStock) <= Number(m.minStock));
  const limit = Date.now() + 30 * 86400000;
  const expiring = materials.filter((m) => m.expiryDate && new Date(String(m.expiryDate)).getTime() <= limit);

  const movements = db
    .prepare(
      `SELECT id, raw_material_id AS rawMaterialId, type, qty_change AS qtyChange,
              ref_id AS refId, notes, created_at AS createdAt
       FROM stock_movements ORDER BY created_at DESC LIMIT 50`
    )
    .all();

  return ok({ materials, alerts: { lowStock, expiring }, movements });
});