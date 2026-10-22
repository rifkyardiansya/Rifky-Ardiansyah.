import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb, nowISO, todayISO } from '../db/client';
import { ApiError } from '../http/api';
import { ledgerCategory } from './order.service';
import { notifyLowStock } from './notification.service';
import { publish } from '../realtime/bus';

export const poSchema = z.object({
  supplierId: z.string().min(1),
  notes: z.string().max(300).optional(),
  items: z
    .array(
      z.object({
        rawMaterialId: z.string().min(1),
        quantity: z.number().positive('Jumlah harus lebih dari 0'),
      })
    )
    .min(1, 'Purchase order minimal berisi 1 bahan'),
});

export const adjustSchema = z.object({
  rawMaterialId: z.string().min(1),
  delta: z.number().refine((v) => v !== 0, 'Selisih tidak boleh nol'),
  reason: z.string().min(3, 'Alasan wajib diisi').max(200),
});

export function nextPoNumber(): string {
  const row = getDb()
    .prepare(
      `SELECT po_number FROM purchase_orders WHERE po_number LIKE 'PO-%'
       ORDER BY CAST(SUBSTR(po_number, 4) AS INTEGER) DESC LIMIT 1`
    )
    .get() as { po_number: string } | undefined;
  const next = row ? Number(row.po_number.slice(3)) + 1 : 1;
  return `PO-${String(next).padStart(4, '0')}`;
}

export function createPurchaseOrder(input: z.infer<typeof poSchema>) {
  const db = getDb();
  const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(input.supplierId) as
    | { id: string; name: string }
    | undefined;
  if (!supplier) throw new ApiError(404, 'Supplier tidak ditemukan.');

  const items = input.items.map((i) => {
    const mat = db
      .prepare('SELECT id, name, unit, unit_cost FROM raw_materials WHERE id = ?')
      .get(i.rawMaterialId) as { id: string; name: string; unit: string; unit_cost: number } | undefined;
    if (!mat) throw new ApiError(404, `Bahan ${i.rawMaterialId} tidak ditemukan.`);
    return { ...mat, quantity: i.quantity, subtotal: Math.round(mat.unit_cost * i.quantity) };
  });

  const total = items.reduce((s, i) => s + i.subtotal, 0);
  const poId = `po-${crypto.randomUUID().slice(0, 8)}`;
  const poNumber = nextPoNumber();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, order_date, total_cost, status, notes)
       VALUES (?, ?, ?, ?, ?, 'submitted', ?)`
    ).run(poId, poNumber, input.supplierId, todayISO(), total, input.notes ?? null);

    const ins = db.prepare(
      `INSERT INTO purchase_order_items (id, po_id, raw_material_id, quantity, unit, unit_cost, subtotal)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    items.forEach((i, idx) => ins.run(`poi-${poId}-${idx + 1}`, poId, i.id, i.quantity, i.unit, i.unit_cost, i.subtotal));
  })();

  return { id: poId, poNumber, totalCost: total, itemCount: items.length };
}

/**
 * Penerimaan barang (GRN): menambah stok, memperbarui harga rata-rata (moving average),
 * dan mencatat jurnal Persediaan (debit) vs Kas (kredit).
 */
export function receivePurchaseOrder(poId: string, userId: string | null) {
  const db = getDb();
  const po = db
    .prepare(`SELECT id, po_number, total_cost, status FROM purchase_orders WHERE id = ?`)
    .get(poId) as { id: string; po_number: string; total_cost: number; status: string } | undefined;
  if (!po) throw new ApiError(404, 'Purchase order tidak ditemukan.');
  if (po.status === 'received') throw new ApiError(409, 'Barang sudah pernah diterima.');

  const items = db
    .prepare(
      `SELECT i.raw_material_id, i.quantity, i.subtotal, m.unit_cost
       FROM purchase_order_items i JOIN raw_materials m ON m.id = i.raw_material_id
       WHERE i.po_id = ?`
    )
    .all(poId) as { raw_material_id: string; quantity: number; subtotal: number; unit_cost: number }[];

  const now = nowISO();
  db.transaction(() => {
    const getQty = db.prepare('SELECT quantity FROM stock_items WHERE raw_material_id = ?');

    items.forEach((i) => {
      const cur = (getQty.get(i.raw_material_id) as { quantity: number } | undefined)?.quantity ?? 0;
      const newQty = cur + i.quantity;
      const avgCost = newQty > 0 ? Math.round((cur * i.unit_cost + i.subtotal) / newQty) : i.unit_cost;

      db.prepare(
        'UPDATE stock_items SET quantity = ROUND(?, 3), last_updated = ? WHERE raw_material_id = ?'
      ).run(newQty, now, i.raw_material_id);
      db.prepare(
        'UPDATE raw_materials SET unit_cost = ?, updated_at = ? WHERE id = ?'
      ).run(avgCost, now, i.raw_material_id);

      db.prepare(
        `INSERT INTO stock_movements (id, raw_material_id, type, qty_change, ref_id, notes, created_at)
         VALUES (?, ?, 'purchase', ?, ?, 'Penerimaan barang GRN', ?)`
      ).run(`mov-${crypto.randomUUID().slice(0, 8)}`, i.raw_material_id, i.quantity, po.po_number, now);
    });

    db.prepare(
      `UPDATE purchase_orders SET status = 'received', received_date = ?, received_by = ? WHERE id = ?`
    ).run(todayISO(), userId, poId);

    db.prepare(
      `INSERT INTO grn (id, grn_number, po_id, received_date, received_by, total_cost, status)
       VALUES (?, ?, ?, ?, ?, ?, 'received')`
    ).run(`grn-${crypto.randomUUID().slice(0, 8)}`, `GRN-${po.po_number.slice(3)}`, poId, todayISO(), userId, po.total_cost);

    publish('inventory', { action: 'grn_received', poNumber: po.po_number, totalCost: po.total_cost });

    const ins = db.prepare(
      `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    ins.run(`led-${crypto.randomUUID().slice(0, 10)}`, todayISO(),
      `Pembelian bahan baku ${po.po_number}`, '1-200', ledgerCategory('1-200'), po.total_cost, 0, po.po_number, now);
    ins.run(`led-${crypto.randomUUID().slice(0, 10)}`, todayISO(),
      `Pembelian bahan baku ${po.po_number}`, '1-100', ledgerCategory('1-100'), 0, po.total_cost, po.po_number, now);
  })();

  return { poId, poNumber: po.po_number, totalCost: po.total_cost, receivedItems: items.length };
}

export function adjustStock(input: z.infer<typeof adjustSchema>, userId: string | null) {
  const db = getDb();
  const mat = db
    .prepare('SELECT id, name, unit, unit_cost, min_stock AS minStock FROM raw_materials WHERE id = ?')
    .get(input.rawMaterialId) as
    | { id: string; name: string; unit: string; unit_cost: number; minStock: number }
    | undefined;
  if (!mat) throw new ApiError(404, 'Bahan baku tidak ditemukan.');

  const before = (db.prepare('SELECT quantity FROM stock_items WHERE raw_material_id = ?').get(mat.id) as
    | { quantity: number }
    | undefined)?.quantity ?? 0;
  const after = Number((before + input.delta).toFixed(3));
  if (after < 0) throw new ApiError(422, `Stok ${mat.name} tidak cukup untuk pengurangan ${Math.abs(input.delta)} ${mat.unit}.`);

  const now = nowISO();
  const amount = Math.abs(Math.round(input.delta * mat.unit_cost));

  db.transaction(() => {
    db.prepare(
      'UPDATE stock_items SET quantity = ?, last_updated = ? WHERE raw_material_id = ?'
    ).run(after, now, mat.id);

    db.prepare(
      `INSERT INTO stock_adjustments (id, raw_material_id, type, qty_before, qty_after, reason, adjusted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `adj-${crypto.randomUUID().slice(0, 8)}`, mat.id,
      input.delta > 0 ? 'increase' : 'decrease', before, after, input.reason, userId, now
    );

    db.prepare(
      `INSERT INTO stock_movements (id, raw_material_id, type, qty_change, ref_id, notes, created_at)
       VALUES (?, ?, 'adjustment', ?, ?, ?, ?)`
    ).run(`mov-${crypto.randomUUID().slice(0, 8)}`, mat.id, input.delta, 'ADJ', input.reason, now);

    // Penyesuaian stok harus tetap menjaga keseimbangan debit = kredit:
    //   stok bertambah  -> Dr Persediaan / Cr Kas (koreksi pembelian)
    //   stok berkurang  -> Dr Beban Operasional / Cr Persediaan (susut/roboh)
    const drCode = input.delta > 0 ? '1-200' : '6-100';
    const crCode = input.delta > 0 ? '1-100' : '1-200';

    db.prepare(
      `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'ADJ', ?)`
    ).run(
      `led-${crypto.randomUUID().slice(0, 10)}`, todayISO(),
      `Penyesuaian stok ${mat.name} — ${input.reason}`, drCode, ledgerCategory(drCode), amount, now
    );

    db.prepare(
      `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'ADJ', ?)`
    ).run(
      `led-${crypto.randomUUID().slice(0, 10)}`, todayISO(),
      `Penyesuaian stok ${mat.name} — ${input.reason}`, crCode, ledgerCategory(crCode), amount, now
    );

    // Kirim alert bila stok menyentuh / turun di bawah minimum
    if (after <= mat.minStock) {
      notifyLowStock({ name: mat.name, currentStock: after, minStock: mat.minStock, unit: mat.unit });
    }
  })();

  publish('inventory', {
    action: 'adjusted',
    rawMaterialId: mat.id,
    name: mat.name,
    before,
    after,
    unit: mat.unit,
  });

  return { rawMaterialId: mat.id, name: mat.name, before, after, unit: mat.unit };
}