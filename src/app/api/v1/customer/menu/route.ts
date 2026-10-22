export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';

/** GET /api/v1/customer/menu — katalog menu (opsional: filter kategori & pencarian). */
export const GET = handler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  const search = searchParams.get('q');

  const db = getDb();
  const where: string[] = ['is_active = 1'];
  const params: unknown[] = [];
  if (category && category !== 'Semua') {
    where.push('category = ?');
    params.push(category);
  }
  if (search) {
    where.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)');
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }

  const items = db
    .prepare(
      `SELECT id, name, category, barcode, image, description, price, cost_price AS costPrice
       FROM menu_items WHERE ${where.join(' AND ')} ORDER BY category, name`
    )
    .all(...params) as Record<string, unknown>[];

  const categories = db
    .prepare('SELECT DISTINCT category FROM menu_items ORDER BY category')
    .all() as { category: string }[];

  return ok({ items, categories: categories.map((c) => c.category) });
});