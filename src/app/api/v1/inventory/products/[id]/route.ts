export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { getDb, nowISO } from '@/server/db/client';
import { ApiError, handler, ok, requireUser } from '@/server/http/api';

/** PATCH /api/v1/inventory/products/:id — ubah harga / ketersediaan menu. */
export const PATCH = handler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireUser('manager');
  const body = z
    .object({
      name: z.string().min(2).max(100).optional(),
      price: z.number().int().min(0).optional(),
      isActive: z.boolean().optional(),
    })
    .parse(await req.json());

  const db = getDb();
  const current = db.prepare('SELECT name, price, is_active FROM menu_items WHERE id = ?').get(params.id) as
    | { name: string; price: number; is_active: number }
    | undefined;
  if (!current) throw new ApiError(404, 'Menu tidak ditemukan.');

  db.prepare('UPDATE menu_items SET name = ?, price = ?, is_active = ?, updated_at = ? WHERE id = ?').run(
    body.name ?? current.name,
    body.price ?? current.price,
    body.isActive === undefined ? current.is_active : body.isActive ? 1 : 0,
    nowISO(),
    params.id
  );

  return ok({
    id: params.id,
    name: body.name ?? current.name,
    price: body.price ?? current.price,
    available: body.isActive === undefined ? Boolean(current.is_active) : body.isActive,
  });
});