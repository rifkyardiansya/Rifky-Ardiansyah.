import { getDb, nowISO } from '@/server/db/client';
import { ApiError, handler, ok, requireUser } from '@/server/http/api';
import {
  PAYMENT_METHODS,
  createPayment,
  getPaymentByToken,
  handleWebhook,
  paymentReport,
  webhookSchema,
} from '@/server/services/payment.service';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/v1/payment — daftar metode pembayaran + riwayat transaksi gateway.
 * POST /api/v1/payment — membuat permintaan pembayaran (payment intent).
 */
export const GET = handler(async () => {
  await requireUser('cashier');
  return ok({
    methods: Object.entries(PAYMENT_METHODS).map(([key, spec]) => ({
      code: key,
      channel: spec.channel,
      label: spec.label,
      fee: spec.fee,
      instant: spec.instant,
    })),
    ...paymentReport(),
  });
});

export const POST = handler(async (req: Request) => {
  const body = (await req.json()) as { refType?: string; refId?: string; method?: string };
  const refType = body.refType === 'booking' ? 'booking' : 'order';
  const method = (body.method ?? 'qris') as keyof typeof PAYMENT_METHODS;

  if (refType === 'order') {
    // pembayaran mandiri minimal butuh sesi kasir (dibayar di outlet)
    await requireUser('cashier');
  }

  const intent = createPayment({ refType, refId: String(body.refId ?? ''), method });

  getDb()
    .prepare(
      `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip_address, created_at)
       VALUES (?, NULL, 'CREATE_PAYMENT', 'payments', ?, 'local', ?)`
    )
    .run(`aud-${crypto.randomUUID().slice(0, 8)}`, intent.externalId, nowISO());

  return ok(intent, { status: 201 });
});

