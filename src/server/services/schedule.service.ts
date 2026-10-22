import crypto from 'node:crypto';
import { getDb, nowISO, todayISO } from '../db/client';
import { buildSnapshot } from './report.service';
import { sendNotification } from './notification.service';
import { publish } from '../realtime/bus';
import { formatIDR } from '../../lib/utils';

/**
 * Scheduled Report Service.
 *
 * Pada aplikasi nyata, blok ini dipanggil oleh cron job (cron-linux, GitHub
 * Actions schedule, Vercel Cron, atau BullMQ repeat job). Endpoint
 * `/api/v1/cron/daily-report` adalah "trigger"-nya: aman dipanggil scheduler
 * mana pun, dilindungi shared secret, dan bersifat idempotent per tanggal.
 */

export interface DailyReport {
  id: string;
  date: string;
  generatedAt: string;
  omzet: number;
  transaksi: number;
  rataRataTransaksi: number;
  itemTerjual: number;
  produkTerlaris: { name: string; qty: number; revenue: number }[];
  metodeBayar: { method: string; count: number; total: number }[];
  reservasi: { total: number; confirmed: number; cancelled: number; deposit: number };
  snapshot: ReturnType<typeof buildSnapshot>;
  highlights: string[];
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  debit: 'Kartu Debit',
  credit: 'Kartu Kredit',
  transfer: 'Virtual Account',
  '-': 'Belum bayar',
};

/** Menghasilkan laporan penjualan satu hari. */
export function buildDailyReport(date = todayISO()): DailyReport {
  const db = getDb();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(total), 0) AS revenue,
              COALESCE(SUM(subtotal), 0) AS subtotal,
              COALESCE(SUM(tax), 0) AS tax,
              COALESCE(SUM(service_charge), 0) AS serviceCharge
       FROM orders
       WHERE DATE(COALESCE(paid_at, created_at)) = ?
         AND payment_status = 'paid' AND status <> 'cancelled'`
    )
    .get(date) as { orders: number; revenue: number; subtotal: number; tax: number; serviceCharge: number };

  const items = db
    .prepare(
      `SELECT COALESCE(SUM(i.quantity), 0) AS qty
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE DATE(COALESCE(o.paid_at, o.created_at)) = ?
         AND o.payment_status = 'paid' AND o.status <> 'cancelled'`
    )
    .get(date) as { qty: number };

  const products = db
    .prepare(
      `SELECT i.name, SUM(i.quantity) AS qty, SUM(i.subtotal) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE DATE(COALESCE(o.paid_at, o.created_at)) = ?
         AND o.payment_status = 'paid' AND o.status <> 'cancelled'
       GROUP BY i.name ORDER BY qty DESC LIMIT 5`
    )
    .all(date) as { name: string; qty: number; revenue: number }[];

  const methods = db
    .prepare(
      `SELECT COALESCE(payment_method, '-') AS method, COUNT(*) AS count, SUM(total) AS total
       FROM orders
       WHERE DATE(COALESCE(paid_at, created_at)) = ? AND payment_status = 'paid'
       GROUP BY payment_method ORDER BY total DESC`
    )
    .all(date) as { method: string; count: number; total: number }[];

  const bookings = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('confirmed','checked_in') THEN 1 ELSE 0 END) AS confirmed,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
              COALESCE(SUM(CASE WHEN deposit_status = 'paid' THEN deposit_amount ELSE 0 END), 0) AS deposit
       FROM bookings WHERE booking_date = ?`
    )
    .get(date) as { total: number; confirmed: number; cancelled: number; deposit: number };

  const snapshot = buildSnapshot();
  const avg = totals.orders > 0 ? Math.round(totals.revenue / totals.orders) : 0;

  /* Poin-poin yang biasanya ditanyakan manajer: perbandingan dengan hari sebelumnya. */
  const highlights: string[] = [];
  if (totals.orders === 0) {
    highlights.push('Tidak ada transaksi pada periode ini.');
  } else {
    highlights.push(`Omzet ${formatIDR(totals.revenue)} dari ${totals.orders} transaksi (rata-rata ${formatIDR(avg)}).`);

    const yesterday = db
      .prepare(
        `SELECT COALESCE(SUM(total),0) AS revenue FROM orders
         WHERE DATE(COALESCE(paid_at, created_at)) = date(?, '-1 day')
           AND payment_status = 'paid' AND status <> 'cancelled'`
      )
      .get(date) as { revenue: number };

    if (yesterday.revenue > 0) {
      const delta = ((totals.revenue - yesterday.revenue) / yesterday.revenue) * 100;
      highlights.push(
        delta >= 0
          ? `Naik ${delta.toFixed(1)}% dibanding kemarin (${formatIDR(yesterday.revenue)}).`
          : `Turun ${Math.abs(delta).toFixed(1)}% dibanding kemarin (${formatIDR(yesterday.revenue)}).`
      );
    }

    const top = products[0];
    if (top) highlights.push(`Menu terlaris: ${top.name} (${top.qty} terjual).`);

    const best = methods[0];
    if (best) {
      highlights.push(
        `Metode pembayaran tertinggi: ${METHOD_LABEL[best.method] ?? best.method} (${formatIDR(best.total)}).`
      );
    }

    if (snapshot.netIncome < 0) {
      highlights.push(`PERINGATAN: laba bersih periode ini negatif (${formatIDR(snapshot.netIncome)}).`);
    }
  }

  return {
    id: `dr-${date}`,
    date,
    generatedAt: nowISO(),
    omzet: totals.revenue,
    transaksi: totals.orders,
    rataRataTransaksi: avg,
    itemTerjual: items.qty,
    produkTerlaris: products,
    metodeBayar: methods,
    reservasi: {
      total: bookings.total ?? 0,
      confirmed: bookings.confirmed ?? 0,
      cancelled: bookings.cancelled ?? 0,
      deposit: bookings.deposit,
    },
    snapshot,
    highlights,
  };
}

/**
 * Membuat laporan harian + mengirim notifikasi ke manager.
 * Idempotent: bila laporan untuk tanggal yang sama sudah pernah dibuat,
 * tidak dibuat ulang (mencegah cron berjalan ganda mengirim email ganda).
 */
export function generateAndDispatchDailyReport(date = todayISO()) {
  const db = getDb();
  const report = buildDailyReport(date);

  const existing = db
    .prepare("SELECT id FROM financial_reports WHERE report_type = 'daily-summary' AND period = ?")
    .get(date) as { id: string } | undefined;

  if (existing) {
    return { report, created: false, id: existing.id, message: 'Laporan sudah pernah dibuat untuk tanggal ini.' };
  }

  const id = `fr-${crypto.randomUUID().slice(0, 10)}`;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO financial_reports (id, report_type, period, generated_at, status, data_json)
       VALUES (?, 'daily-summary', ?, ?, 'generated', ?)`
    ).run(id, date, report.generatedAt, JSON.stringify(report));

    db.prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip_address, created_at)
       VALUES (?, NULL, 'CRON_DAILY_REPORT', 'financial_reports', ?, 'scheduler', ?)`
    ).run(`aud-${crypto.randomUUID().slice(0, 8)}`, id, nowISO());
  })();

  const bodyLines = [
    `Laporan Penjualan Harian — ${report.date}`,
    '',
    ...report.highlights,
    '',
    `Pajak (PPN 10%) terutang : ${formatIDR(report.snapshot.taxPayable)}`,
    `Laba bersih berjalan     : ${formatIDR(report.snapshot.netIncome)}`,
    `Nilai persediaan         : ${formatIDR(report.snapshot.inventoryValue)}`,
  ].join('\n');

  sendNotification({
    code: 'daily_report',
    channel: 'email',
    to: 'manager@resto.test',
    vars: { date: report.date, message: bodyLines },
    refType: 'report',
    refId: id,
  });

  publish('session', { action: 'daily_report_generated', date: report.date, id });

  return { report, created: true, id, message: 'Laporan harian dibuat dan dikirim ke manager.' };
}

/** Daftar laporan yang sudah pernah dibuat (untuk UI). */
export function listGeneratedReports(limit = 30) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT fr.id, fr.report_type AS reportType, fr.period, fr.generated_at AS generatedAt,
              fr.status, u.username AS requestedBy
       FROM financial_reports fr
       LEFT JOIN audit_logs a ON a.entity_id = fr.id
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY fr.generated_at DESC LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[];

  const db2 = getDb();
  const snapshots = db2
    .prepare("SELECT period, data_json FROM financial_reports WHERE report_type = 'daily-summary' ORDER BY generated_at DESC LIMIT ?")
    .all(limit) as { period: string; data_json: string }[];

  const detail = snapshots.map((s) => {
    try {
      const parsed = JSON.parse(s.data_json) as DailyReport;
      return {
        period: s.period,
        omzet: parsed.omzet,
        transaksi: parsed.transaksi,
        highlights: parsed.highlights,
      };
    } catch {
      return { period: s.period, omzet: 0, transaksi: 0, highlights: [] };
    }
  });

  return { reports: rows, dailySummaries: detail };
}
