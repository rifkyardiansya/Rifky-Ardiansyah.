import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb, nowISO } from '../db/client';
import { calcTotals } from '../../lib/utils';
import { ApiError } from '../http/api';
import { notifyOrderReceived, sendNotification } from './notification.service';
import { publish } from '../realtime/bus';

export const orderItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(200).optional(),
});

export const placeOrderSchema = z.object({
  tableNumber: z.string().min(1).max(40),
  customerName: z.string().min(1).max(80),
  customerPhone: z.string().max(30).optional(),
  source: z.enum(['customer_qr', 'pos_cashier']),
  items: z.array(orderItemSchema).min(1, 'Keranjang tidak boleh kosong'),
  paymentMethod: z.enum(['cash', 'qris', 'debit', 'credit']).optional(),
  cashReceived: z.number().int().min(0).optional(),
  discount: z.number().int().min(0).optional(),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

interface MenuRow {
  id: string;
  name: string;
  price: number;
  cost_price: number;
  is_active: number;
}

/**
 * Application Service: pembuatan order.
 * Dalam satu transaksi SQL atomik:
 *   1. validasi menu & ketersediaan,
 *   2. menghitung subtotal/service charge/PPN,
 *   3. menyimpan order + order_items,
 *   4. mengurangistok bahan baku (BOM),
 *   5. mencatat jurnal double-entry bila sudah dibayar,
 *   6. memperbarui status meja.
 */
export function placeOrder(input: PlaceOrderInput, cashierId: string | null) {
  const db = getDb();

  const menuStmt = db.prepare(
    'SELECT id, name, price, cost_price, is_active FROM menu_items WHERE id = ?'
  );
  const lines = input.items.map((item) => {
    const menu = menuStmt.get(item.menuItemId) as MenuRow | undefined;
    if (!menu) throw new ApiError(404, `Menu ${item.menuItemId} tidak ditemukan.`);
    if (!menu.is_active) throw new ApiError(409, `Menu "${menu.name}" sedang tidak tersedia.`);
    return { menu, qty: item.quantity, notes: item.notes };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.menu.price * l.qty, 0);
  const totals = calcTotals(subtotal, input.discount ?? 0);
  const paid = Boolean(input.paymentMethod);
  const now = nowISO();
  const orderNo = nextOrderNo();
  const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;

  const change =
    input.paymentMethod === 'cash' && input.cashReceived
      ? input.cashReceived - totals.total
      : null;

  if (input.paymentMethod === 'cash' && input.cashReceived && change !== null && change < 0) {
    throw new ApiError(422, 'Uang yang dibayar kurang dari total tagihan.');
  }

  let cogs = 0;

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, order_no, table_number, customer_name, customer_phone, source,
        subtotal, discount, service_charge, tax, total, status, payment_status, payment_method,
        cash_received, change_amount, cashier_id, created_at, paid_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId, orderNo, input.tableNumber, input.customerName, input.customerPhone ?? null,
      input.source, totals.subtotal, totals.discount, totals.serviceCharge, totals.tax, totals.total,
      paid ? 'paid' : 'unpaid', input.paymentMethod ?? null, input.cashReceived ?? null, change,
      cashierId, now, paid ? now : null, now
    );

    const insItem = db.prepare(
      'INSERT INTO order_items (id, order_id, menu_item_id, name, price, quantity, notes, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    lines.forEach((l, i) => {
      insItem.run(`oi-${orderId}-${i + 1}`, orderId, l.menu.id, l.menu.name, l.menu.price, l.qty, l.notes ?? null, l.menu.price * l.qty);
    });

    if (paid) {
      // Pengurangan stok bahan baku (bill of materials).
      //
      // PENTING: stok hanya dipotong ketika order lunas, bersamaan dengan
      // pencatatan HPP. Jika stok dipotong untuk order yang belum dibayar,
      // nilai persediaan fisik akan menyimpang dari nilai buku di jurnal —
      // sehingga Neraca Saldo tidak akan seimbang.
      cogs = deductStockForOrder(orderId, lines.map((l) => ({ menuItemId: l.menu.id, qty: l.qty })));

      writeOrderJournal({ orderNo, total: totals.total, subtotal: totals.subtotal, serviceCharge: totals.serviceCharge, tax: totals.tax, cogs });
      recordPayment(orderId, input.paymentMethod!, totals.total, 'success');
      updateOpenSession(totals.total);
    }

    if (input.tableNumber.startsWith('Meja')) {
      db.prepare(
        `UPDATE restaurant_tables SET status = 'occupied', current_order_id = ? WHERE table_no = ?`
      ).run(orderNo, input.tableNumber);
    }
  });

  run();

  notifyOrderReceived({
    orderNo,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    tableNumber: input.tableNumber,
    total: totals.total,
    source: input.source,
  });

  publish('order', { action: 'created', orderNo, orderId, tableNumber: input.tableNumber, status: 'pending' });

  return { id: orderId, orderNo, cogs, ...totals, change, paymentStatus: paid ? 'paid' : 'unpaid' };
}

type RecipeLine = { raw_material_id: string; amount_needed: number; unit_cost: number };

function deductStockForOrder(orderId: string, lines: { menuItemId: string; qty: number }[]): number {
  const db = getDb();
  const recipeStmt = db.prepare(
    `SELECT r.raw_material_id, r.amount_needed, m.unit_cost
     FROM menu_recipes r JOIN raw_materials m ON m.id = r.raw_material_id
     WHERE r.menu_item_id = ?`
  );
  const updStock = db.prepare(
    `UPDATE stock_items SET quantity = ROUND(quantity + ?, 3), last_updated = ?
     WHERE raw_material_id = ?`
  );
  const insMove = db.prepare(
    `INSERT INTO stock_movements (id, raw_material_id, type, qty_change, ref_id, notes, created_at)
     VALUES (?, ?, 'sale', ?, ?, ?, ?)`
  );

  let cogs = 0;
  lines.forEach((line) => {
    const recipes = recipeStmt.all(line.menuItemId) as RecipeLine[];
    recipes.forEach((r) => {
      const used = r.amount_needed * line.qty;
      cogs += used * r.unit_cost;
      updStock.run(-used, nowISO(), r.raw_material_id);
      insMove.run(
        `mov-${crypto.randomUUID().slice(0, 8)}`,
        r.raw_material_id,
        -used,
        orderId,
        'Penjualan menu',
        nowISO()
      );
    });
  });
  return Math.round(cogs);
}

function writeOrderJournal(input: {
  orderNo: string; total: number; subtotal: number; serviceCharge: number; tax: number; cogs: number;
}) {
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const date = nowISO().slice(0, 10);
  const ref = input.orderNo;
  let i = 0;
  const add = (desc: string, code: string, debit: number, credit: number) => {
    ins.run(
      `led-${crypto.randomUUID().slice(0, 10)}`,
      date,
      desc,
      code,
      ledgerCategory(code),
      debit,
      credit,
      ref,
      nowISO()
    );
    i += 1;
  };

  add(`Penerimaan kas penjualan ${ref}`, '1-100', input.total, 0);
  add(`Pendapatan penjualan ${ref}`, '4-100', 0, input.subtotal);
  add(`Pendapatan service charge ${ref}`, '4-100', 0, input.serviceCharge);
  add(`PPN terutang ${ref}`, '2-100', 0, input.tax);

  // Menu tanpa resep bahan baku menghasilkan HPP 0 — baris jurnal bernilai nol
  // tidak boleh disimpan (CHECK constraint), sehingga dilewati.
  if (input.cogs > 0) {
    add(`HPP penjualan ${ref}`, '5-100', input.cogs, 0);
    add(`Pengurangan persediaan ${ref}`, '1-200', 0, input.cogs);
  }
}

export function ledgerCategory(code: string): string {
  const map: Record<string, string> = {
    '1-100': 'Kas/Bank',
    '1-200': 'Persediaan',
    '2-100': 'Kewajiban PPN',
    '2-200': 'Deposit Pelanggan',
    '3-100': 'Modal',
    '4-100': 'Pendapatan',
    '5-100': 'HPP (Bahan Baku)',
    '6-100': 'Beban Operasional',
  };
  return map[code] ?? 'Lainnya';
}

function recordPayment(orderId: string, method: string, amount: number, status: string) {
  getDb()
    .prepare(
      'INSERT INTO payments (id, order_id, method, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(`pay-${crypto.randomUUID().slice(0, 10)}`, orderId, method, amount, status, nowISO());
}

function updateOpenSession(total: number) {
  getDb()
    .prepare(
      `UPDATE pos_sessions SET total_transactions = total_transactions + 1,
        total_revenue = total_revenue + ?, expected_cash = expected_cash + ?
       WHERE id = (SELECT id FROM pos_sessions WHERE closed_at IS NULL ORDER BY opened_at DESC LIMIT 1)`
    )
    .run(total, total);
}

export function nextOrderNo(): string {
  const row = getDb()
    .prepare(
      `SELECT order_no FROM orders WHERE order_no LIKE 'ORD-%' ORDER BY CAST(SUBSTR(order_no, 5) AS INTEGER) DESC LIMIT 1`
    )
    .get() as { order_no: string } | undefined;
  const next = row ? Number(row.order_no.slice(4)) + 1 : 1001;
  return `ORD-${next}`;
}

/** Pembayaran untuk order yang sebelumnya belum lunas (mis. bayar di kasir). */
export function payExistingOrder(orderId: string, method: string, cashReceived?: number) {
  const db = getDb();
  const order = db
    .prepare('SELECT order_no, total, subtotal, service_charge, tax FROM orders WHERE id = ?')
    .get(orderId) as
    | { order_no: string; total: number; subtotal: number; service_charge: number; tax: number }
    | undefined;
  if (!order) throw new ApiError(404, 'Order tidak ditemukan.');

  const change = method === 'cash' && cashReceived ? cashReceived - order.total : null;
  if (change !== null && change < 0) throw new ApiError(422, 'Uang pembayaran kurang dari total.');

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE orders SET payment_status = 'paid', payment_method = ?, cash_received = ?,
        change_amount = ?, paid_at = ?, updated_at = ? WHERE id = ?`
    ).run(method, cashReceived ?? null, change, nowISO(), nowISO(), orderId);

    const items = db
      .prepare('SELECT menu_item_id, quantity FROM order_items WHERE order_id = ?')
      .all(orderId) as { menu_item_id: string; quantity: number }[];
    const cogs = deductStockForOrder(
      orderId,
      items.map((i) => ({ menuItemId: i.menu_item_id, qty: i.quantity }))
    );

    writeOrderJournal({
      orderNo: order.order_no,
      total: order.total,
      subtotal: order.subtotal,
      serviceCharge: order.service_charge,
      tax: order.tax,
      cogs,
    });
    recordPayment(orderId, method, order.total, 'success');
    updateOpenSession(order.total);
  });

  run();
  return { orderId, change };
}

export function updateOrderStatus(orderId: string, status: string) {
  const db = getDb();
  const allowed = ['pending', 'cooking', 'ready', 'served', 'completed', 'cancelled'];
  if (!allowed.includes(status)) throw new ApiError(422, `Status "${status}" tidak valid.`);

  const order = db
    .prepare('SELECT order_no, table_number, table_id FROM orders WHERE id = ?')
    .get(orderId) as { order_no: string; table_number: string; table_id: string | null } | undefined;
  if (!order) throw new ApiError(404, 'Order tidak ditemukan.');

  db.transaction(() => {
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowISO(), orderId);

    if (order.table_id && (status === 'completed' || status === 'cancelled')) {
      db.prepare(
        `UPDATE restaurant_tables SET status = 'available', current_order_id = NULL
         WHERE id = ? AND current_order_id = ?`
      ).run(order.table_id, order.order_no);
    } else if (order.table_id) {
      db.prepare(
        `UPDATE restaurant_tables SET status = 'occupied', current_order_id = ? WHERE id = ?`
      ).run(order.order_no, order.table_id);
    }

    if (status === 'cancelled') {
      // Pembatalan: Dr Beban Operasional / Cr Kas (uang dikembalikan ke pelanggan)
      db.prepare(
        `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
         VALUES (?, ?, ?, '6-100', 'Beban Operasional', (SELECT total FROM orders WHERE id = ?), 0, ?, ?)`
      ).run(`led-${crypto.randomUUID().slice(0, 10)}`, nowISO().slice(0, 10),
        `Pembatalan transaksi ${order.order_no}`, orderId, order.order_no, nowISO());

      db.prepare(
        `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
         VALUES (?, ?, ?, '1-100', 'Kas/Bank', 0, (SELECT total FROM orders WHERE id = ?), ?, ?)`
      ).run(`led-${crypto.randomUUID().slice(0, 10)}`, nowISO().slice(0, 10),
        `Pengembalian transaksi ${order.order_no}`, orderId, order.order_no, nowISO());

      db.prepare(
        `UPDATE orders SET payment_status = 'refunded', void_reason = COALESCE(void_reason, 'Dibatalkan') WHERE id = ?`
      ).run(orderId);
    }
  })();

  if (status === 'ready') {
    const customer = db
      .prepare('SELECT customer_phone AS phone FROM orders WHERE id = ?')
      .get(orderId) as { phone: string | null } | undefined;
    if (customer?.phone) {
      sendNotification({
        code: 'order_ready',
        channel: 'sms',
        to: customer.phone,
        vars: { orderNo: order.order_no, tableNumber: order.table_number },
        refType: 'order',
        refId: order.order_no,
      });
    }
  }

  publish('order', {
    action: 'status',
    orderId,
    orderNo: order.order_no,
    status,
    tableNumber: order.table_number,
  });

  return { orderId, status };
}