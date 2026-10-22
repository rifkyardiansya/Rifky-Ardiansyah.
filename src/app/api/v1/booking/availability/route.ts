export const dynamic = 'force-dynamic';

import { getDb } from '@/server/db/client';
import { handler, ok } from '@/server/http/api';
import { availability, depositConfig } from '@/server/services/booking.service';

const SLOTS = ['11:00 - 13:00', '13:00 - 15:00', '15:00 - 17:00', '17:00 - 19:00', '19:00 - 21:00'];

/** GET /api/v1/booking/availability?date=&partySize= — cek ketersediaan meja. */
export const GET = handler(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const partySize = Number(searchParams.get('partySize') ?? 2);

  return ok({
    ...availability(date, partySize, SLOTS),
    slots: SLOTS,
    depositConfig: depositConfig(),
  });
});