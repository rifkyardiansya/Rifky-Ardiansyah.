export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { z } from 'zod';
import { getDb, nowISO } from '@/server/db/client';
import { handler, ok, requireUser } from '@/server/http/api';
import { buildSnapshot } from '@/server/services/report.service';

/**
 * POST /api/v1/reports/export
 * Men-generate laporan dan menyimpannya ke tabel financial_reports
 * (audit trail laporan) — ditambah: seluruh laporan yang pernah dibuat.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser('manager');
  const body = z
    .object({
      reportType: z.enum(['pnl', 'balance-sheet', 'cash-flow', 'sales', 'tax', 'ledger', 'valuation']),
      period: z.string().min(4, 'Periode laporan wajib diisi'),
      format: z.enum(['pdf', 'excel', 'csv']).default('pdf'),
    })
    .parse(await req.json());

  const db = getDb();
  const id = `fr-${crypto.randomUUID().slice(0, 8)}`;
  const snapshot = buildSnapshot();
  const generatedAt = nowISO();

  db.prepare(
    `INSERT INTO financial_reports (id, report_type, period, generated_at, status, data_json)
     VALUES (?, ?, ?, ?, 'generated', ?)`
  ).run(id, body.reportType, body.period, generatedAt, JSON.stringify(snapshot));

  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, ip_address, created_at)
     VALUES (?, ?, 'EXPORT_REPORT', 'financial_reports', ?, 'local', ?)`
  ).run(`aud-${crypto.randomUUID().slice(0, 8)}`, user.id, id, generatedAt);

  return ok({ id, ...body, generatedAt, snapshot }, { status: 201 });
});

/** GET /api/v1/reports/export — riwayat laporan yang pernah diekspor/dijadwalkan. */
export const GET = handler(async () => {
  await requireUser('manager');
  const db = getDb();
  const history = db
    .prepare(
      `SELECT fr.id, fr.report_type AS reportType, fr.period, fr.generated_at AS generatedAt,
              fr.status, u.username AS requestedBy
       FROM financial_reports fr LEFT JOIN audit_logs a ON a.entity_id = fr.id
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY fr.generated_at DESC LIMIT 50`
    )
    .all();

  // Ringkasan harian hasil cron job
  const dailySummaries = db
    .prepare(
      `SELECT period, data_json FROM financial_reports
       WHERE report_type = 'daily-summary' ORDER BY generated_at DESC LIMIT 30`
    )
    .all() as { period: string; data_json: string }[];

  const summaries = dailySummaries.map((row) => {
    try {
      const parsed = JSON.parse(row.data_json) as { omzet?: number; transaksi?: number };
      return {
        period: row.period,
        omzet: parsed.omzet ?? 0,
        transaksi: parsed.transaksi ?? 0,
      };
    } catch {
      return { period: row.period, omzet: 0, transaksi: 0 };
    }
  });

  return ok({ history, dailySummaries: summaries });
});