import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Uji integrasi untuk logika domain: pemesanan -> potong stok (BOM) ->
 * jurnal double-entry seimbang -> laporan keuangan konsisten.
 *
 * Database memakai file sementara yang diisolasi per test-run.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const TEST_DB = path.join(DATA_DIR, 'test-restoran.db');

process.env.DATABASE_FILE = TEST_DB;

function resetDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(TEST_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'db', 'schema.sql'), 'utf-8'));
  db.close();
  resetDatabase();
}

function openDb() {
  const db = new Database(TEST_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(process.cwd(), 'src', 'server', 'db', 'schema.sql'), 'utf-8'));
  return db;
}

/* Impor modul server SETELAH env DATABASE_FILE diset di atas. */
const { resetDatabase } = await import('../src/server/db/seed');
const { getDb } = await import('../src/server/db/client');
const { calcTotals } = await import('../src/lib/utils');
const orderService = await import('../src/server/services/order.service');
const reportService = await import('../src/server/services/report.service');
const bookingService = await import('../src/server/services/booking.service');
const inventoryService = await import('../src/server/services/inventory.service');

describe('Persiapan database', () => {
  beforeEach(resetDb);

  it('seed mengisi master data & jurnal pembuka seimbang', () => {
    const db = getDb();

    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    const menu = db.prepare('SELECT COUNT(*) AS c FROM menu_items').get() as { c: number };
    const tables = db.prepare('SELECT COUNT(*) AS c FROM restaurant_tables').get() as { c: number };
    const totals = db.prepare('SELECT SUM(debit) AS d, SUM(credit) AS k FROM ledger_entries').get() as {
      d: number;
      k: number;
    };

    expect(users.c).toBeGreaterThanOrEqual(5);
    expect(menu.c).toBe(8);
    expect(tables.c).toBe(10);
    expect(totals.d).toBe(totals.k);
  });
});

describe('Perhitungan total pesanan', () => {
  beforeEach(resetDb);

  it('menghitung subtotal, service charge 5%, dan PPN 10% dengan benar', () => {
    const totals = calcTotals(100000);
    expect(totals.subtotal).toBe(100000);
    expect(totals.serviceCharge).toBe(5000);
    expect(totals.tax).toBe(10500);
    expect(totals.total).toBe(115500);
  });

  it('menolak pembayaran tunai yang kurang dari tagihan', () => {
    expect(() =>
      orderService.placeOrder(
        {
          tableNumber: 'Meja 03',
          customerName: 'Uji Coba',
          source: 'pos_cashier',
          items: [{ menuItemId: 'menu-3', quantity: 1 }],
          paymentMethod: 'cash',
          cashReceived: 1000,
        },
        'u-kasir1'
      )
    ).toThrowError();
  });

  it('menolak pesanan dengan menu nonaktif', () => {
    getDb().prepare('UPDATE menu_items SET is_active = 0 WHERE id = ?').run('menu-1');

    expect(() =>
      orderService.placeOrder(
        {
          tableNumber: 'Takeaway',
          customerName: 'Uji Coba',
          source: 'customer_qr',
          items: [{ menuItemId: 'menu-1', quantity: 1 }],
        },
        null
      )
    ).toThrowError(/tidak tersedia/i);
  });
});

describe('Integrasi POS -> Stok -> Akuntansi', () => {
  beforeEach(resetDb);

  it('potong stok bahan sesuai resep BOM saat transaksi lunas', () => {
    const db = getDb();

    const before = db.prepare('SELECT quantity FROM stock_items WHERE raw_material_id = ?').get('raw-2') as {
      quantity: number;
    };

    // Nasi Goreng (menu-1) memakai 0.1 kg Daging Ayam (raw-2)
    const result = orderService.placeOrder(
      {
        tableNumber: 'Meja 03',
        customerName: 'Budi Test',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-1', quantity: 2 }],
        paymentMethod: 'qris',
      },
      'u-kasir1'
    );

    const after = db.prepare('SELECT quantity FROM stock_items WHERE raw_material_id = ?').get('raw-2') as {
      quantity: number;
    };

    expect(Number((before.quantity - after.quantity).toFixed(3))).toBeCloseTo(0.2, 3);
    // HPP: 0.2kg*Daging(42000) + 0.2kg*Beras(15000) + 0.2kg*Telur(28000) + 0.1L*Minyak(17000)
    expect(result.cogs).toBeGreaterThan(0);
  });

  it('mencatat jurnal double-entry seimbang untuk setiap transaksi', () => {
    const db = getDb();

    orderService.placeOrder(
      {
        tableNumber: 'Meja 04',
        customerName: 'Siti Test',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-2', quantity: 2 }],
        paymentMethod: 'cash',
        cashReceived: 100000,
      },
      'u-kasir1'
    );

    const totals = db.prepare('SELECT SUM(debit) AS d, SUM(credit) AS k FROM ledger_entries').get() as {
      d: number;
      k: number;
    };
    expect(totals.d).toBe(totals.k);
  });

  it('P&L, Neraca, dan Arus Kas konsisten setelah transaksi', () => {
    orderService.placeOrder(
      {
        tableNumber: 'Meja 05',
        customerName: 'Andi Test',
        source: 'customer_qr',
        items: [
          { menuItemId: 'menu-1', quantity: 1 },
          { menuItemId: 'menu-5', quantity: 2 },
        ],
        paymentMethod: 'qris',
      },
      null
    );

    const snapshot = reportService.buildSnapshot();
    expect(snapshot.revenue).toBeGreaterThan(0);
    expect(snapshot.cogs).toBeGreaterThan(0);
    expect(snapshot.grossProfit).toBe(snapshot.revenue - snapshot.cogs);

    const bs = reportService.balanceSheet();
    expect(bs.balanced).toBe(true);
    expect(bs.assets[bs.assets.length - 1].amount).toBeCloseTo(
      bs.liabilities[bs.liabilities.length - 1].amount + bs.equity[bs.equity.length - 1].amount,
      0
    );
  });

  it('transaksi tanpa pembayaran tidak menambah pendapatan', () => {
    const db = getDb();
    const before = reportService.buildSnapshot().revenue;

    const result = orderService.placeOrder(
      {
        tableNumber: 'Meja 03',
        customerName: 'Bayar Nanti',
        source: 'customer_qr',
        items: [{ menuItemId: 'menu-6', quantity: 2 }],
      },
      null
    );

    expect(result.paymentStatus).toBe('unpaid');
    expect(reportService.buildSnapshot().revenue).toBe(before);
  });
});

describe('Modul Reservasi', () => {
  beforeEach(resetDb);

  it('menolak booking pada meja & jam yang sudah terpakai', () => {
    const db = getDb();
    const clash = db
      .prepare('SELECT booking_date, time_slot, table_id FROM bookings WHERE id = ?')
      .get('bkg-1') as { booking_date: string; time_slot: string; table_id: string };

    expect(() =>
      bookingService.createBooking({
        guestName: 'Tamu Bentrok',
        guestPhone: '089999999999',
        partySize: 4,
        date: clash.booking_date,
        timeSlot: clash.time_slot,
        tableId: clash.table_id,
        packagePrice: 300000,
      })
    ).toThrowError(/sudah dibooking/i);
  });

  it('menolak booking bila kapasitas meja tidak cukup', () => {
    expect(() =>
      bookingService.createBooking({
        guestName: 'Rombongan Besar',
        guestPhone: '089999999999',
        partySize: 30,
        date: '2026-12-25',
        timeSlot: '19:00 - 21:00',
        tableId: 'tbl-1',
        packagePrice: 0,
      })
    ).toThrowError(/Kapasitas/i);
  });

  it('deposit dihitung 25% dari nilai paket dan tercatat sebagai liabilitas', () => {
    const db = getDb();

    const booking = bookingService.createBooking({
      guestName: 'Tamu Uji',
      guestPhone: '081111111111',
      partySize: 4,
      date: '2026-12-24',
      timeSlot: '19:00 - 21:00',
      tableId: 'tbl-4',
      packagePrice: 300000,
    });

    expect(booking.depositAmount).toBe(75000);

    const liabilityBefore = reportService.buildSnapshot().depositLiability;
    bookingService.payDeposit(booking.id, 'qris');
    const liabilityAfter = reportService.buildSnapshot().depositLiability;

    expect(liabilityAfter - liabilityBefore).toBe(75000);

    const totals = db.prepare('SELECT SUM(debit) AS d, SUM(credit) AS k FROM ledger_entries').get() as {
      d: number;
      k: number;
    };
    expect(totals.d).toBe(totals.k);
  });

  it('pembatalan melepas liabilitas deposit penuh & mencatat penalti sebagai pendapatan', () => {
    const booking = bookingService.createBooking({
      guestName: 'Pembatal',
      guestPhone: '082222222222',
      partySize: 2,
      date: '2026-12-26',
      timeSlot: '17:00 - 19:00',
      tableId: 'tbl-5',
      packagePrice: 150000,
    });

    bookingService.payDeposit(booking.id, 'debit');
    const before = reportService.buildSnapshot();
    expect(before.depositLiability).toBeGreaterThan(0);
    const deposit = before.depositLiability - 400000; // dikurangi 2 deposit seed
    expect(deposit).toBe(37500);

    bookingService.updateBookingStatus(booking.id, 'cancelled');
    const after = reportService.buildSnapshot();

    // seluruh deposit keluar dari liabilitas, penalti 50% diakui sebagai pendapatan
    expect(before.depositLiability - after.depositLiability).toBe(37500);
    expect(after.revenue - before.revenue).toBe(18750);
    expect(after.cashBalance - before.cashBalance).toBe(-18750);

    const totals = getDb().prepare('SELECT SUM(debit) AS d, SUM(credit) AS k FROM ledger_entries').get() as {
      d: number;
      k: number;
    };
    expect(totals.d).toBe(totals.k);
  });
});

describe('Modul Inventory', () => {
  beforeEach(resetDb);

  it('purchase order menambah stok dan updating harga rata-rata (moving average)', () => {
    const db = getDb();

    const before = db
      .prepare('SELECT s.quantity AS qty, m.unit_cost AS cost FROM stock_items s JOIN raw_materials m ON m.id = s.raw_material_id WHERE m.id = ?')
      .get('raw-1') as { qty: number; cost: number };

    const po = inventoryService.createPurchaseOrder({
      supplierId: 'sup-1',
      items: [{ rawMaterialId: 'raw-1', quantity: 10 }],
    });

    inventoryService.receivePurchaseOrder(po.id, 'u-admin');

    const after = db
      .prepare('SELECT s.quantity AS qty, m.unit_cost AS cost FROM stock_items s JOIN raw_materials m ON m.id = s.raw_material_id WHERE m.id = ?')
      .get('raw-1') as { qty: number; cost: number };

    expect(after.qty).toBe(before.qty + 10);
    // harga beli sama -> rata-rata tidak berubah
    expect(after.cost).toBe(before.cost);

    const totals = db.prepare('SELECT SUM(debit) AS d, SUM(credit) AS k FROM ledger_entries').get() as {
      d: number;
      k: number;
    };
    expect(totals.d).toBe(totals.k);
  });

  it('menolak penerimaan barang ganda pada PO yang sama', () => {
    const po = inventoryService.createPurchaseOrder({
      supplierId: 'sup-1',
      items: [{ rawMaterialId: 'raw-5', quantity: 5 }],
    });
    inventoryService.receivePurchaseOrder(po.id, 'u-admin');
    expect(() => inventoryService.receivePurchaseOrder(po.id, 'u-admin')).toThrowError();
  });

  it('penyesuaian stok dicatat ke jurnal persediaan', () => {
    const before = reportService.buildSnapshot();
    const result = inventoryService.adjustStock(
      { rawMaterialId: 'raw-3', delta: -2, reason: 'Rusak / kadaluwarsa' },
      'u-manager'
    );
    const after = reportService.buildSnapshot();

    expect(result.after).toBeCloseTo(result.before - 2, 3);
    expect(after.inventoryValue).toBeLessThan(before.inventoryValue);
    const totals = getDb().prepare('SELECT SUM(debit) AS d, SUM(credit) AS k FROM ledger_entries').get() as {
      d: number;
      k: number;
    };
    expect(totals.d).toBe(totals.k);
  });

  it('menolak pengurangan stok melebihi stok tersedia', () => {
    expect(() =>
      inventoryService.adjustStock({ rawMaterialId: 'raw-7', delta: -9999, reason: 'Salah input' }, 'u-admin')
    ).toThrowError();
  });

  it('nilai persediaan pada neraca sama dengan total valuasi', () => {
    const valuation = reportService.inventoryValuation();
    const snapshot = reportService.buildSnapshot();
    expect(valuation.total).toBe(snapshot.inventoryValue);
  });
});