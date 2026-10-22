import { getQueue, registerJob, runJobInline, type EnqueueOptions } from './queue';
import { getScheduler, type Schedule } from './scheduler';
import { generateAndDispatchDailyReport } from '../services/schedule.service';
import { retryQueuedNotifications } from '../services/notification.service';
import { todayISO } from '../db/client';

/**
 * Katalog job aplikasi.
 *
 * Semua pekerjaan berat dijalankan lewat antrean sehingga request HTTP tidak
 * menunggu laporan harian dibuat atau notifikasi dikirim ulang. File ini
 * berisi *handler*-nya; kapan job berjalan ada di `scheduler.ts`.
 */

export const JOB_DAILY_REPORT = 'daily-report';
export const JOB_NOTIFICATION_RETRY = 'notification-retry';

/** Laporan penjualan harian. Idempotent per tanggal. */
export interface DailyReportJob {
  date?: string;
}

/** Worker outbox: kirim ulang notifikasi yang menggantung di status `queued`. */
export interface NotificationRetryJob {
  limit?: number;
}

let registered = false;

/**
 * Mendaftarkan seluruh handler. Aman dipanggil berulang kali karena registry
 * proses bersifat idempotent.
 */
export function registerJobs(): void {
  if (registered) return;
  registered = true;

  registerJob<DailyReportJob>(JOB_DAILY_REPORT, (job) => generateAndDispatchDailyReport(job.data.date));

  registerJob<NotificationRetryJob>(JOB_NOTIFICATION_RETRY, (job) =>
    retryQueuedNotifications(job.data.limit ?? 50)
  );
}

/** Schedule bawaan yang dijalankan worker setiap hari / berkala. */
export function defaultSchedules(): Schedule[] {
  return [
    // Laporan penjualan harian pukul 23:00 WIB — menggantikan cron eksternal.
    { name: JOB_DAILY_REPORT, atHour: 23, payload: {} },
    // Outbox dibersihkan tiap 5 menit agar notifikasi tidak menggantung bila
    // proses mati tepat di tengah pengiriman.
    { name: JOB_NOTIFICATION_RETRY, everyMs: 5 * 60 * 1000, payload: {} },
  ];
}

/** Mendaftarkan handler + schedule default ke penjadwal proses ini. */
export function bootstrapQueue(): void {
  registerJobs();
  const scheduler = getScheduler();
  for (const schedule of defaultSchedules()) scheduler.register(schedule);
}

/** Hasil `generateAndDispatchDailyReport` yang diteruskan ke pemanggil job. */
export interface DailyReportOutcome {
  report: unknown;
  created: boolean;
  id: string;
  message: string;
}

export type DailyReportJobResult =
  | ({ queued: true; jobId: string; date: string } & Partial<DailyReportOutcome>)
  | ({ queued: false } & DailyReportOutcome);

/**
 * Menjalankan job "laporan harian" untuk sebuah tanggal.
 *
 * - `inline` (default): job dieksekusi di proses ini memakai pipeline yang sama
 *   dengan worker, sehingga endpoint cron tetap sinkron tanpa Redis.
 * - `queued`: job cukup diantrekan; hasilnya dibaca worker dari
 *   `financial_reports` (idempotent per tanggal).
 */
export async function runDailyReportJob(
  date?: string,
  options: EnqueueOptions = { inline: true }
): Promise<DailyReportJobResult> {
  const payload: DailyReportJob = { date: date ?? todayISO() };

  if (!options.inline) {
    const job = await getQueue().enqueue<DailyReportJob>(JOB_DAILY_REPORT, payload, {
      maxAttempts: 3,
    });
    return { queued: true, jobId: job.id, date: payload.date as string };
  }

  const result = await runJobInline<DailyReportJob>(JOB_DAILY_REPORT, payload, options.maxAttempts ?? 1);

  // Kegagalan inline tidak boleh menjadi 200 dengan data kosong — pemanggil
  // (endpoint cron) harus tahu pekerjaannya gagal.
  if (result.status === 'failed') {
    throw new Error(`Job laporan harian gagal: ${result.error ?? 'tidak diketahui'}`);
  }

  return { queued: false, ...(result.output as DailyReportOutcome) };
}

/** Menjalankan job outbox notifikasi (dipakai worker dan test). */
export function runNotificationRetryJob(limit = 50) {
  return runJobInline<NotificationRetryJob>(JOB_NOTIFICATION_RETRY, { limit });
}
