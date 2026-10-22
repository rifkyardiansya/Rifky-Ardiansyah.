'use client';

import { useMemo, useState } from 'react';
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  Landmark,
  PieChart,
  Printer,
  ScrollText,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { ScheduledReportPanel } from '@/components/ScheduledReportPanel';
import { Badge, Card, EmptyState, StatCard } from '@/components/ui';
import { useStore } from '@/lib/store';
import {
  buildSnapshot,
  PAYMENT_LABEL,
  revenueByDay,
  revenueByPaymentMethod,
  salesByCashier,
  topProducts,
} from '@/lib/analytics';
import { formatDate, formatIDR } from '@/lib/utils';

const PIE_COLORS = ['#f97316', '#0ea5e9', '#8b5cf6', '#10b981', '#f43f5e', '#f59e0b'];

/** Batas baris yang dirender tabel buku besar. */
const LEDGER_ROWS_SHOWN = 200;

export default function ReportsPage() {
  const { ledger, rawMaterials, orders, menuItems } = useStore();
  const [tab, setTab] = useState<'ringkasan' | 'pl' | 'neraca' | 'kas' | 'penjualan' | 'buku-besar' | 'ppn'>('ringkasan');

  const snapshot = useMemo(() => buildSnapshot(ledger, rawMaterials), [ledger, rawMaterials]);

  /**
   * Buku besar menampilkan N baris terbaru saja. Tanpa batas, tabel tumbuh
   * seiring pemakaian dan halaman ikut melambat — sementara total di bawah tetap
   * dihitung dari SELURUH jurnal, bukan hanya baris yang terlihat.
   */
  const recentLedger = useMemo(() => ledger.slice(-LEDGER_ROWS_SHOWN), [ledger]);
  const ledgerTotals = useMemo(
    () =>
      ledger.reduce(
        (acc, e) => ({ debit: acc.debit + e.debit, credit: acc.credit + e.credit }),
        { debit: 0, credit: 0 }
      ),
    [ledger]
  );
  const ledgerBalanced = Math.abs(ledgerTotals.debit - ledgerTotals.credit) < 1;
  const hiddenLedgerRows = Math.max(0, ledger.length - recentLedger.length);

  const daily = useMemo(() => revenueByDay(orders), [orders]);
  const byMethod = useMemo(() => revenueByPaymentMethod(orders), [orders]);
  const byCashier = useMemo(() => salesByCashier(orders), [orders]);
  const products = useMemo(() => topProducts(orders, 8), [orders]);

  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid' && o.status !== 'cancelled');
  const avgTicket = paidOrders.length ? paidOrders.reduce((s, o) => s + o.total, 0) / paidOrders.length : 0;
  const totalItemsSold = orders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0), 0);

  const taxPerMonth = useMemo(() => {
    const map = new Map<string, number>();
    paidOrders.forEach((o) => {
      const month = new Date(o.paidAt || o.createdAt).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
      map.set(month, (map.get(month) || 0) + o.tax);
    });
    return Array.from(map.entries()).map(([month, omzet]) => ({ bulan: month, ppn: omzet, dpp: omzet / 1.1 }));
  }, [paidOrders]);

  return (
    <AppShell
      title="Modul 5 — Laporan Keuangan Standar Akuntansi"
      subtitle="Laporan laba rugi, neraca saldo, arus kas, buku besar, dan pelaporan PPN — berbasis jurnal double-entry"
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Pendapatan" value={formatIDR(snapshot.revenue)} sub="Kredit akun pendapatan" icon={<TrendingUp className="h-5 w-5" />} tone="green" />
        <StatCard label="Harga Pokok (HPP)" value={formatIDR(snapshot.cogs)} sub="Dari resep bahan baku" icon={<PieChart className="h-5 w-5" />} tone="amber" />
        <StatCard label="Laba Kotor" value={formatIDR(snapshot.grossProfit)} sub={`Margin ${snapshot.grossMargin.toFixed(1)}%`} icon={<BarChart className="h-5 w-5" />} tone="blue" />
        <StatCard label="Laba Bersih" value={formatIDR(snapshot.netIncome)} sub="Setelah beban operasional" icon={<Wallet className="h-5 w-5" />} tone={snapshot.netIncome >= 0 ? 'green' : 'red'} />
        <StatCard label="Saldo Kas & Bank" value={formatIDR(snapshot.cashBalance)} sub="Aset likuid" icon={<Landmark className="h-5 w-5" />} tone="violet" />
      </div>

      <div className="my-4 flex flex-wrap gap-2">
        {[
          { key: 'ringkasan', label: 'Dashboard', icon: PieChart },
          { key: 'pl', label: 'Laba Rugi', icon: TrendingUp },
          { key: 'neraca', label: 'Neraca Saldo', icon: Landmark },
          { key: 'kas', label: 'Arus Kas', icon: Wallet },
          { key: 'penjualan', label: 'Laporan Penjualan', icon: BarChart },
          { key: 'buku-besar', label: 'Buku Besar', icon: BookOpen },
          { key: 'ppn', label: 'Laporan PPN', icon: ScrollText },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              data-testid={"report-tab-" + t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={tab === t.key ? 'btn-primary' : 'btn-outline'}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
        <button onClick={() => window.print()} className="btn-dark ml-auto">
          <Printer className="h-4 w-4" /> Cetak Laporan
        </button>
      </div>

      {tab === 'ringkasan' && <ScheduledReportPanel />}

      {/* ---------------- DASHBOARD ---------------- */}
      {tab === 'ringkasan' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Tren Penjualan 7 Hari Terakhir</p>
              {daily.length === 0 ? (
                <EmptyState title="Belum ada transaksi lunas" />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                      <Tooltip formatter={(v) => formatIDR(Number(v))} />
                      <Line type="monotone" dataKey="revenue" stroke="#ea580c" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Komposisi Pendapatan per Metode Bayar</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byMethod.map((m) => ({ name: PAYMENT_LABEL[m.method] ?? m.method, value: m.value }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      label
                    >
                      {byMethod.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatIDR(Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Ringkasan Kinerja</p>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between">
                  <span className="text-slate-500">Jumlah transaksi</span>
                  <span className="font-semibold">{paidOrders.length}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500">Rata-rata transaksi</span>
                  <span className="font-semibold">{formatIDR(avgTicket)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500">Item terjual</span>
                  <span className="font-semibold">{totalItemsSold}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500">Margin kotor</span>
                  <span className="font-semibold text-emerald-600">{snapshot.grossMargin.toFixed(1)}%</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500">Nilai persediaan</span>
                  <span className="font-semibold">{formatIDR(snapshot.inventoryValue)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500">Deposit pelanggan (liabilitas)</span>
                  <span className="font-semibold">{formatIDR(snapshot.depositLiability)}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-500">PPN terutang</span>
                  <span className="font-semibold">{formatIDR(snapshot.taxPayable)}</span>
                </li>
              </ul>
            </Card>

            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Penjualan per Sumber</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCashier}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => formatIDR(Number(v))} />
                    <Bar dataKey="revenue" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Menu Terlaris</p>
              <ul className="space-y-2">
                {products.slice(0, 6).map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-slate-600">{p.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">{p.qty}×</span>
                      <span className="font-bold text-slate-800">{formatIDR(p.revenue)}</span>
                    </div>
                  </li>
                ))}
                {products.length === 0 && <p className="text-sm text-slate-400">Belum ada data.</p>}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {/* ---------------- LABA RUGI ---------------- */}
      {tab === 'pl' && (
        <Card>
          <ReportHeader title="LAPORAN LABA RUGI" subtitle="Untuk periode berjalan" />
          <table className="w-full">
            <tbody>
              <SectionRow label="PENDAPATAN" />
              <DataRow label="Penjualan Makanan, Minuman & Paket" value={snapshot.revenue} indent />
              <DataRow label="Total Pendapatan" value={snapshot.revenue} total />
              <SectionRow label="HARGA POKOK PENJUALAN (HPP)" />
              <DataRow label="Bahan Baku Terpakai" value={snapshot.cogs} indent />
              <DataRow label="Laba Kotor" value={snapshot.grossProfit} total />
              <SectionRow label="BEBAN OPERASIONAL" />
              <DataRow label="Beban Operasional (listrik, gas,mz)" value={snapshot.operatingExpense} indent />
              <DataRow label="Laba-before pajak" value={snapshot.netIncome} total />
              <DataRow label="PPN 10% (kewajiban, bukan beban)" value={0} indent />
              <DataRow label="LABA BERSIH" value={snapshot.netIncome} total highlight />
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Catatan: PPN ({formatIDR(snapshot.taxPayable)}) merupakan kewajiban pajak, bukan beban — sehingga tidak
            mengurangi laba bersih. Rinciannya disajikan pada tab Laporan PPN.
          </p>
        </Card>
      )}

      {/* ---------------- NERACA ---------------- */}
      {tab === 'neraca' && (
        <Card>
          <ReportHeader title="NERACA SALDO" subtitle={`Per ${formatDate(new Date().toISOString())}`} />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">ASET</p>
              <table className="w-full">
                <tbody>
                  <DataRow label="Kas & Bank" value={snapshot.cashBalance} indent />
                  <DataRow label="Persediaan Bahan Baku" value={snapshot.inventoryValue} indent />
                  <DataRow label="Dana Deposit Pelanggan (terpisah)" value={snapshot.depositLiability} indent />
                  <DataRow label="TOTAL ASET" value={snapshot.totalAssets} total />
                </tbody>
              </table>
            </div>
            <div>
              <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">KEWAJIBAN & EKUITAS</p>
              <table className="w-full">
                <tbody>
                  <DataRow label="Utang PPN (Kewajiban Pajak)" value={snapshot.taxPayable} indent />
                  <DataRow label="Liabilitas Deposit Reservasi" value={snapshot.depositLiability} indent />
                  <DataRow label="TOTAL KEWAJIBAN" value={snapshot.totalLiabilities} total />
                  <DataRow label="Modal / Ekuitas Awal" value={snapshot.capital} indent />
                  <DataRow label="Laba Ditahan (Laba Bersih Periode Ini)" value={snapshot.netIncome} indent />
                  <DataRow label="TOTAL KEWAJIBAN & EKUITAS" value={snapshot.totalLiabilities + snapshot.equity} total />
                </tbody>
              </table>
            </div>
          </div>
          <div
            className={`mt-4 rounded-xl p-3 text-sm font-semibold ${
              Math.abs(snapshot.totalAssets - (snapshot.totalLiabilities + snapshot.equity)) < 1
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {Math.abs(snapshot.totalAssets - (snapshot.totalLiabilities + snapshot.equity)) < 1
              ? '✓ Neraca seimbang: Total Aset = Total Kewajiban + Ekuitas.'
              : '⚠ Neraca belum seimbang — periksa jurnal.'}
          </div>
        </Card>
      )}

      {/* ---------------- ARUS KAS ---------------- */}
      {tab === 'kas' && (
        <Card>
          <ReportHeader title="LAPORAN ARUS KAS (Metode Langsung)" subtitle="Periode berjalan" />
          <table className="w-full">
            <tbody>
              <SectionRow label="ARUS KAS DARI AKTIVITAS OPERASIONAL" />
              <DataRow label="Penerimaan dari penjualan makanan & minuman" value={snapshot.revenue} indent />
              <DataRow label="Penerimaan deposit reservasi" value={snapshot.depositReceived} indent />
              <DataRow label="Pembayaran pembelian bahan baku" value={0} indent />
              <DataRow label="Pembayaran beban operasional" value={snapshot.operatingExpense} indent />
              <DataRow label="Arus Kas Neto dari Operasional" value={snapshot.revenue + snapshot.depositReceived - snapshot.operatingExpense} total />
              <SectionRow label="ARUS KAS DARI AKTIVITAS INVESTING" />
              <DataRow label="Pembelian aset tetap / renovasi" value={0} indent />
              <DataRow label="Arus Kas Neto dari Investing" value={0} total />
              <SectionRow label="ARUS KAS DARI AKTIVITAS PENDANAAN" />
              <DataRow label="Setoran modal pemilik" value={snapshot.capital} indent />
              <DataRow label="Arus Kas Neto dari Pendanaan" value={snapshot.capital} total />
              <DataRow label="KENAIKAN KAS BERSIH" value={snapshot.cashBalance} total highlight />
              <DataRow label="Kas Awal Periode" value={0} indent />
              <DataRow label="Kas Akhir Periode" value={snapshot.cashBalance} total />
            </tbody>
          </table>
        </Card>
      )}

      {/* ---------------- PENJUALAN ---------------- */}
      {tab === 'penjualan' && (
        <div className="space-y-4">
          <Card>
            <p className="mb-3 text-sm font-bold text-slate-900">Omzet Harian</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => formatIDR(Number(v))} />
                  <Legend />
                  <Bar dataKey="revenue" name="Omzet" fill="#f97316" radius={[6, 6, 0, 0]} />
                  <Line dataKey="orders" name="Transaksi" stroke="#0ea5e9" yAxisId={0} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Penjualan per Produk</p>
              <table className="w-full">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="th">Menu</th>
                    <th className="th text-right">Qty</th>
                    <th className="th text-right">Omzet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((p) => (
                    <tr key={p.name}>
                      <td className="td">{p.name}</td>
                      <td className="td text-right">{p.qty}</td>
                      <td className="td text-right font-bold">{formatIDR(p.revenue)}</td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr>
                      <td className="td text-slate-400" colSpan={3}>
                        Belum ada penjualan.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>

            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Penjualan per Kasir & per Metode Bayar</p>
              <table className="w-full">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="th">Sumber</th>
                    <th className="th text-right">Transaksi</th>
                    <th className="th text-right">Omzet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {byCashier.map((c) => (
                    <tr key={c.name}>
                      <td className="td">{c.name}</td>
                      <td className="td text-right">{c.orders}</td>
                      <td className="td text-right font-bold">{formatIDR(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 space-y-1.5">
                {byMethod.map((m) => (
                  <div key={m.method} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-600">{PAYMENT_LABEL[m.method] ?? m.method}</span>
                    <span className="font-bold">{formatIDR(m.value)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ---------------- BUKU BESAR ---------------- */}
      {tab === 'buku-besar' && (
        <Card>
          <ReportHeader title="BUKU BESAR (GENERAL LEDGER)" subtitle="Double-entry — debit & kredit otomatis dari modul operasional" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Tanggal</th>
                  <th className="th">Keterangan</th>
                  <th className="th">Akun</th>
                  <th className="th">Referensi</th>
                  <th className="th text-right">Debit</th>
                  <th className="th text-right">Kredit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentLedger.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="td text-xs">{formatDate(e.date)}</td>
                    <td className="td text-xs">{e.description}</td>
                    <td className="td">
                      <Badge tone={accountTone(e.category)}>{e.category}</Badge>
                    </td>
                    <td className="td font-mono text-[11px] text-slate-500">{e.referenceId ?? '—'}</td>
                    <td className="td text-right font-semibold text-emerald-700">{e.debit ? formatIDR(e.debit) : '—'}</td>
                    <td className="td text-right font-semibold text-rose-600">{e.credit ? formatIDR(e.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                  <td className="td" colSpan={4}>
                    TOTAL SELURUH JURNAL ({ledger.length} baris)
                  </td>
                  <td className="td text-right">{formatIDR(ledgerTotals.debit)}</td>
                  <td className="td text-right">{formatIDR(ledgerTotals.credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {hiddenLedgerRows > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Menampilkan {LEDGER_ROWS_SHOWN} baris terbaru. {hiddenLedgerRows.toLocaleString('id-ID')} baris
              lebih lama tidak dirender, tetapi tetap dihitung pada TOTAL.
            </p>
          )}
          <div
            className={`mt-3 rounded-xl p-3 text-sm font-semibold ${
              ledgerBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {ledgerBalanced
              ? '✓ Jurnal seimbang: total debit = total kredit.'
              : '⚠ Jurnal tidak seimbang.'}
          </div>
        </Card>
      )}

      {/* ---------------- PPN ---------------- */}
      {tab === 'ppn' && (
        <div className="space-y-4">
          <Card>
            <ReportHeader title="LAPORAN PPN 10%" subtitle="Rekapitulasi PPN terutang per periode" />
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Periode</th>
                  <th className="th text-right">DPP (Nilai Jual Kena Pajak)</th>
                  <th className="th text-right">PPN Terutang (11%)</th>
                  <th className="th text-right">PPN Dibayar</th>
                  <th className="th text-right">PPN Lebih/Kurang</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taxPerMonth.map((r) => (
                  <tr key={r.bulan}>
                    <td className="td font-semibold">{r.bulan}</td>
                    <td className="td text-right">{formatIDR(r.dpp)}</td>
                    <td className="td text-right">{formatIDR(r.ppn)}</td>
                    <td className="td text-right">{formatIDR(0)}</td>
                    <td className="td text-right font-bold text-rose-600">{formatIDR(r.ppn)}</td>
                  </tr>
                ))}
                {taxPerMonth.length === 0 && (
                  <tr>
                    <td className="td text-slate-400" colSpan={5}>
                      Belum ada transaksi pada periode ini.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                  <td className="td">TOTAL</td>
                  <td className="td text-right">{formatIDR(taxPerMonth.reduce((s, r) => s + r.dpp, 0))}</td>
                  <td className="td text-right">{formatIDR(taxPerMonth.reduce((s, r) => s + r.ppn, 0))}</td>
                  <td className="td text-right">{formatIDR(0)}</td>
                  <td className="td text-right">{formatIDR(taxPerMonth.reduce((s, r) => s + r.ppn, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </Card>

          <Card>
            <p className="mb-2 text-sm font-bold text-slate-900">Catatan Standar Akuntansi</p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
              <li>Pendapatan diakui pada saat service selesai dan tagihan diterima (manufaktur jasa).</li>
              <li>PPN 10% dicatat sebagai kewajiban, bukan pengurang pendapatan maupun beban.</li>
              <li>Deposit reservasi dicatat sebagai liabilitas sampai service sudah terealisasi; jika dibatalkan sesuai kebijakan, deposit dikembalikan dan sebagian menjadi beban.</li>
              <li>HPP dihitung dengan metode moving average yang disederhanakan saat penerimaan barang (GRN).</li>
              <li>Pembatalan (void) transaksi dicatat sebagai beban operasional dan tercatat di Z-Report.</li>
            </ul>
            <div className="mt-3 flex gap-2">
              <button onClick={() => window.print()} className="btn-outline">
                <Printer className="h-4 w-4" /> Cetak PDF
              </button>
              <button onClick={() => exportCSV(ledger)} className="btn-outline">
                <FileSpreadsheet className="h-4 w-4" /> Ekspor CSV
              </button>
              <button onClick={() => exportCSV(orders.map((o) => ({
                id: o.id,
                date: o.paidAt || o.createdAt,
                description: `${o.orderNo} — ${o.tableNumber} — ${o.customerName}`,
                category: o.paymentMethod || '-',
                debit: o.total,
                credit: 0,
                referenceId: o.orderNo,
              })))} className="btn-dark">
                <Download className="h-4 w-4" /> Ekspor Penjualan
              </button>
            </div>
          </Card>

          <Card>
            <p className="mb-2 text-sm font-bold text-slate-900">Referensi Menu &amp; HPP</p>
            <table className="w-full">
              <thead className="border-b border-slate-200">
                <tr>
                  <th className="th">Menu</th>
                  <th className="th text-right">Harga Jual</th>
                  <th className="th text-right">HPP</th>
                  <th className="th text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {menuItems.map((m) => (
                  <tr key={m.id}>
                    <td className="td">{m.name}</td>
                    <td className="td text-right">{formatIDR(m.price)}</td>
                    <td className="td text-right">{formatIDR(m.costPrice)}</td>
                    <td className="td text-right font-semibold">
                      {m.price > 0 ? (((m.price - m.costPrice) / m.price) * 100).toFixed(1) : '0'}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </AppShell>
  );
}

function ReportHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 border-b border-slate-200 pb-3 text-center">
      <p className="text-sm font-extrabold uppercase tracking-wide text-slate-900">{title}</p>
      <p className="text-xs text-slate-500">Restoran Nusantara · {subtitle}</p>
    </div>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="px-4 pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </td>
    </tr>
  );
}

function DataRow({ label, value, indent, total, highlight }: { label: string; value: number; indent?: boolean; total?: boolean; highlight?: boolean }) {
  return (
    <tr className={total ? 'border-t border-slate-300 bg-slate-50' : ''}>
      <td className={`px-4 py-2 text-sm ${indent ? 'pl-8 text-slate-600' : ''} ${highlight ? 'font-extrabold text-emerald-700' : total ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
        {label}
      </td>
      <td className={`px-4 py-2 text-right ${highlight ? 'text-lg font-extrabold text-emerald-700' : total ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
        {formatIDR(value)}
      </td>
    </tr>
  );
}

function accountTone(category: string) {
  if (category === 'Pendapatan') return 'green' as const;
  if (category === 'HPP (Bahan Baku)') return 'amber' as const;
  if (category === 'Beban Operasional') return 'red' as const;
  if (category === 'Kas/Bank') return 'blue' as const;
  if (category === 'Kewajiban PPN') return 'violet' as const;
  if (category === 'Deposit Pelanggan') return 'brand' as const;
  return 'slate' as const;
}

function exportCSV(
  rows: { date: string; description: string; category: string; debit: number; credit: number; referenceId?: string }[]
) {
  const header = 'Tanggal,Keterangan,Akun,Referensi,Debit,Kredit';
  const body = rows
    .map((r) =>
      [
        new Date(r.date).toLocaleDateString('id-ID'),
        `"${r.description}"`,
        `"${r.category}"`,
        r.referenceId ?? '',
        r.debit || 0,
        r.credit || 0,
      ].join(',')
    )
    .join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `laporan-keuangan-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}