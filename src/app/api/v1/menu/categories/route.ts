export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';

/** GET /api/v1/menu/categories — daftar kategori menu beserta jumlah item. */
export const GET = handler(async () => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT category AS name, COUNT(*) AS itemCount
       FROM menu_items WHERE is_active = 1
       GROUP BY category ORDER BY category`
    )
    .all() as { name: string; itemCount: number }[];

  return ok({ categories: rows });
});