import crypto from 'node:crypto';
import { z } from 'zod';
import { handler, ok } from '@/server/http/api';
import { hasRole, getSessionUser } from '@/server/auth/token';
import {
  buildDailyReport,
  listGeneratedReports,
} from '@/server/services/schedule.service';
import { bootstrapQueue, runDailyReportJob } from '@/server/queue/jobs';
import { hasLiveWorker } from '@/server/queue/queue';
import { getRedis } from '@/server/infra/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Endpoint laporan harian — sekarang dieksekusi lewat **antrean job** (Phase 6).
 *
 * Contoh pemanggilan dari scheduler:
 *   0 23 * * *  curl -X POST https://app/api/v1/cron/daily-report \
 *                    -H "Authorization: Bearer $CRON_SECRET"
 *
 * Masih diperlukan sebagai pemicu manual (dari UI atau cron lama), namun
 * pekerjaan sudah tidak wajib cron: `npm run worker` menjalankan schedule
 * "laporan harian" sendiri setiap pukul 23:00 WIB.
 *
 * Perilaku:
 *  - ada worker hidup di Redis  → job diantrekan, respons 202
 *  - tidak ada worker / tanpa Redis → job dieksekusi inline, respons 200
 *    dengan hasil lengkap (perilaku lama, dipakai smoke test)
 *
 * Idempotent per tanggal, sehingga pemicu ganda tidak mengirim notifikasi ganda.
 */
const CRON_SECRET = process.env.CRON_SECRET ?? 'dev-cron-secret';

async function authorized(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers.get('x-cron-secret');

  if (token) {
    const a = Buffer.from(token);
    const b = Buffer.from(CRON_SECRET);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }

  // Izinkan manager/admin yang sedang login (menjalankan manual dari UI)
  const user = await getSessionUser();
  return hasRole(user, 'manager');
}

export const POST = handler(async (req: Request) => {
  if (!(await authorized(req))) {
    return ok(
      { error: 'Unauthorized — butuh header Authorization: Bearer <CRON_SECRET> atau sesi manager.' },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { date } = z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .parse(body ?? {});

  bootstrapQueue();
  const redis = getRedis();
  const useWorker = redis ? await hasLiveWorker(redis) : false;

  const result = await runDailyReportJob(date, { inline: !useWorker, maxAttempts: 1 });
  return ok(result, { status: useWorker ? 202 : 200 });
});

/** GET — pratinjau laporan tanpa menyimpan, atau daftar riwayat bila punya akses. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);

  if (url.searchParams.get('preview') === '1') {
    return ok(buildDailyReport(url.searchParams.get('date') ?? undefined));
  }

  if (!(await authorized(req))) {
    return ok({ error: 'Unauthorized' }, { status: 401 });
  }

  return ok(listGeneratedReports());
});