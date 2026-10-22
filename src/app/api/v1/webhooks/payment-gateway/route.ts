import { handler, ok } from '@/server/http/api';
import { RATE_LIMITS, clientKey, rateLimit } from '@/server/http/rate-limit';
import { buildSignature, handleWebhook, webhookSchema } from '@/server/services/payment.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/payment-gateway
 * Endpoint callback yang dipanggil provider (Midtrans Snap / Xendit Invoice).
 *
 * 1. Dibatasi laju agar tidak menjadi sasaran flood.
 * 2. Signature diverifikasi (HMAC-SHA512) — request palsu langsung ditolak.
 * 3. Idempotensi — callback ganda tidak menyebabkan pembayaran terduplikasi.
 * 4. Status order/pembayaran diperbarui dalam satu transaksi database.
 */
export const POST = handler(async (req: Request) => {
  const limit = await rateLimit(clientKey(req, 'webhook'), RATE_LIMITS.webhook);
  if (!limit.allowed) {
    return ok(
      { received: false, message: 'Rate limit tercapai.' },
      { status: 429 }
    );
  }

  const payload = webhookSchema.parse(await req.json());
  const signature =
    req.headers.get('x-webhook-signature') ??
    req.headers.get('x-signature') ??
    req.headers.get('x-midtrans-signature');

  const result = handleWebhook(payload, signature);
  return ok(result, { status: result.signatureValid ? 200 : 401 });
});

/** Helper untuk simulasi: mengembalikan signature yang valid untuk payload demo. */
export const GET = handler(async () => {
  const sample = webhookSchema.parse({
    provider: 'midtrans',
    externalId: 'TRX-DEMO',
    eventType: 'payment',
    transactionStatus: 'capture',
    amount: 100000,
  });
  return ok({ payload: sample, signature: buildSignature(sample) });
});