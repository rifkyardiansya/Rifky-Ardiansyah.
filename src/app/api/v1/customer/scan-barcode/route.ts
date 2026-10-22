export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';

/**
 * POST /api/v1/customer/scan-barcode
 * Verifikasi kode yang dipindai (QR meja ATAU barcode produk menu).
 * Endpoint publik — dipakai sebelum customer login.
 */
export const POST = handler(async (req: Request) => {
  const { code } = z.object({ code: z.string().min(1, 'Kode barcode wajib diisi') }).parse(await req.json());
  const db = getDb();
  const normalized = code.trim().toUpperCase();

  if (normalized === 'TAKEAWAY' || normalized === 'NT-TAKEAWAY') {
    return ok({ kind: 'takeaway', label: 'Takeaway / Bungkus' });
  }

  const table = db
    .prepare(
      `SELECT id, table_no AS tableNo, barcode, capacity, section, status
       FROM restaurant_tables
       WHERE UPPER(barcode) = ? OR UPPER(table_no) = ?`
    )
    .get(normalized, normalized) as Record<string, unknown> | undefined;

  if (table) return ok({ kind: 'table', table });

  const item = db
    .prepare(
      `SELECT id, name, category, barcode, image, description, price,
              cost_price AS costPrice, is_active AS available
       FROM menu_items WHERE UPPER(barcode) = ?`
    )
    .get(normalized) as Record<string, unknown> | undefined;

  if (item) return ok({ kind: 'menu_item', item });

  // Kode tidak dikenal -> tetap 200 agar client dapat menampilkan pesan ramah
  return ok({ kind: 'invalid', message: `Kode "${code}" tidak dikenali.`, scannedCode: normalized });
});