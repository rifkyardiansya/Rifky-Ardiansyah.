import type { LedgerEntry, Order, RawMaterial } from '../types';

export interface PnLRow {
  label: string;
  amount: number;
  indent?: boolean;
  isTotal?: boolean;
  isSection?: boolean;
}

export function sumLedger(entries: LedgerEntry[], category: LedgerEntry['category'], key: 'debit' | 'credit') {
  return entries.reduce((sum, e) => (e.category === category ? sum + e[key] : sum), 0);
}

export interface FinancialSnapshot {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpense: number;
  netIncome: number;
  taxPayable: number;
  serviceCharge: number;
  depositReceived: number;
  cashBalance: number;
  inventoryValue: number;
  depositLiability: number;
  capital: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
}

export function buildSnapshot(ledger: LedgerEntry[], materials: RawMaterial[]): FinancialSnapshot {
  const revenueFood = sumLedger(ledger, 'Pendapatan', 'credit');
  const serviceCharge = sumLedger(ledger, 'Pendapatan', 'credit'); // digabung di atas
  const cogs = sumLedger(ledger, 'HPP (Bahan Baku)', 'debit');
  const operatingExpense = sumLedger(ledger, 'Beban Operasional', 'debit');
  const voidLoss = sumLedger(ledger, 'Beban Operasional', 'debit');
  const taxPayable = sumLedger(ledger, 'Kewajiban PPN', 'credit');
  const depositCredit = sumLedger(ledger, 'Deposit Pelanggan', 'credit');
  const depositDebit = sumLedger(ledger, 'Deposit Pelanggan', 'debit');
  const depositLiability = Math.max(0, depositDebit - depositCredit);
  const cashBalance = sumLedger(ledger, 'Kas/Bank', 'debit') - sumLedger(ledger, 'Kas/Bank', 'credit');
  const capital = sumLedger(ledger, 'Modal', 'debit');
  const inventoryValue = materials.reduce((sum, m) => sum + m.currentStock * m.unitCost, 0);

  const revenue = revenueFood;
  const grossProfit = revenue - cogs;
  const netIncome = grossProfit - (operatingExpense + voidLoss);

  const totalAssets = cashBalance + inventoryValue + depositLiability;
  const totalLiabilities = taxPayable + depositLiability;
  const equity = totalAssets - totalLiabilities;

  return {
    revenue,
    cogs,
    grossProfit,
    grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    operatingExpense: operatingExpense + voidLoss,
    netIncome,
    taxPayable,
    serviceCharge,
    depositReceived: depositDebit,
    cashBalance,
    inventoryValue,
    depositLiability,
    capital,
    totalAssets,
    totalLiabilities,
    equity,
  };
}

export function buildPnL(ledger: LedgerEntry[]): PnLRow[] {
  const snapshot = buildSnapshot(ledger, []);
  return [
    { label: 'PENDAPATAN', amount: 0, isSection: true },
    { label: 'Penjualan Makanan & Minuman', amount: snapshot.revenue, indent: true },
    { label: 'Laba Kotor (Gross Profit)', amount: snapshot.grossProfit, isTotal: true },
    { label: 'BEBAN', amount: 0, isSection: true },
    { label: 'Harga Pokok Penjualan (HPP)', amount: snapshot.cogs, indent: true },
    { label: 'Beban Operasional', amount: snapshot.operatingExpense, indent: true },
    { label: 'LABA BERSIH (Net Income)', amount: snapshot.netIncome, isTotal: true },
  ];
}

export function revenueByDay(orders: Order[]) {
  const map = new Map<string, { revenue: number; orders: number }>();
  orders
    .filter((o) => o.paymentStatus === 'paid' && o.status !== 'cancelled')
    .forEach((o) => {
      const key = o.paidAt || o.createdAt;
      const day = new Date(key).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      const current = map.get(day) || { revenue: 0, orders: 0 };
      current.revenue += o.total;
      current.orders += 1;
      map.set(day, current);
    });
  return Array.from(map.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-7);
}

export function revenueByPaymentMethod(orders: Order[]) {
  const map = new Map<string, number>();
  orders
    .filter((o) => o.paymentStatus === 'paid')
    .forEach((o) => {
      const key = o.paymentMethod || 'lainnya';
      map.set(key, (map.get(key) || 0) + o.total);
    });
  return Array.from(map.entries()).map(([method, value]) => ({ method, value }));
}

export function topProducts(orders: Order[], limit = 5) {
  const map = new Map<string, { name: string; qty: number; revenue: number }>();
  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) =>
      o.items.forEach((i) => {
        const current = map.get(i.menuItemId) || { name: i.name, qty: 0, revenue: 0 };
        current.qty += i.quantity;
        current.revenue += i.subtotal;
        map.set(i.menuItemId, current);
      })
    );
  return Array.from(map.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);
}

export function salesByCashier(orders: Order[]) {
  const map = new Map<string, { orders: number; revenue: number }>();
  orders
    .filter((o) => o.paymentStatus === 'paid')
    .forEach((o) => {
      const key = o.source === 'pos_cashier' ? 'Kasir (POS)' : 'Customer QR';
      const current = map.get(key) || { orders: 0, revenue: 0 };
      current.orders += 1;
      current.revenue += o.total;
      map.set(key, current);
    });
  return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
}

export const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  debit: 'Kartu Debit',
  credit: 'Kartu Kredit',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu Dapur',
  cooking: 'Sedang Dimasak',
  ready: 'Siap Disajikan',
  served: 'Sudah Disajikan',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
};