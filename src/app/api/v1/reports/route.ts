export const dynamic = 'force-dynamic';

﻿import { ApiError, handler, ok, requireUser } from '@/server/http/api';
import {
  balanceSheet,
  buildSnapshot,
  cashFlow,
  generalLedger,
  inventoryValuation,
  profitAndLoss,
  salesReport,
  taxReport,
  trialBalance,
} from '@/server/services/report.service';

/**
 * GET /api/v1/reports?type=...
 * Semua laporan dihitung ulang dari tabel ledger_entries (double-entry),
 * sehingga antar laporan selalu konsisten dan dapat diaudit.
 */
export const GET = handler(async (req: Request) => {
  await requireUser('manager');

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'dashboard';

  switch (type) {
    case 'pnl':
      return ok(profitAndLoss());
    case 'balance-sheet':
      return ok(balanceSheet());
    case 'cash-flow':
      return ok(cashFlow());
    case 'sales':
      return ok(salesReport());
    case 'tax':
      return ok({ rows: taxReport() });
    case 'ledger':
      return ok(generalLedger(Number(searchParams.get('limit') ?? 200)));
    case 'valuation':
      return ok(inventoryValuation((searchParams.get('method') as 'fifo' | 'lifo' | 'average') ?? 'average'));
    case 'trial-balance':
      return ok(trialBalance());
    case 'dashboard':
      return ok(buildSnapshot());
    default:
      throw new ApiError(422, `Jenis laporan "${type}" tidak dikenal.`);
  }
});