import { getDb } from '@/server/db/client';
import { handler, ok, requireUser } from '@/server/http/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/audit-logs — jejak audit untuk administrator.
 *
 * Mencatat: login, penyesuaian stok, pembuatan pembayaran, ekspor laporan,
 * dan laporan harian terjadwal.
 */
export const GET = handler(async (req: Request) => {
  await requireUser('admin');

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Number(searchParams.get('limit') ?? 150));
  const action = searchParams.get('action');

  const db = getDb();
  const where = action ? 'WHERE a.action = ?' : '';
  const params = action ? [action] : [];

  const logs = db
    .prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.ip_address AS ipAddress,
              a.created_at AS createdAt, u.username, u.full_name AS fullName
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(...params, limit);

  const stats = db
    .prepare('SELECT action, COUNT(*) AS total FROM audit_logs GROUP BY action ORDER BY total DESC')
    .all() as { action: string; total: number }[];

  return ok({ logs, stats });
});