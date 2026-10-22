import { handler, ok, requireUser } from '@/server/http/api';
import { listNotifications, notificationStats, sendNotification } from '@/server/services/notification.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** GET /api/v1/notifications — outbox pesan (email/SMS/WA) beserta statistiknya. */
export const GET = handler(async () => {
  await requireUser('manager');
  return ok({ notifications: listNotifications(100), stats: notificationStats() });
});

/** POST /api/v1/notifications — kirim pesan uji (untuk demo & validasi template). */
export const POST = handler(async (req: Request) => {
  await requireUser('manager');
  const body = z
    .object({
      code: z.string().min(2),
      to: z.string().min(3),
      vars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    })
    .parse(await req.json());

  return ok(sendNotification({ code: body.code, to: body.to, vars: body.vars ?? {} }), { status: 201 });
});