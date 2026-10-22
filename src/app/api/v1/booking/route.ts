export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';
import { bookingSchema, createBooking, depositConfig } from '@/server/services/booking.service';

/**
 * POST /api/v1/booking — buat reservasi (publik, form customer).
 * GET  /api/v1/booking?code=xxx — cek status reservasi (publik via kode).
 */
export const POST = handler(async (req: Request) => {
  const body = bookingSchema.parse(await req.json());
  return ok(createBooking(body), { status: 201 });
});

export const GET = handler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const db = getDb();

  if (code) {
    const booking = db
      .prepare(
        `SELECT id, booking_code AS bookingCode, guest_name AS guestName, guest_phone AS guestPhone,
                guest_email AS guestEmail, party_size AS partySize, booking_date AS date,
                time_slot AS timeSlot, table_no AS tableNo, deposit_status AS depositStatus,
                deposit_amount AS depositAmount, deposit_method AS depositPaymentMethod,
                status, qr_token AS qrToken, special_requests AS specialRequests, created_at AS createdAt
         FROM bookings WHERE booking_code = ?`
      )
      .get(code.toUpperCase()) as Record<string, unknown> | undefined;

    return ok({ booking: booking ?? null, depositConfig: depositConfig() }, { status: booking ? 200 : 404 });
  }

  const bookings = db
    .prepare(
      `SELECT id, booking_code AS bookingCode, guest_name AS guestName, guest_phone AS guestPhone,
              guest_email AS guestEmail, party_size AS partySize, booking_date AS date,
              time_slot AS timeSlot, table_id AS tableId, table_no AS tableNo,
              deposit_amount AS depositAmount, deposit_status AS depositStatus,
              deposit_method AS depositPaymentMethod, special_requests AS specialRequests,
              status, qr_token AS qrToken, created_at AS createdAt
       FROM bookings ORDER BY created_at DESC`
    )
    .all();

  return ok({ bookings, depositConfig: depositConfig() });
});