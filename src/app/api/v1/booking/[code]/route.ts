export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { ApiError, handler, ok, requireUser } from '@/server/http/api';
import { updateBookingStatus } from '@/server/services/booking.service';

/** GET /api/v1/booking/:code — detail reservasi (untuk QR check-in). */
export const GET = handler(async (req: Request, { params }: { params: { code: string } }) => {
  const db = getDb();
  const booking = db
    .prepare(
      `SELECT id, booking_code AS bookingCode, guest_name AS guestName, guest_phone AS guestPhone,
              guest_email AS guestEmail, party_size AS partySize, booking_date AS date,
              time_slot AS timeSlot, table_no AS tableNo, deposit_status AS depositStatus,
              deposit_amount AS depositAmount, status, qr_token AS qrToken,
              special_requests AS specialRequests, created_at AS createdAt
       FROM bookings WHERE booking_code = ?`
    )
    .get(params.code.toUpperCase()) as Record<string, unknown> | undefined;

  if (!booking) throw new ApiError(404, 'Reservasi tidak ditemukan.');

  const qr = new URL(req.url).searchParams.get('checkin') === '1';
  if (qr) {
    // QR check-in:emarksi diubah menjadi "sudah check-in" (butuh role kasir/ke atas).
    const user = await requireUser('cashier');
    void user;
    updateBookingStatus(String(booking.id), 'checked_in');
    return ok({ booking: { ...booking, status: 'checked_in' }, checkedIn: true });
  }

  return ok({ booking });
});

/** PATCH /api/v1/booking/:code — ubah status (check-in / pembatalan). */
export const PATCH = handler(async (req: Request, { params }: { params: { code: string } }) => {
  await requireUser('cashier');
  const { status } = z
    .object({ status: z.enum(['pending_payment', 'confirmed', 'checked_in', 'cancelled']) })
    .parse(await req.json());

  const row = getDb()
    .prepare('SELECT id FROM bookings WHERE booking_code = ?')
    .get(params.code.toUpperCase()) as { id: string } | undefined;
  if (!row) throw new ApiError(404, 'Reservasi tidak ditemukan.');

  return ok(updateBookingStatus(row.id, status));
});