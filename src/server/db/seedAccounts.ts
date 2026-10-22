import type Database from 'better-sqlite3';

export interface SeededSale {
  orderNo: string;
  subtotal: number;
  serviceCharge: number;
  tax: number;
  total: number;
  cogs: number;
}

const CATEGORY: Record<string, string> = {
  '1-100': 'Kas/Bank',
  '1-200': 'Persediaan',
  '2-100': 'Kewajiban PPN',
  '2-200': 'Deposit Pelanggan',
  '3-100': 'Modal',
  '4-100': 'Pendapatan',
  '5-100': 'HPP (Bahan Baku)',
  '6-100': 'Beban Operasional',
};

const OPENING_CAPITAL = 25_000_000;
const OPERATING_EXPENSE = 1_250_000;

/**
 * Jurnal pembuka.
 *
 * Penting: nilai "pembelian bahan baku awal" TIDAK di-hardcode, melainkan
 * diambil dari nilai fisik stok seed. Bila angka ini tidak sama dengan nilai
 * persediaan fisik, Neraca Saldo tidak akan seimbang —(assert `balanced` pada
 * report.service akan menangkapnya).
 */
export function hashSeedLedger(
  db: Database.Database,
  now: string,
  openingInventory: number,
  sales: SeededSale[]
) {
  const ins = db.prepare(
    `INSERT INTO ledger_entries (id, entry_date, description, account_code, category, debit, credit, reference_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const date = now.slice(0, 10);
  let seq = 0;
  const add = (desc: string, code: string, debit: number, credit: number, ref: string | null = null) => {
    seq += 1;
    ins.run(`led-seed-${seq}`, date, desc, code, CATEGORY[code], debit, credit, ref, `${now}#${seq}`);
  };

  /* 1. Setoran modal pemilik */
  add('Setoran Modal Awal Owner', '3-100', 0, OPENING_CAPITAL);
  add('Setoran Modal Awal Owner', '1-100', OPENING_CAPITAL, 0);

  /* 2. Pembelian bahan baku awal (nilai = nilai stok fisik seed) */
  add('Pembelian Stok Bahan Baku Awal', '1-100', 0, openingInventory, 'PO-0000');
  add('Pembelian Stok Bahan Baku Awal', '1-200', openingInventory, 0, 'PO-0000');

  /* 3. Beban operasional periode berjalan */
  add('Biaya Listrik, Air & Gas Dapur', '6-100', OPERATING_EXPENSE, 0);
  add('Biaya Listrik, Air & Gas Dapur', '1-100', 0, OPERATING_EXPENSE);

  /* 4. Transaksi penjualan yang sudah lunas */
  sales
    .filter((s) => s.total > 0 && s.cogs > 0)
    .forEach((s) => {
      add(`Penerimaan kas penjualan ${s.orderNo}`, '1-100', s.total, 0, s.orderNo);
      add(`Pendapatan penjualan ${s.orderNo}`, '4-100', 0, s.subtotal, s.orderNo);
      add(`Service charge ${s.orderNo}`, '4-100', 0, s.serviceCharge, s.orderNo);
      add(`PPN terutang ${s.orderNo}`, '2-100', 0, s.tax, s.orderNo);
      add(`HPP penjualan ${s.orderNo}`, '5-100', s.cogs, 0, s.orderNo);
      add(`Pengurangan persediaan ${s.orderNo}`, '1-200', 0, s.cogs, s.orderNo);
    });

  /* 5. Deposit reservasi (kas masuk, liabilitas bertambah) */
  const deposits: [string, number][] = [
    ['BKG-2026-001', 100_000],
    ['BKG-2026-002', 300_000],
  ];
  deposits.forEach(([code, amount]) => {
    add(`Deposit reservasi ${code}`, '1-100', amount, 0, code);
    add(`Deposit reservasi ${code}`, '2-200', 0, amount, code);
  });
}