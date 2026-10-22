'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  ChefHat,
  ClipboardList,
  Package,
  QrCode,
  ScanLine,
  Store,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Card, ProgressBar, StatCard } from '@/components/ui';
import { useStore } from '@/lib/store';
import { buildSnapshot } from '@/lib/analytics';
import { formatIDR } from '@/lib/utils';

const MODULES = [
  {
    href: '/customer',
    icon: QrCode,
    color: 'bg-brand-500',
    title: 'Modul 1 — Customer Portal',
    subtitle: 'Pesan sendiri dengan scan barcode',
    points: ['Scan QR/barcode meja', 'Katalog menu & kategori', 'Keranjang belanja', 'Checkout & struk digital'],
  },
  {
    href: '/pos',
    icon: Store,
    color: 'bg-sky-500',
    title: 'Modul 2 — Aplikasi Kasir (POS)',
    subtitle: 'Transaksi cepat di meja atau takeaway',
    points: ['Opening/closing kasir', 'Z-Report shift', 'Split & multi pembayaran', 'Cetak struk 80mm'],
  },
  {
    href: '/kitchen',
    icon: ChefHat,
    color: 'bg-amber-500',
    title: 'Modul 2 — Kitchen Display',
    subtitle: 'Monitor pesanan dapur real-time',
    points: ['Papan pesanan masuk', 'Ubah status masak', 'Realtime antar tab', 'Riwayat pesanan'],
  },
  {
    href: '/booking',
    icon: ClipboardList,
    color: 'bg-violet-500',
    title: 'Modul 3 — Reservasi & Booking',
    subtitle: 'Reservasi meja dengan uang muka',
    points: ['Cek ketersediaan slot', 'Denah & status meja', 'Deposit + QR code', 'Kelola dari admin'],
  },
  {
    href: '/inventory',
    icon: Package,
    color: 'bg-emerald-500',
    title: 'Modul 4 — Stok & Bahan Baku',
    subtitle: 'Manajemen persediaan restoran',
    points: ['Stok opname & penyesuaian', 'Purchase Order supplier', 'Terima barang (GRN)', 'Alert stok menipis & kedaluwarsa'],
  },
  {
    href: '/reports',
    icon: BarChart3,
    color: 'bg-rose-500',
    title: 'Modul 5 — Laporan Keuangan',
    subtitle: 'Standar akuntansi (double entry)',
    points: ['Laba Rugi (P&L)', 'Neraca Saldo', 'Arus Kas', 'Buku Besar & ekspor'],
  },
];

export default function HomePage() {
  const { orders, bookings, tables, rawMaterials, ledger, menuItems, posSession } = useStore();
  const snapshot = buildSnapshot(ledger, rawMaterials);

  const paidOrders = orders.filter((o) => o.paymentStatus === 'paid' && o.status !== 'cancelled');
  const todayOrders = paidOrders.filter((o) => (o.paidAt || o.createdAt).slice(0, 10) === new Date().toISOString().slice(0, 10));
  const todayRevenue = todayOrders.reduce((s, o) => s + o.total, 0);
  const lowStock = rawMaterials.filter((m) => m.currentStock <= m.minStock);
  const activeBookings = bookings.filter((b) => ['pending_payment', 'confirmed'].includes(b.status));
  const occupiedTables = tables.filter((t) => t.status === 'occupied');

  return (
    <AppShell
      title="Beranda & Demo Navigator"
      subtitle="Pilih modul untuk mendemonstrasikan alur sistem informasi restoran"
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Omzet Hari Ini"
          value={formatIDR(todayRevenue)}
          sub={`${todayOrders.length} transaksi lunas`}
          icon={<Wallet className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="Laba Bersih"
          value={formatIDR(snapshot.netIncome)}
          sub={`Margin kotor ${snapshot.grossMargin.toFixed(1)}%`}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="blue"
        />
        <StatCard
          label="Meja Terpakai"
          value={`${occupiedTables.length} / ${tables.length}`}
          sub={`${activeBookings.length} reservasi aktif`}
          icon={<Users className="h-5 w-5" />}
          tone="violet"
        />
        <StatCard
          label="Stok Menipis"
          value={`${lowStock.length} bahan`}
          sub={lowStock.length ? lowStock.map((m) => m.name.split(' ')[0]).join(', ') : 'Semua aman'}
          icon={<Package className="h-5 w-5" />}
          tone={lowStock.length ? 'red' : 'slate'}
        />
      </div>

      {/* Sesi kasir */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-slate-900 p-2.5">
              <Store className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {posSession?.isOpen ? 'Sesi Kasir Berjalan' : 'Belum ada sesi kasir'}
              </p>
              <p className="text-xs text-slate-500">
                {posSession?.isOpen
                  ? `${posSession.cashierName} · sejak ${new Date(posSession.startTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · ${posSession.totalTransactions} transaksi`
                  : 'Buka sesi kasir di modul POS'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/pos" className="btn-dark">
              Buka POS <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/customer" className="btn-primary">
              <ScanLine className="h-4 w-4" /> Scan Meja (Demo)
            </Link>
          </div>
        </div>
      </Card>

      {/* Modul */}
      <h2 className="mb-3 mt-6 text-lg font-bold text-slate-900">Modul Sistem</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.href}
              href={m.href}
              className="card group p-5 transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <div className={`${m.color} rounded-xl p-2.5 text-white`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-slate-900">{m.title}</p>
                  <p className="text-xs text-slate-500">{m.subtitle}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-brand-500" />
              </div>
              <ul className="mt-4 space-y-1.5">
                {m.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-xs text-slate-600">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                    {p}
                  </li>
                ))}
              </ul>
            </Link>
          );
        })}
      </div>

      {/* Ringkasan data */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="mb-3 text-sm font-bold text-slate-900">Kondisi Restoran Saat Ini</p>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>Okupansi meja</span>
                <span className="font-semibold">
                  {occupiedTables.length}/{tables.length}
                </span>
              </div>
              <ProgressBar value={(occupiedTables.length / tables.length) * 100} tone="bg-sky-500" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>Menu aktif</span>
                <span className="font-semibold">
                  {menuItems.filter((m) => m.available).length}/{menuItems.length}
                </span>
              </div>
              <ProgressBar
                value={(menuItems.filter((m) => m.available).length / menuItems.length) * 100}
                tone="bg-emerald-500"
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-600">
                <span>Kesehatan stok</span>
                <span className="font-semibold">
                  {rawMaterials.length - lowStock.length}/{rawMaterials.length} aman
                </span>
              </div>
              <ProgressBar
                value={((rawMaterials.length - lowStock.length) / rawMaterials.length) * 100}
                tone={lowStock.length ? 'bg-amber-500' : 'bg-emerald-500'}
              />
            </div>
          </div>
        </Card>

        <Card>
          <p className="mb-3 text-sm font-bold text-slate-900">Peringatan Stok Menipis</p>
          {lowStock.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada bahan yang perlu dipesan ulang.</p>
          ) : (
            <ul className="space-y-2">
              {lowStock.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{m.name}</p>
                    <p className="text-xs text-slate-500">
                      Sisa {m.currentStock} {m.unit} · minimum {m.minStock} {m.unit}
                    </p>
                  </div>
                  <Badge tone="red">Segera PO</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <p className="mb-3 text-sm font-bold text-slate-900">Transaksi Terbaru</p>
          <ul className="space-y-2">
            {orders.slice(0, 4).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    {o.orderNo} · {o.tableNumber}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {o.customerName} · {o.items.length} item
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{formatIDR(o.total)}</p>
                  <Badge tone={o.paymentStatus === 'paid' ? 'green' : 'amber'}>
                    {o.paymentStatus === 'paid' ? 'Lunas' : 'Belum bayar'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}