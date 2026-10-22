import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb, nowISO } from '../db/client';
import { ApiError } from '../http/api';
import { payExistingOrder } from './order.service';
import { payDeposit } from './booking.service';
import { notifyPaymentReceived } from './notification.service';
import { publish } from '../realtime/bus';
import { formatIDR } from '../../lib/utils';

/**
 * Payment Gateway Service.
 *
 * Meniru alur Midtrans Snap / Xendit Invoice:
 *   1. Merchant membuat permintaan pembayaran  -> `createPayment()`
 *      (server mengembalikan redirect_url + token; untuk QRIS, payload QR string)
 *   2. Customer membayar di halaman gateway     -> halaman simulasi `/pay/[token]`
 *   3. Gateway mengirim callback ke merchant    -> `handleWebhook()`
 *      (signature HMAC-SHA512 diverifikasi, callback bersifat idempotent)
 *
 * Tidak ada panggilan ke jaringan: provider disimulasikan sepenuhnya agar
 * demo dapat dijalankan offline. Mengganti ke Midtrans sungguhan cukup
 * mengganti isi `requestToGateway()` dan `verifySignature()`.
 */

export const GATEWAY_SECRET =
  process.env.PAYMENT_GATEWAY_SECRET ?? 'midtrans-sandbox-secret-restoran-nusantara';

export const PAYMENT_METHODS = {
  qris: { channel: 'qris', label: 'QRIS', fee: 0, instant: true },
  debit: { channel: 'card', label: 'Kartu Debit', fee: 2500, instant: false },
  credit: { channel: 'card', label: 'Kartu Kredit', fee: 0, instant: false },
  cash: { channel: 'cash', label: 'Tunai', fee: 0, instant: true },
  transfer: { channel: 'va', label: 'Virtual Account', fee: 6500, instant: false },
} as const;

export type GatewayMethod = keyof typeof PAYMENT_METHODS;

export interface PaymentIntent {
  id: string;
  externalId: string;
  token: string;
  refType: 'order' | 'booking';
  refId: string;
  method: GatewayMethod;
  channel: string;
  amount: number;
  fee: number;
  total: number;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  redirectUrl: string;
  qrPayload: string | null;
  expiresAt: string;
  createdAt: string;
}

export const webhookSchema = z.object({
  provider: z.enum(['midtrans', 'xendit']).default('midtrans'),
  externalId: z.string().min(1),
  eventType: z.enum(['payment', 'capture', 'settlement', 'pending', 'expire', 'deny']),
  transactionStatus: z.enum(['capture', 'settlement', 'pending', 'deny', 'cancel', 'expire', 'refund']),
  amount: z.number().int().min(0),
  fraudStatus: z.string().optional(),
});

export type WebhookPayload = z.infer<typeof webhookSchema>;

/* ------------------------------------------------------------------ */
/* Signature                                                             */
/* ------------------------------------------------------------------ */

/** Midtrans memakai HMAC-SHA512 dari transaction_id + status_code. */
export function buildSignature(payload: WebhookPayload): string {
  const raw = `${payload.externalId}.${statusCode(payload.transactionStatus)}.${payload.amount}`;
  return crypto.createHmac('sha512', GATEWAY_SECRET).update(raw).digest('hex');
}

export function verifySignature(payload: WebhookPayload, signature: string | null): boolean {
  if (!signature) return false;
  const expected = buildSignature(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function statusCode(status: WebhookPayload['transactionStatus']): string {
  const map: Record<WebhookPayload['transactionStatus'], string> = {
    capture: '200',
    settlement: '200',
    pending: '201',
    deny: '202',
    cancel: '202',
    expire: '202',
    refund: '201',
  };
  return map[status];
}

/* ------------------------------------------------------------------ */
/* QRIS payload                                                          */
/* ------------------------------------------------------------------ */

/**
 * Menyusun string QRIS statis gaya EMVCo (CRC16-CCITT).
 * Pada implementasi asli, payload ini berisi NIMI/nama merchant dari Bank Pusat.
 */
export function buildQrisPayload(input: {
  merchantName: string;
  merchantCity: string;
  amount: number;
  reference: string;
}): string {
  const nmid = 'ID1024398021749';
  const fields = [
    { id: '00', value: '01' },
    { id: '01', value: '12' },
    { id: '26', value: nmid },
    { id: '52', value: '5642' },
    { id: '53', value: '360' },
    { id: '54', value: String(input.amount) },
    { id: '58', value: 'ID' },
    { id: '59', value: input.merchantName.slice(0, 20).toUpperCase() },
    { id: '60', value: input.merchantCity.slice(0, 15) },
    { id: '62', value: `05${input.reference.slice(0, 20)}` },
  ];

  let payload = fields.map((f) => f.id + f.value.length.toString().padStart(2, '0') + f.value).join('');
  payload += '6304';

  const crc = crc16(payload);
  return payload + crc;
}

function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/* ------------------------------------------------------------------ */
/* Create payment                                                        */
/* ------------------------------------------------------------------ */

export function createPayment(input: {
  refType: 'order' | 'booking';
  refId: string;
  method: GatewayMethod;
}): PaymentIntent {
  const db = getDb();
  const spec = PAYMENT_METHODS[input.method];
  if (!spec) throw new ApiError(422, `Metode pembayaran "${input.method}" tidak didukung.`);

let amount: number;

  if (input.refType === 'order') {
    const order = db
      .prepare('SELECT id, order_no, total, payment_status FROM orders WHERE id = ? OR order_no = ?')
      .get(input.refId, input.refId) as
      | { id: string; order_no: string; total: number; payment_status: string }
      | undefined;
    if (!order) throw new ApiError(404, 'Order tidak ditemukan.');
    if (order.payment_status === 'paid') throw new ApiError(409, 'Pesanan sudah dibayar.');
    amount = order.total;
  } else {
    const booking = db
      .prepare('SELECT id, booking_code, deposit_amount, deposit_status FROM bookings WHERE id = ? OR booking_code = ?')
      .get(input.refId, input.refId) as
      | { id: string; booking_code: string; deposit_amount: number; deposit_status: string }
      | undefined;
    if (!booking) throw new ApiError(404, 'Reservasi tidak ditemukan.');
    if (booking.deposit_status === 'paid') throw new ApiError(409, 'Deposit sudah dibayar.');
    amount = booking.deposit_amount;
  }

  // id dipakai juga sebagai "token" halaman gateway, agar tidak perlu kolom tambahan
  const token = crypto.randomBytes(16).toString('hex');
  const id = `pay_${token}`;
  const externalId = `TRX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const fee = spec.fee;
  const total = amount + fee;
  const createdAt = nowISO();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const qrPayload =
    spec.channel === 'qris'
      ? buildQrisPayload({
          merchantName: 'Restoran Nusantara',
          merchantCity: 'JAKARTA',
          amount: total,
          reference: externalId,
        })
      : null;

  db.prepare(
    `INSERT INTO payments (id, order_id, method, amount, reference_id, status, channel, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    id,
    input.refType === 'order' ? resolveOrderId(input.refId) : null,
    input.method,
    total,
    externalId,
    spec.channel,
    expiresAt,
    createdAt
  );

  publish('payment', { action: 'created', externalId, refType: input.refType, refId: input.refId, amount: total });

  return {
    id,
    externalId,
    token,
    refType: input.refType,
    refId: input.refId,
    method: input.method,
    channel: spec.channel,
    amount,
    fee,
    total,
    status: 'pending',
    redirectUrl: `/pay/${token}`,
    qrPayload,
    expiresAt,
    createdAt,
  };
}

function resolveOrderId(ref: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT id FROM orders WHERE id = ? OR order_no = ?').get(ref, ref) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

export function getPaymentByToken(token: string): PaymentIntent | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM payments WHERE id = ?')
    .get(`pay_${token}`) as
    | {
        id: string; order_id: string | null; method: string; amount: number;
        reference_id: string; status: string; channel: string; expires_at: string; created_at: string;
      }
    | undefined;
  if (!row) return null;

  const spec = PAYMENT_METHODS[row.method as GatewayMethod] ?? PAYMENT_METHODS.qris;
  const booking = db
    .prepare('SELECT id, booking_code FROM bookings WHERE booking_code = ?')
    .get(row.reference_id) as { id: string; booking_code: string } | undefined;

  return {
    id: row.id,
    externalId: row.reference_id,
    token,
    refType: booking ? 'booking' : 'order',
    refId: booking?.booking_code ?? row.order_id ?? '',
    method: row.method as GatewayMethod,
    channel: row.channel,
    amount: row.amount - spec.fee,
    fee: spec.fee,
    total: row.amount,
    status: row.status as PaymentIntent['status'],
    redirectUrl: `/pay/${token}`,
    qrPayload:
      row.channel === 'qris'
        ? buildQrisPayload({
            merchantName: 'Restoran Nusantara',
            merchantCity: 'JAKARTA',
            amount: row.amount,
            reference: row.reference_id,
          })
        : null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Webhook handler (idempotent)                                          */
/* ------------------------------------------------------------------ */

export interface WebhookResult {
  received: boolean;
  duplicate: boolean;
  signatureValid: boolean;
  status: string;
  message: string;
  refType?: string;
  refId?: string;
}

export function handleWebhook(payload: WebhookPayload, signature: string | null): WebhookResult {
  const db = getDb();
  const valid = verifySignature(payload, signature);

// Idempotensi HANYA berlaku untuk webhook yang signature-nya valid DAN sudah
  // diproses. Jika tidak, siapa pun bisa "membekukan" external_id dengan
  // mengirim webhook palsu sehingga pembayaran sah ikut ter blokir (DoS).
  const existing = db
    .prepare(
      `SELECT id FROM payment_webhooks
       WHERE provider = ? AND external_id = ? AND event_type = ?
         AND signature_valid = 1 AND processed = 1`
    )
    .get(payload.provider, payload.externalId, payload.eventType) as { id: string } | undefined;

  if (existing) {
    return {
      received: true,
      duplicate: true,
      signatureValid: true,
      status: 'already_processed',
      message: 'Webhook duplikat diabaikan (idempotensi).',
    };
  }

  const webhookId = `wh-${crypto.randomUUID().slice(0, 10)}`;
  const payment = db
    .prepare('SELECT id, order_id, amount, status FROM payments WHERE reference_id = ?')
    .get(payload.externalId) as
    | { id: string; order_id: string | null; amount: number; status: string }
    | undefined;

  db.prepare(
    `INSERT INTO payment_webhooks (id, provider, external_id, event_type, order_id, signature_valid, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    webhookId,
    payload.provider,
    payload.externalId,
    payload.eventType,
    payment?.order_id ?? null,
    valid ? 1 : 0,
    JSON.stringify(payload),
    nowISO()
  );

  if (!valid) {
    return {
      received: true,
      duplicate: false,
      signatureValid: false,
      status: 'rejected',
      message: 'Signature tidak cocok — webhook ditolak.',
    };
  }

  if (!payment) {
    return {
      received: true,
      duplicate: false,
      signatureValid: true,
      status: 'unknown_reference',
      message: `Transaksi ${payload.externalId} tidak dikenal.`,
    };
  }

  const success = ['capture', 'settlement'].includes(payload.transactionStatus);
  const failed = ['deny', 'cancel', 'expire'].includes(payload.transactionStatus);

  if (payment.status === 'paid' || payment.status === 'failed') {
    db.prepare('UPDATE payment_webhooks SET processed = 1 WHERE id = ?').run(webhookId);
    return {
      received: true,
      duplicate: false,
      signatureValid: true,
      status: 'already_settled',
      message: 'Pembayaran sudah diproses sebelumnya.',
    };
  }

  if (success) {
    db.transaction(() => {
      db.prepare('UPDATE payments SET status = ?, paid_at = ? WHERE id = ?').run('success', nowISO(), payment.id);

      const bookingRef = db
        .prepare('SELECT id, booking_code FROM bookings WHERE booking_code = ?')
        .get(payload.externalId) as { id: string; booking_code: string } | undefined;

      if (bookingRef) {
        payDeposit(bookingRef.id, 'qris');
      } else if (payment.order_id) {
        //(method non-tunai tidak memerlukan nominal uang diterima)
        payExistingOrder(payment.order_id, 'qris');
      }
    })();

    notifyPaymentReceived({
      externalId: payload.externalId,
      amount: payment.amount,
      refType: 'payment',
      refId: payload.externalId,
    });

    publish('payment', {
      action: 'settled',
      externalId: payload.externalId,
      amount: payment.amount,
      orderId: payment.order_id,
    });

    db.prepare('UPDATE payment_webhooks SET processed = 1 WHERE id = ?').run(webhookId);

    return {
      received: true,
      duplicate: false,
      signatureValid: true,
      status: 'paid',
      message: `Pembayaran ${formatIDR(payment.amount)} berhasil dikonfirmasi.`,
      refType: 'order',
      refId: payload.externalId,
    };
  }

  if (failed) {
    db.prepare('UPDATE payments SET status = ? WHERE id = ?').run('failed', payment.id);
    publish('payment', { action: 'failed', externalId: payload.externalId });

    return {
      received: true,
      duplicate: false,
      signatureValid: true,
      status: 'failed',
      message: `Pembayaran gagal (${payload.transactionStatus}).`,
      refType: 'order',
      refId: payload.externalId,
    };
  }

  return {
    received: true,
    duplicate: false,
    signatureValid: true,
    status: 'pending',
    message: 'Pembayaran masih diproses gateway.',
    refType: 'order',
    refId: payload.externalId,
  };
}

/** Laporan transaksi gateway + webhook untuk audit. */
export function paymentReport() {
  const db = getDb();
  const payments = db
    .prepare(
      `SELECT id, method, amount, reference_id AS referenceId, status, channel,
              created_at AS createdAt, paid_at AS paidAt, expires_at AS expiresAt
       FROM payments ORDER BY created_at DESC LIMIT 50`
    )
    .all();

  const webhooks = db
    .prepare(
      `SELECT id, provider, external_id AS externalId, event_type AS eventType,
              signature_valid AS signatureValid, processed, created_at AS createdAt
       FROM payment_webhooks ORDER BY created_at DESC LIMIT 50`
    )
    .all();

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'success' THEN amount END), 0) AS paid,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'failed'  THEN amount END), 0) AS failed,
         COUNT(*) AS total
       FROM payments`
    )
    .get() as { paid: number; pending: number; failed: number; total: number };

  const byMethod = db
    .prepare(
      `SELECT method, COUNT(*) AS total, SUM(amount) AS amount FROM payments GROUP BY method ORDER BY amount DESC`
    )
    .all() as { method: string; total: number; amount: number }[];

  return { payments, webhooks, totals, byMethod };
}