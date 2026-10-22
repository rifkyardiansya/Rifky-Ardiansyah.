import crypto from 'node:crypto';
import { getDb, nowISO } from '../db/client';
import { formatIDR } from '../../lib/utils';
import { publish } from '../realtime/bus';

/**
 * Notification Service — pola Outbox.
 *
 * Pesan tidak dikirim langsung di dalam transaksi bisnis (agar transaksi tidak
 * gagal gara-gara layanan eksternal), melainkan ditulis ke tabel `notifications`
 * lalu dikirim oleh worker. Pada prototype, "worker" berjalan sinkron dan
 *menuliskan hasil pengiriman ke log + event realtime.
 */

export type NotificationChannel = 'email' | 'sms' | 'whatsapp';

export interface TemplateVars {
  [key: string]: string | number | undefined;
}

export interface NotificationRecord {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  template: string;
  subject: string | null;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  refType: string | null;
  refId: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface TemplateRow {
  code: string;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  description: string | null;
}

/* ------------------------------------------------------------------ */
/* Template bawaan (di-seed ke tabel notification_templates)            */
/* ------------------------------------------------------------------ */

export const DEFAULT_TEMPLATES: TemplateRow[] = [
  {
    code: 'order_received',
    channel: 'email',
    subject: 'Pesanan {{orderNo}} diterima — {{restaurant}}',
    body: 'Halo {{customerName}},\n\nTerima kasih telah memesan di {{restaurant}}.\n\n' +
      'Nomor Pesanan : {{orderNo}}\nMeja / Layanan : {{tableNumber}}\n' +
      'Total         : {{total}}\nEstimasi      : {{eta}}\n\n' +
      'Pesanan Anda sudah diteruskan ke dapur.\n\nSalam,\n{{restaurant}}',
    description: 'Konfirmasi pesanan dikirim ke customer',
  },
  {
    code: 'order_ready',
    channel: 'sms',
    subject: null,
    body: '{{restaurant}}: Pesanan {{orderNo}} sudah siap dan segera diantarkan ke {{tableNumber}}. Terima kasih!',
    description: 'Notifikasi pesanan siap diantar (SMS)',
  },
  {
    code: 'booking_created',
    channel: 'email',
    subject: 'Reservasi {{bookingCode}} berhasil dibuat',
    body: 'Halo {{guestName}},\n\nReservasi Anda tercatat:\n' +
      'Kode    : {{bookingCode}}\nTanggal : {{date}}\nJam     : {{timeSlot}}\nMeja    : {{tableNo}}\n' +
      'Deposit : {{deposit}}\n\nSelesaikan pembayaran deposit sebelum {{expireAt}}.\n\n{{restaurant}}',
    description: 'Detail reservasi + instruksi deposit',
  },
  {
    code: 'booking_confirmed',
    channel: 'sms',
    subject: null,
    body: '{{restaurant}}: Reservasi {{bookingCode}} ({{date}} {{timeSlot}}, {{tableNo}}) terkonfirmasi. Tunjukkan QR e-ticket saat check-in.',
    description: 'Konfirmasi deposit diterima',
  },
  {
    code: 'booking_cancelled',
    channel: 'email',
    subject: 'Pembatalan reservasi {{bookingCode}}',
    body: 'Halo {{guestName}},\n\nReservasi {{bookingCode}} telah dibatalkan.\n' +
      'Deposit dikembalikan : {{refund}}\nPenalti pembatalan   : {{penalty}}\n\n{{restaurant}}',
    description: 'Informasi pembatalan & refund deposit',
  },
  {
    code: 'payment_received',
    channel: 'whatsapp',
    subject: null,
    body: 'Pembayaran {{amount}} untuk {{refType}} {{refId}} telah kami terima. Kode: {{externalId}}. {{restaurant}}',
    description: 'Bukti pembayaran masuk dari gateway',
  },
  {
    code: 'low_stock_alert',
    channel: 'email',
    subject: 'Peringatan stok menipis: {{materialName}}',
    body: 'Halo {{adminName}},\n\nStok bahan {{materialName}} tersisa {{quantity}} {{unit}} ' +
      '(minimum {{minStock}} {{unit}}).\n\nSebaiknya buat Purchase Order segera.\n\n{{restaurant}}',
    description: 'Alert internal stok menipis',
  },
  {
    code: 'daily_report',
    channel: 'email',
    subject: 'Laporan Penjualan Harian {{date}} — {{restaurant}}',
    body: 'Halo Manager,\n\nBerikut ringkasan penjualan harian Restoran Nusantara:\n\n{{message}}\n\n' +
      'Laporan lengkap tersedia di menu Laporan Keuangan.\n\nSalam,\n{{restaurant}}',
    description: 'Ringkasan penjualan harian (dikirim oleh cron job)',
  },
];

/** Merender template dengan aman terhadap variabel yang tidak terisi. */
function render(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? '-' : String(value);
  });
}

export function seedTemplates() {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO notification_templates (code, channel, subject, body, description)
     VALUES (?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    DEFAULT_TEMPLATES.forEach((t) => stmt.run(t.code, t.channel, t.subject, t.body, t.description));
  })();
}

/* ------------------------------------------------------------------ */
/* Pengiriman                                                            */
/* ------------------------------------------------------------------ */

export function sendNotification(input: {
  code: string;
  to: string;
  vars: TemplateVars;
  refType?: string;
  refId?: string;
  channel?: NotificationChannel;
}): NotificationRecord {
  const db = getDb();
  const template = db
    .prepare('SELECT * FROM notification_templates WHERE code = ?')
    .get(input.code) as TemplateRow | undefined;

  const fallback = DEFAULT_TEMPLATES.find((t) => t.code === input.code);
  const channel = input.channel ?? template?.channel ?? fallback?.channel ?? 'email';
  const subjectTemplate = template?.subject ?? fallback?.subject ?? null;
  const bodyTemplate = template?.body ?? fallback?.body ?? '{{restaurant}}: {{message}}';

  const vars: TemplateVars = { restaurant: 'Restoran Nusantara', ...input.vars };
  const body = render(bodyTemplate, vars);
  const subject = subjectTemplate ? render(subjectTemplate, vars) : null;
  const id = `ntf-${crypto.randomUUID().slice(0, 10)}`;
  const now = nowISO();

  // Simpan (status queued) lalu kirim — meniru pola outbox worker.
  db.prepare(
    `INSERT INTO notifications (id, channel, recipient, template, subject, body, status, ref_type, ref_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
  ).run(id, channel, input.to, input.code, subject, body, input.refType ?? null, input.refId ?? null, now);

  const status = dispatch(id, channel, input.to, body);
  return { id, channel, recipient: input.to, template: input.code, subject, body, status, refType: input.refType ?? null, refId: input.refId ?? null, sentAt: now, createdAt: now };
}

/**
 * "Pengiriman" channel. Pada prototype tidak ada SMTP/provider eksternal,
 * sehingga delivery dicatat ke log server (dan diteruskan ke KDS/admin via SSE).
 */
function dispatch(
  id: string,
  channel: NotificationChannel,
  recipient: string,
  body: string
): 'sent' | 'failed' {
  const db = getDb();
  const now = nowISO();

  const failed = !recipient || recipient.trim().length === 0;
  db.prepare('UPDATE notifications SET status = ?, sent_at = ?, error = ? WHERE id = ?').run(
    failed ? 'failed' : 'sent',
    failed ? null : now,
    failed ? 'Recipient kosong' : null,
    id
  );

  if (!failed) {
    console.log(`[notify:${channel}] -> ${recipient}\n${body}\n`);
    publish('notification', { id, channel, recipient, preview: body.slice(0, 140) });
  }
  return failed ? 'failed' : 'sent';
}

/**
 * Worker outbox: mengirim ulang notifikasi yang tercatat `queued` (mis. proses
 * mati tepat setelah INSERT, sebelum dispatch()). Pola outbox — tulis ke database
 * dulu, kirim setelahnya — dijaga oleh status baris, bukan oleh memori proses.
 */
export function retryQueuedNotifications(limit = 50): { retried: number; sent: number; failed: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, channel, recipient, body FROM notifications
       WHERE status = 'queued' ORDER BY created_at LIMIT ?`
    )
    .all(limit) as { id: string; channel: NotificationChannel; recipient: string; body: string }[];

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (dispatch(row.id, row.channel, row.recipient, row.body) === 'sent') sent += 1;
    else failed += 1;
  }

  return { retried: rows.length, sent, failed };
}

export function listNotifications(limit = 100) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, channel, recipient, template, subject, body, status,
              ref_type AS refType, ref_id AS refId, sent_at AS sentAt, created_at AS createdAt
       FROM notifications ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as NotificationRecord[];
}

export function notificationStats() {
  const db = getDb();
  const rows = db
    .prepare('SELECT channel, status, COUNT(*) AS total FROM notifications GROUP BY channel, status')
    .all() as { channel: string; status: string; total: number }[];

  const byChannel = new Map<string, number>();
  let sent = 0;
  let failed = 0;
  rows.forEach((r) => {
    byChannel.set(r.channel, (byChannel.get(r.channel) ?? 0) + r.total);
    if (r.status === 'sent') sent += r.total;
    if (r.status === 'failed') failed += r.total;
  });

  return { sent, failed, byChannel: Array.from(byChannel.entries()).map(([channel, total]) => ({ channel, total })) };
}

/* ------------------------------------------------------------------ */
/* Helper pemicu                                                          */
/* ------------------------------------------------------------------ */

export function notifyOrderReceived(order: {
  orderNo: string;
  customerName: string;
  customerPhone?: string;
  tableNumber: string;
  total: number;
  source: string;
}) {
  const channel = order.customerPhone ? 'sms' : 'email';
  const to = order.customerPhone ?? `${order.source === 'pos_cashier' ? 'kasir' : 'customer'}@resto.test`;
  return sendNotification({
    code: 'order_received',
    channel,
    to,
    vars: {
      orderNo: order.orderNo,
      customerName: order.customerName,
      tableNumber: order.tableNumber,
      total: formatIDR(order.total),
      eta: '10-15 menit',
    },
    refType: 'order',
    refId: order.orderNo,
  });
}

export function notifyBookingCreated(booking: {
  bookingCode: string;
  guestName: string;
  guestEmail?: string;
  guestPhone: string;
  date: string;
  timeSlot: string;
  tableNo: string;
  depositAmount: number;
}) {
  return sendNotification({
    code: 'booking_created',
    channel: 'email',
    to: booking.guestEmail ?? `${booking.guestPhone}@booking.local`,
    vars: {
      bookingCode: booking.bookingCode,
      guestName: booking.guestName,
      date: booking.date,
      timeSlot: booking.timeSlot,
      tableNo: booking.tableNo,
      deposit: formatIDR(booking.depositAmount),
      expireAt: '24 jam sejak pemesanan',
    },
    refType: 'booking',
    refId: booking.bookingCode,
  });
}

export function notifyBookingConfirmed(booking: {
  bookingCode: string;
  guestPhone: string;
  date: string;
  timeSlot: string;
  tableNo: string;
}) {
  return sendNotification({
    code: 'booking_confirmed',
    channel: 'sms',
    to: booking.guestPhone,
    vars: {
      bookingCode: booking.bookingCode,
      date: booking.date,
      timeSlot: booking.timeSlot,
      tableNo: booking.tableNo,
    },
    refType: 'booking',
    refId: booking.bookingCode,
  });
}

export function notifyBookingCancelled(booking: {
  bookingCode: string;
  guestName: string;
  guestEmail?: string;
  guestPhone: string;
  depositAmount: number;
  refundAmount: number;
}) {
  return sendNotification({
    code: 'booking_cancelled',
    channel: 'email',
    to: booking.guestEmail ?? `${booking.guestPhone}@booking.local`,
    vars: {
      bookingCode: booking.bookingCode,
      guestName: booking.guestName,
      refund: formatIDR(booking.refundAmount),
      penalty: formatIDR(booking.depositAmount - booking.refundAmount),
    },
    refType: 'booking',
    refId: booking.bookingCode,
  });
}

export function notifyPaymentReceived(input: {
  externalId: string;
  amount: number;
  refType: string;
  refId: string;
  to?: string;
}) {
  return sendNotification({
    code: 'payment_received',
    channel: 'whatsapp',
    to: input.to ?? 'kasir@resto.test',
    vars: {
      externalId: input.externalId,
      amount: formatIDR(input.amount),
      refType: input.refType,
      refId: input.refId,
    },
    refType: input.refType,
    refId: input.refId,
  });
}

export function notifyLowStock(material: { name: string; currentStock: number; minStock: number; unit: string }) {
  return sendNotification({
    code: 'low_stock_alert',
    channel: 'email',
    to: 'admin@resto.test',
    vars: {
      adminName: 'Administrator',
      materialName: material.name,
      quantity: material.currentStock,
      minStock: material.minStock,
      unit: material.unit,
    },
    refType: 'material',
    refId: material.name,
  });
}