import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Uji Phase 2: payment gateway (signature HMAC + idempotensi), QRIS payload,
 * notification outbox, dan receipt PDF.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const TEST_DB = path.join(DATA_DIR, 'test-phase2.db');
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

const { resetDatabase } = await import('../src/server/db/seed');
const { getDb } = await import('../src/server/db/client');
const { seedTemplates, sendNotification, listNotifications, notificationStats } = await import(
  '../src/server/services/notification.service'
);
const {
  createPayment,
  handleWebhook,
  buildSignature,
  verifySignature,
  buildQrisPayload,
  paymentReport,
  webhookSchema,
} = await import('../src/server/services/payment.service');
const { buildReceiptPdf, loadReceiptData } = await import('../src/server/services/pdf.service');
const orderService = await import('../src/server/services/order.service');
const { buildSnapshot } = await import('../src/server/services/report.service');

const sampleWebhook = webhookSchema.parse({
  provider: 'midtrans',
  externalId: 'TRX-TEST-1',
  eventType: 'payment',
  transactionStatus: 'capture',
  amount: 150000,
});

describe('Payment Gateway', () => {
  beforeEach(resetDb);

  it('verifikasi signature HMAC-SHA512 menolak request yang dimanipulasi', () => {
    const signature = buildSignature(sampleWebhook);
    expect(verifySignature(sampleWebhook, signature)).toBe(true);

    const manipulated = { ...sampleWebhook, amount: 900000 };
    expect(verifySignature(manipulated, signature)).toBe(false);
    expect(verifySignature(sampleWebhook, null)).toBe(false);
    expect(verifySignature(sampleWebhook, 'abc123')).toBe(false);
  });

  it('membuat payment intent dengan biaya admin sesuai channel', () => {
    // Order dibuat tanpa pembayaran -> dibayar lewat gateway
    const order = orderService.placeOrder(
      {
        tableNumber: 'Meja 03',
        customerName: 'Gateway Test',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-6', quantity: 1 }],
      },
      'u-kasir1'
    );
    expect(order.paymentStatus).toBe('unpaid');

    const intent = createPayment({ refType: 'order', refId: order.orderNo, method: 'debit' });
    expect(intent.status).toBe('pending');
    expect(intent.amount).toBe(order.total);
    expect(intent.fee).toBe(2500);
    expect(intent.total).toBe(order.total + 2500);
    expect(intent.redirectUrl).toBe(`/pay/${intent.token}`);
    expect(intent.externalId).toMatch(/^TRX-/);
  });

  it('menolak pembuatan payment untuk order yang sudah lunas', () => {
    const order = orderService.placeOrder(
      {
        tableNumber: 'Meja 04',
        customerName: 'Sudah Lunas',
        source: 'pos_cashier',
        paymentMethod: 'qris',
        items: [{ menuItemId: 'menu-6', quantity: 1 }],
      },
      'u-kasir1'
    );
    expect(() => createPayment({ refType: 'order', refId: order.orderNo, method: 'qris' })).toThrowError();
  });

  it('QRIS payload memiliki format EMVCo dan CRC16 yang valid', () => {
    const payload = buildQrisPayload({
      merchantName: 'Restoran Nusantara',
      merchantCity: 'JAKARTA',
      amount: 50000,
      reference: 'TRX-ABC',
    });
    expect(payload.startsWith('000201')).toBe(true);
    expect(payload).toContain('5802ID');
    expect(payload).toContain('RESTORAN NUSANTARA');
    // tag 59 = nama merchant, panjang 18 karakter
    expect(payload).toContain('5918RESTORAN NUSANTARA');
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it('webhook dengan signature salah ditolak dan tidak mengubah pembayaran', () => {
    const order = orderService.placeOrder(
      {
        tableNumber: 'Meja 05',
        customerName: 'Webhook Test',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-6', quantity: 1 }],
      },
      'u-kasir1'
    );

    const intent = createPayment({ refType: 'order', refId: order.orderNo, method: 'qris' });
    const payload = webhookSchema.parse({
      provider: 'midtrans',
      externalId: intent.externalId,
      eventType: 'payment',
      transactionStatus: 'capture',
      amount: intent.total,
    });

    const result = handleWebhook(payload, 'signature-palsu');
    expect(result.signatureValid).toBe(false);
    expect(result.status).toBe('rejected');

    const payment = getDb()
      .prepare('SELECT status FROM payments WHERE reference_id = ?')
      .get(intent.externalId) as { status: string };
    expect(payment.status).toBe('pending');
  });

  it('webhook valid menandai pembayaran lunas, mencatat jurnal & mengirim notifikasi', () => {
    const order = orderService.placeOrder(
      {
        tableNumber: 'Takeaway',
        customerName: 'Bayar Gateway',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-2', quantity: 1 }],
      },
      'u-kasir1'
    );

    const intent = createPayment({ refType: 'order', refId: order.orderNo, method: 'qris' });
    const payload = webhookSchema.parse({
      provider: 'midtrans',
      externalId: intent.externalId,
      eventType: 'payment',
      transactionStatus: 'capture',
      amount: intent.total,
    });

    const revenueBefore = buildSnapshot().revenue;
    const result = handleWebhook(payload, buildSignature(payload));

    expect(result.signatureValid).toBe(true);
    expect(result.status).toBe('paid');

    const updated = getDb()
      .prepare('SELECT payment_status, payment_method FROM orders WHERE id = ?')
      .get(order.id) as { payment_status: string; payment_method: string };
    expect(updated.payment_status).toBe('paid');
    expect(updated.payment_method).toBe('qris');

    // Pendapatan naik karena transaksi kini lunas
    expect(buildSnapshot().revenue).toBeGreaterThan(revenueBefore);

    // Jurnal tetap seimbang
    const totals = getDb().prepare('SELECT SUM(debit) AS d, SUM(credit) AS k FROM ledger_entries').get() as {
      d: number;
      k: number;
    };
    expect(totals.d).toBe(totals.k);

    // Notifikasi pembayaran tercatat
    const notifications = listNotifications(50);
    expect(notifications.some((n) => n.template === 'payment_received')).toBe(true);
  });

  it('webhook duplikat bersifat idempotent (tidak double credit)', () => {
    const order = orderService.placeOrder(
      {
        tableNumber: 'Meja 01',
        customerName: 'Idempoten',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-1', quantity: 1 }],
      },
      'u-kasir1'
    );

    const intent = createPayment({ refType: 'order', refId: order.orderNo, method: 'qris' });
    const payload = webhookSchema.parse({
      provider: 'midtrans',
      externalId: intent.externalId,
      eventType: 'payment',
      transactionStatus: 'capture',
      amount: intent.total,
    });

    const signature = buildSignature(payload);
    handleWebhook(payload, signature);
    const revenueAfterFirst = buildSnapshot().revenue;
    const ledgerAfterFirst = getDb().prepare('SELECT COUNT(*) AS c FROM ledger_entries').get() as { c: number };

    const second = handleWebhook(payload, signature);
    expect(second.duplicate).toBe(true);

    expect(buildSnapshot().revenue).toBe(revenueAfterFirst);
    const ledgerAfterSecond = getDb().prepare('SELECT COUNT(*) AS c FROM ledger_entries').get() as { c: number };
    expect(ledgerAfterSecond.c).toBe(ledgerAfterFirst.c);
  });

  it('webhook dengan status gagal menandai pembayaran failed', () => {
    const order = orderService.placeOrder(
      {
        tableNumber: 'Meja 03',
        customerName: 'Kartu Ditolak',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-6', quantity: 1 }],
      },
      'u-kasir1'
    );
    const intent = createPayment({ refType: 'order', refId: order.orderNo, method: 'credit' });
    const payload = webhookSchema.parse({
      provider: 'midtrans',
      externalId: intent.externalId,
      eventType: 'payment',
      transactionStatus: 'deny',
      amount: intent.total,
    });

    const result = handleWebhook(payload, buildSignature(payload));
    expect(result.status).toBe('failed');

    const payment = getDb()
      .prepare('SELECT status FROM payments WHERE reference_id = ?')
      .get(intent.externalId) as { status: string };
    expect(payment.status).toBe('failed');
  });

  it('laporan payment menyertakan rekap dan log webhook', () => {
    const report = paymentReport();
    expect(report.totals.total).toBe(0);
    expect(Array.isArray(report.payments)).toBe(true);
    expect(Array.isArray(report.webhooks)).toBe(true);
  });

  it('stok fisik selalu sama dengan nilai buku di jurnal (termasuk flow belum lunas → lunas)', () => {
    const bookVsPhysical = () => {
      const book = getDb()
        .prepare(
          `SELECT COALESCE(SUM(debit - credit), 0) AS v FROM ledger_entries WHERE account_code = '1-200'`
        )
        .get() as { v: number };
      const physical = getDb()
        .prepare(
          `SELECT ROUND(COALESCE(SUM(s.quantity * m.unit_cost), 0)) AS v
           FROM stock_items s JOIN raw_materials m ON m.id = s.raw_material_id`
        )
        .get() as { v: number };
      return { book: book.v, physical: physical.v };
    };

    // order dibuat belum lunas -> stok TIDAK boleh berkurang
    const stockBefore = getDb()
      .prepare('SELECT quantity AS q FROM stock_items WHERE raw_material_id = ?')
      .get('raw-3') as { q: number };

    const unpaid = orderService.placeOrder(
      {
        tableNumber: 'Meja 01',
        customerName: 'Belum Lunas',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-3', quantity: 1 }],
      },
      'u-kasir1'
    );

    const stockAfterUnpaid = getDb()
      .prepare('SELECT quantity AS q FROM stock_items WHERE raw_material_id = ?')
      .get('raw-3') as { q: number };
    expect(stockAfterUnpaid.q).toBe(stockBefore.q);

    // dibayar lewat gateway -> stok & jurnal turun bersama
    const intent = createPayment({ refType: 'order', refId: unpaid.orderNo, method: 'qris' });
    const payload = webhookSchema.parse({
      provider: 'midtrans',
      externalId: intent.externalId,
      eventType: 'payment',
      transactionStatus: 'capture',
      amount: intent.total,
    });
    handleWebhook(payload, buildSignature(payload));

    const stockAfterPaid = getDb()
      .prepare('SELECT quantity AS q FROM stock_items WHERE raw_material_id = ?')
      .get('raw-3') as { q: number };
    expect(stockAfterPaid.q).toBeLessThan(stockAfterUnpaid.q);

    const { book, physical } = bookVsPhysical();
    expect(Math.abs(book - physical)).toBeLessThanOrEqual(1);
  });

  it('webhook palsu tidak memblokir pembayaran sah (anti-DoS idempotency key)', () => {
    const order = orderService.placeOrder(
      {
        tableNumber: 'Meja 04',
        customerName: 'Anti DoS',
        source: 'pos_cashier',
        items: [{ menuItemId: 'menu-2', quantity: 1 }],
      },
      'u-kasir1'
    );

    const intent = createPayment({ refType: 'order', refId: order.orderNo, method: 'qris' });
    const payload = webhookSchema.parse({
      provider: 'midtrans',
      externalId: intent.externalId,
      eventType: 'payment',
      transactionStatus: 'capture',
      amount: intent.total,
    });

    // penyerang yang tidak berwenang mengirim webhook palsu lebih dulu
    const forged = handleWebhook(payload, 'signature-palsu');
    expect(forged.signatureValid).toBe(false);

    // webhook sah tetap harus diproses
    const legit = handleWebhook(payload, buildSignature(payload));
    expect(legit.signatureValid).toBe(true);
    expect(legit.status).toBe('paid');

    const updated = getDb()
      .prepare('SELECT payment_status FROM orders WHERE id = ?')
      .get(order.id) as { payment_status: string };
    expect(updated.payment_status).toBe('paid');
  });
});

describe('Notification Outbox', () => {
  beforeEach(() => {
    resetDb();
    seedTemplates();
  });

  it('seed template dan merender variabel pada pesan', () => {
    const record = sendNotification({
      code: 'order_received',
      to: '08123456789',
      vars: {
        orderNo: 'ORD-9999',
        customerName: 'Budi',
        tableNumber: 'Meja 05',
        total: 'Rp150.000',
        eta: '10 menit',
      },
      refType: 'order',
      refId: 'ORD-9999',
    });

    expect(record.status).toBe('sent');
    expect(record.body).toContain('ORD-9999');
    expect(record.body).toContain('Budi');
    expect(record.body).not.toContain('{{');
  });

  it('variabel yang tidak diisi diganti dengan tanda hubung', () => {
    const record = sendNotification({
      code: 'booking_created',
      to: 'test@resto.test',
      vars: { bookingCode: 'BKG-TEST' },
    });
    expect(record.body).not.toContain('{{');
    expect(record.body).toContain('BKG-TEST');
  });

  it('penerima kosong menghasilkan status failed', () => {
    const record = sendNotification({ code: 'order_ready', to: '', vars: { orderNo: 'ORD-1' } });
    expect(record.status).toBe('failed');
  });

  it('statistik notifikasi menghitung kanal dan status', () => {
    sendNotification({ code: 'order_received', to: 'a@resto.test', vars: { orderNo: 'A' } });
    sendNotification({ code: 'booking_confirmed', to: '0812', vars: { bookingCode: 'B' } });

    const stats = notificationStats();
    expect(stats.sent).toBe(2);
    expect(stats.failed).toBe(0);
    expect(stats.byChannel.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Receipt PDF', () => {
  beforeEach(resetDb);

  it('menghasilkan PDF valid dengan header %PDF', async () => {
    const order = orderService.placeOrder(
      {
        tableNumber: 'Meja 07',
        customerName: 'PDF Test',
        source: 'pos_cashier',
        paymentMethod: 'cash',
        cashReceived: 200000,
        items: [
          { menuItemId: 'menu-3', quantity: 1, notes: 'Level 1' },
          { menuItemId: 'menu-6', quantity: 3 },
        ],
      },
      'u-kasir1'
    );

    const data = loadReceiptData(order.orderNo);
    expect(data.orderNo).toBe(order.orderNo);
    expect(data.items).toHaveLength(2);
    expect(data.store.name).toBe('Restoran Nusantara');

    const pdf = await buildReceiptPdf(data);
    expect(pdf.length).toBeGreaterThan(500);
    // Header dokumen PDF
    expect(Buffer.from(pdf.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('menolak referensi struk yang tidak ditemukan', () => {
    expect(() => loadReceiptData('ORD-TIDAK-ADA')).toThrowError();
  });
});