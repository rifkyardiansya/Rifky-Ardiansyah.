import { handler, ok } from '@/server/http/api';
import { buildSignature, webhookSchema } from '@/server/services/payment.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/payment-gateway/sign
 *
 * Endpoint bantu untuk simulasi gateway. Pada implementasi nyata, signature
 * hanya diketahui oleh provider — tidak pernah diekspos ke merchant/client.
 * Endpoint ini ada agar demo dapat memverifikasi alur HMAC tanpa hardcode.
 */
export const POST = handler(async (req: Request) => {
  const payload = webhookSchema.parse(await req.json());
  return ok({ payload, signature: buildSignature(payload) });
});