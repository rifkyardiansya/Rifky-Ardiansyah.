import { getDb } from '../db/client';

export interface FinancialSnapshot {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpense: number;
  netIncome: number;
  taxPayable: number;
  serviceRevenue: number;
  depositReceived: number;
  depositRefunded: number;
  depositLiability: number;
  cashBalance: number;
  inventoryValue: number;
  capital: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  balanced: boolean;
}

function sumBy(db: ReturnType<typeof getDb>, code: string, key: 'debit' | 'credit') {
  const row = db
    .prepare(`SELECT COALESCE(SUM(${key}), 0) AS total FROM ledger_entries WHERE account_code = ?`)
    .get(code) as { total: number };
  return row.total;
}

/**
 * Seluruh laporan keuangan dihitung dari tabel ledger_entries (double-entry),
 * bukan dari rekap transaksi — ini memastikan setiap laporan saling konsisten
 * dan dapat diaudit (prinsip: satu sumber kebenaran = jurnal).
 */
export function buildSnapshot(): FinancialSnapshot {
  const db = getDb();

  const revenue = sumBy(db, '4-100', 'credit');
  const cogs = sumBy(db, '5-100', 'debit');
  const operatingExpense = sumBy(db, '6-100', 'debit');
  const capital = sumBy(db, '3-100', 'credit');
  const taxPayable = sumBy(db, '2-100', 'credit');
  const depositCredit = sumBy(db, '2-200', 'credit');
  const depositDebit = sumBy(db, '2-200', 'debit');
  const cashDebit = sumBy(db, '1-100', 'debit');
  const cashCredit = sumBy(db, '1-100', 'credit');

  const inventoryValue = (
    db
      .prepare(
        `SELECT COALESCE(SUM(s.quantity * m.unit_cost), 0) AS total
         FROM stock_items s JOIN raw_materials m ON m.id = s.raw_material_id`
      )
      .get() as { total: number }
  ).total;

  const grossProfit = revenue - cogs;
  const netIncome = grossProfit - operatingExpense;
  const cashBalance = cashDebit - cashCredit;
  const depositLiability = Math.max(0, depositCredit - depositDebit);

  const totalAssets = cashBalance + inventoryValue;
  const totalLiabilities = taxPayable + depositLiability;
  const equity = capital + netIncome;

  return {
    revenue,
    cogs,
    grossProfit,
    grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    operatingExpense,
    netIncome,
    taxPayable,
    serviceRevenue: 0,
    depositReceived: depositDebit,
    depositRefunded: depositCredit,
    depositLiability,
    cashBalance,
    inventoryValue,
    capital,
    totalAssets,
    totalLiabilities,
    equity,
    balanced: Math.abs(totalAssets - (totalLiabilities + equity)) < 1,
  };
}

export function profitAndLoss() {
  const s = buildSnapshot();
  return {
    revenue: s.revenue,
    cogs: s.cogs,
    grossProfit: s.grossProfit,
    grossMargin: s.grossMargin,
    operatingExpense: s.operatingExpense,
    netIncome: s.netIncome,
    // PPN adalah kewajiban, bukan beban -> tidak memengaruhi laba bersih
    taxPayable: s.taxPayable,
    rows: [
      { label: 'Pendapatan Penjualan', amount: s.revenue, level: 'detail' },
      { label: 'Laba Kotor', amount: s.grossProfit, level: 'subtotal' },
      { label: 'Harga Pokok Penjualan (HPP)', amount: s.cogs, level: 'detail' },
      { label: 'Beban Operasional', amount: s.operatingExpense, level: 'detail' },
      { label: 'Laba.before pajak', amount: s.netIncome, level: 'subtotal' },
      { label: 'PPN 10% (kewajiban, bukan beban)', amount: 0, level: 'detail' },
      { label: 'Laba Bersih', amount: s.netIncome, level: 'total' },
    ],
  };
}

export function balanceSheet() {
  const s = buildSnapshot();
  return {
    asOf: new Date().toISOString().slice(0, 10),
    assets: [
      { label: 'Kas & Bank', amount: s.cashBalance },
      { label: 'Persediaan Bahan Baku', amount: s.inventoryValue },
      { label: 'Total Aset', amount: s.totalAssets, isTotal: true },
    ],
    liabilities: [
      { label: 'Utang PPN', amount: s.taxPayable },
      { label: 'Liabilitas Deposit Reservasi', amount: s.depositLiability },
      { label: 'Total Kewajiban', amount: s.totalLiabilities, isTotal: true },
    ],
    equity: [
      { label: 'Modal / Ekuitas', amount: s.capital },
      { label: 'Laba Ditahan', amount: s.netIncome },
      { label: 'Total Ekuitas', amount: s.equity, isTotal: true },
    ],
    balanced: s.balanced,
  };
}

export function cashFlow() {
  const s = buildSnapshot();
  const operating = s.revenue + s.depositReceived - s.depositRefunded - s.operatingExpense;
  return {
    operating: {
      inflow: s.revenue + s.depositReceived,
      outflow: s.operatingExpense + s.depositRefunded,
      net: operating,
    },
    investing: { inflow: 0, outflow: 0, net: 0 },
    financing: { inflow: s.capital, outflow: 0, net: s.capital },
    netChange: operating + s.capital,
    cashBalance: s.cashBalance,
  };
}

export function salesReport() {
  const db = getDb();

  const byDay = db
    .prepare(
      `SELECT DATE(COALESCE(paid_at, created_at)) AS day,
              COUNT(*) AS orders, SUM(total) AS revenue
       FROM orders
       WHERE payment_status = 'paid' AND status <> 'cancelled'
       GROUP BY day ORDER BY day DESC LIMIT 14`
    )
    .all() as { day: string; orders: number; revenue: number }[];

  const byProduct = db
    .prepare(
      `SELECT i.name, SUM(i.quantity) AS qty, SUM(i.subtotal) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.payment_status = 'paid' AND o.status <> 'cancelled'
       GROUP BY i.name ORDER BY qty DESC`
    )
    .all() as { name: string; qty: number; revenue: number }[];

  const byMethod = db
    .prepare(
      `SELECT COALESCE(payment_method, '-') AS method, COUNT(*) AS orders, SUM(total) AS revenue
       FROM orders WHERE payment_status = 'paid' GROUP BY payment_method`
    )
    .all() as { method: string; orders: number; revenue: number }[];

  const byCashier = db
    .prepare(
      `SELECT CASE WHEN source = 'pos_cashier' THEN 'Kasir (POS)' ELSE 'Customer QR' END AS channel,
              COUNT(*) AS orders, SUM(total) AS revenue
       FROM orders WHERE payment_status = 'paid' GROUP BY channel`
    )
    .all() as { channel: string; orders: number; revenue: number }[];

  const byTable = db
    .prepare(
      `SELECT table_number, COUNT(*) AS orders, SUM(total) AS revenue
       FROM orders WHERE payment_status = 'paid' GROUP BY table_number ORDER BY revenue DESC`
    )
    .all() as { table_number: string; orders: number; revenue: number }[];

  return { byDay, byProduct, byMethod, byCashier, byTable };
}

export function taxReport() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT STRFTIME('%Y-%m', COALESCE(paid_at, created_at)) AS period,
              SUM(total) AS base_inclusive, SUM(tax) AS tax_amount, COUNT(*) AS invoices
       FROM orders
       WHERE payment_status = 'paid' AND status <> 'cancelled'
       GROUP BY period ORDER BY period DESC`
    )
    .all() as { period: string; base_inclusive: number; tax_amount: number; invoices: number }[];

  return rows.map((r) => ({
    ...r,
    dpp: Math.round(r.base_inclusive - r.tax_amount),
  }));
}

export function generalLedger(limit = 200) {
  const db = getDb();
  const entries = db
    .prepare(
      `SELECT l.id, l.entry_date, l.description, l.account_code, a.name AS account_name,
              l.category, l.debit, l.credit, l.reference_id, l.created_at
       FROM ledger_entries l JOIN accounts a ON a.code = l.account_code
       ORDER BY l.created_at DESC, l.entry_date DESC LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[];

  const totals = db
    .prepare('SELECT COALESCE(SUM(debit),0) AS debit, COALESCE(SUM(credit),0) AS credit FROM ledger_entries')
    .get() as { debit: number; credit: number };

  return { entries, totals, balanced: Math.abs(totals.debit - totals.credit) < 1 };
}

export function inventoryValuation(method: 'fifo' | 'lifo' | 'average' = 'average') {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.id, m.name, m.sku, m.unit, s.quantity, m.unit_cost,
              ROUND(s.quantity * m.unit_cost) AS value
       FROM raw_materials m JOIN stock_items s ON s.raw_material_id = m.id
       ORDER BY value DESC`
    )
    .all() as { id: string; name: string; sku: string; unit: string; quantity: number; unit_cost: number; value: number }[];

  const total = rows.reduce((s, r) => s + r.value, 0);
  return { method, rows, total, averageUnitCost: rows.length ? Math.round(total / rows.reduce((s, r) => s + r.quantity, 0)) : 0 };
}

export function trialBalance() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.code, a.name, a.type, a.normal_balance,
              COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
       FROM accounts a LEFT JOIN ledger_entries l ON l.account_code = a.code
       GROUP BY a.code ORDER BY a.code`
    )
    .all() as { code: string; name: string; type: string; normal_balance: string; debit: number; credit: number }[];

  const withBalance = rows.map((r) => ({
    ...r,
    balance: r.normal_balance === 'debit' ? r.debit - r.credit : r.credit - r.debit,
  }));

  return {
    rows: withBalance,
    totalDebit: withBalance.reduce((s, r) => s + r.debit, 0),
    totalCredit: withBalance.reduce((s, r) => s + r.credit, 0),
  };
}