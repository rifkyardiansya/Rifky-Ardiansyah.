export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';

/** GET /api/v1/menu/items — katalog lengkap termasuk resep (BOM) untuk kalkulasi HPP. */
export const GET = handler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const search = searchParams.get('q');

  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (category && category !== 'Semua') {
    where.push('m.category = ?');
    params.push(category);
  }
  if (search) {
    where.push('(LOWER(m.name) LIKE ? OR LOWER(m.description) LIKE ?)');
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const items = db
    .prepare(
      `SELECT m.id, m.name, m.category, m.barcode, m.image, m.description,
              m.price, m.cost_price AS costPrice, m.is_active AS available
       FROM menu_items m ${clause} ORDER BY m.category, m.name`
    )
    .all(...params) as Record<string, unknown>[];

  const recipes = db
    .prepare(
      `SELECT r.menu_item_id AS menuItemId, r.raw_material_id AS rawMaterialId,
              r.amount_needed AS amountNeeded, r.unit
       FROM menu_recipes r`
    )
    .all() as { menuItemId: string; rawMaterialId: string; amountNeeded: number; unit: string }[];

  return ok({
    items: items.map((i) => ({ ...i, recipe: recipes.filter((r) => r.menuItemId === String(i.id)) })),
  });
});