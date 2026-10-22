export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { ApiError, handler, ok, requireUser } from '@/server/http/api';
import { payDeposit, updateBookingStatus } from '@/server/services/booking.service';

function findBookingId(code: string) {
  const row = getDb().prepare('SELECT id FROM bookings WHERE booking_code = ?').get(code.toUpperCase()) as
    | { id: string }
    | undefined;
  if (!row) throw new ApiError(404, 'Reservasi tidak ditemukan.');
  return row.id;
}

/** POST /api/v1/booking/:code/payment — penerimaan deposit reservasi. */
export const POST = handler(async (req: Request, { params }: { params: { code: string } }) => {
  const body = z.object({ method: z.enum(['cash', 'qris', 'debit', 'credit']) }).parse(await req.json());
  return ok(payDeposit(findBookingId(params.code), body.method));
});

/** PATCH /api/v1/booking/:code/payment — refund deposit (pembatalan). */
export const PATCH = handler(async (req: Request, { params }: { params: { code: string } }) => {
  await requireUser('cashier');
  return ok(updateBookingStatus(findBookingId(params.code), 'cancelled'));
});