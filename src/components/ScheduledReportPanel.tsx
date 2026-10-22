'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Eye, Mail, RefreshCw, TrendingUp } from 'lucide-react';
import { Card, Modal, Toast } from './ui';
import { Api, ApiRequestError } from '@/lib/api';
import { formatDateTime, formatIDR } from '@/lib/utils';

interface DailyReport {
  date: string;
  generatedAt: string;
  omzet: number;
  transaksi: number;
  rataRataTransaksi: number;
  itemTerjual: number;
  produkTerlaris: { name: string; qty: number; revenue: number }[];
  metodeBayar: { method: string; count: number; total: number }[];
  reservasi: { total: number; confirmed: number; cancelled: number; deposit: number };
  snapshot: { taxPayable: number; netIncome: number; cashBalance: number; inventoryValue: number };
  highlights: string[];
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  debit: 'Kartu Debit',
  credit: 'Kartu Kredit',
  transfer: 'Virtual Account',
  '-': 'Belum bayar',
};

/**
 * Panel "Laporan Penjualan Harian" — embody the cron job.
 * Manajer dapat melihat pratinjau laporan, menjalankannya manual, dan melihat
 * riwayat laporan yang pernah dibuat (otomatis oleh cron di produksi).
 */
export function ScheduledReportPanel() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [history, setHistory] = useState<{ period: string; omzet: number; transaksi: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await Api.get<DailyReport>('/cron/daily-report?preview=1');
      setReport(data);
      const list = await Api.get<{ dailySummaries?: { period: string; omzet: number; transaksi: number }[] }>(
        '/reports/export'
      ).catch(() => null);
      setHistory(list?.dailySummaries ?? []);
    } catch {
      /* biarkan panel kosong bila endpoint tidak tersedia */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 2600);
  }

  async function runNow() {
    setBusy(true);
    try {
      // Pemanggilan dari browser memakai sesi manager; endpoint cron sendiri
      // juga menerima shared secret untuk scheduler eksternal.
      const res = await fetch('/api/v1/cron/daily-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as { success: boolean; data?: { created: boolean; message: string } };
      flash(json.data?.message ?? (json.success ? 'Laporan dibuat' : 'Gagal membuat laporan'));
      setOpen(false);
      await load();
    } catch (error) {
      flash(error instanceof ApiRequestError ? error.message : 'Gagal menjalankan laporan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="mt-4 border-brand-200 bg-brand-50/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-600 p-2.5">
              <CalendarClock className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Laporan Penjualan Harian (Terjadwal)</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Dihasilkan otomatis setiap pukul 23:00 oleh cron job, lalu dikirim ke manager via email.
                Saat ini dapat dijalankan manual untuk demonstrasi.
              </p>
              {report && (
                <p className="mt-2 text-xs font-semibold text-slate-700">
                  Omzet hari ini {formatIDR(report.omzet)} · {report.transaksi} transaksi
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setOpen(true)} className="btn-outline">
              <Eye className="h-4 w-4" /> Pratinjau Laporan
            </button>
            <button onClick={runNow} disabled={busy} className="btn-primary">
              {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Jalankan Sekarang
            </button>
          </div>
        </div>

        {history.length > 0 && (
          <div className="mt-4 border-t border-brand-200 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Riwayat laporan terjadwal
            </p>
            <div className="flex flex-wrap gap-2">
              {history.map((h) => (
                <span
                  key={h.period}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-brand-200"
                >
                  {h.period} · {formatIDR(h.omzet)} · {h.transaksi} trx
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Laporan Penjualan Harian" wide>
        {report ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Omzet" value={formatIDR(report.omzet)} tone="green" />
              <Stat label="Transaksi" value={String(report.transaksi)} tone="blue" />
              <Stat label="Rata-rata" value={formatIDR(report.rataRataTransaksi)} tone="violet" />
              <Stat label="Item terjual" value={String(report.itemTerjual)} tone="slate" />
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Ringkasan</p>
              <ul className="space-y-1.5">
                {report.highlights.map((h, i) => (
                  <li
                    key={i}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                      h.startsWith('PERINGATAN')
                        ? 'bg-rose-50 text-rose-700'
                        : h.includes('Turun')
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-slate-50 text-slate-700'
                    }`}
                  >
                    {h.startsWith('PERINGATAN') ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : h.includes('Naik') ? (
                      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    {h}
                  </li>
                ))}
              </ul>
            </div>

            {report.produkTerlaris.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  5 Menu Terlaris
                </p>
                <table className="w-full">
                  <tbody className="divide-y divide-slate-100">
                    {report.produkTerlaris.map((p, i) => (
                      <tr key={p.name}>
                        <td className="td !py-2 w-8 text-slate-400">{i + 1}</td>
                        <td className="td !py-2">{p.name}</td>
                        <td className="td !py-2 text-right">{p.qty}×</td>
                        <td className="td !py-2 text-right font-semibold">{formatIDR(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Metode Pembayaran</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {report.metodeBayar.map((m) => (
                  <div key={m.method} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-600">{METHOD_LABEL[m.method] ?? m.method}</span>
                    <span className="font-bold">{formatIDR(m.total)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Posisi Keuangan</p>
                <ul className="mt-2 space-y-1 text-sm">
                  <Row label="PPN terutang" value={formatIDR(report.snapshot.taxPayable)} />
                  <Row label="Laba bersih" value={formatIDR(report.snapshot.netIncome)} />
                  <Row label="Kas & Bank" value={formatIDR(report.snapshot.cashBalance)} />
                  <Row label="Nilai persediaan" value={formatIDR(report.snapshot.inventoryValue)} />
                </ul>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reservasi</p>
                <ul className="mt-2 space-y-1 text-sm">
                  <Row label="Total reservasi" value={String(report.reservasi.total)} />
                  <Row label="Terkonfirmasi" value={String(report.reservasi.confirmed)} />
                  <Row label="Dibatalkan" value={String(report.reservasi.cancelled)} />
                  <Row label="Deposit diterima" value={formatIDR(report.reservasi.deposit)} />
                </ul>
              </div>
            </div>

            <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <Mail className="h-3.5 w-3.5" />
              Laporan ini otomatis dikirim ke manager@resto.test setelah dijalankan
            </p>

            <div className="text-[11px] text-slate-400">
              Dibuat {formatDateTime(report.generatedAt)} · Endpoint: POST /api/v1/cron/daily-report
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">Memuat laporan…</p>
        )}
      </Modal>

      <Toast message={toast} />
    </>
  );
}

const TONE_CLASS: Record<string, string> = {
  green: 'text-emerald-600',
  blue: 'text-sky-600',
  violet: 'text-violet-600',
  slate: 'text-slate-700',
};

function Stat({ label, value, tone }: { label: string; value: string; tone: 'green' | 'blue' | 'violet' | 'slate' }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-base font-extrabold ${TONE_CLASS[tone]}`}>{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </li>
  );
}