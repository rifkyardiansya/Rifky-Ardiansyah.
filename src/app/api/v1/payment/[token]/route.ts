import { ApiError } from '@/server/http/api';
import { handler, ok } from '@/server/http/api';
import { getPaymentByToken } from '@/server/services/payment.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/payment/:token — status pembayaran untuk halaman gateway. */
export const GET = handler(async (_req: Request, { params }: { params: { token: string } }) => {
  const intent = getPaymentByToken(params.token);
  if (!intent) throw new ApiError(404, 'Transaksi pembayaran tidak ditemukan atau kedaluwarsa.');
  return ok(intent);
});