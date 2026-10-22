export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';

/**
 * GET /api/v1/customer — ringkasan data untuk Customer Portal:
 * daftar meja yang dapat dipindai + kategori menu.
 */
export const GET = handler(async () => {
  const db = getDb();
  const tables = db
    .prepare(
      `SELECT id, table_no AS tableNo, barcode, capacity, section, status
       FROM restaurant_tables ORDER BY table_no`
    )
    .all() as Record<string, unknown>[];

  const categories = db
    .prepare('SELECT DISTINCT category FROM menu_items WHERE is_active = 1 ORDER BY category')
    .all() as { category: string }[];

  return ok({ tables, categories: categories.map((c) => c.category) });
});