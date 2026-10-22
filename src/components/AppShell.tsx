'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  MonitorSmartphone,
  Package,
  QrCode,
  Radio,
  RotateCcw,
  ShieldCheck,
  Store,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { cn, formatTime } from '@/lib/utils';
import { Badge } from './ui';
import { PwaPanel } from './PwaPanel';

const NAV = [
  { href: '/', label: 'Beranda', icon: LayoutDashboard, minRole: 'customer' as const },
  { href: '/customer', label: 'Customer Portal', icon: QrCode, group: 'Modul 1', minRole: 'customer' as const },
  { href: '/pos', label: 'Kasir (POS)', icon: Store, group: 'Modul 2', minRole: 'cashier' as const },
  { href: '/kitchen', label: 'Kitchen Display', icon: ChefHat, group: 'Modul 2', minRole: 'customer' as const },
  { href: '/booking', label: 'Reservasi Meja', icon: ClipboardList, group: 'Modul 3', minRole: 'customer' as const },
  { href: '/inventory', label: 'Stok & Bahan Baku', icon: Package, group: 'Modul 4', minRole: 'manager' as const },
  { href: '/reports', label: 'Laporan Keuangan', icon: BarChart3, group: 'Modul 5', minRole: 'manager' as const },
  { href: '/notifications', label: 'Notifikasi', icon: Bell, group: 'Sistem', minRole: 'manager' as const },
  { href: '/admin', label: 'Panel Admin', icon: ShieldCheck, group: 'Sistem', minRole: 'admin' as const },
];

const ROLE_RANK = { customer: 0, cashier: 1, manager: 2, admin: 3 } as const;
type Role = keyof typeof ROLE_RANK;

const ROLE_LABEL: Record<string, string> = {
  '/': 'Demo Navigator',
  '/customer': 'Customer / Tamu',
  '/pos': 'Kasir',
  '/kitchen': 'Dapur (KDS)',
  '/booking': 'Customer + Admin',
  '/inventory': 'Admin / Manager',
  '/reports': 'Admin / Finance',
  '/notifications': 'Admin / Finance',
  '/admin': 'Administrator',
};

export function AppShell({
  children,
  title,
  subtitle,
  actions,
  wide,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  wide?: boolean;
}) {
  const pathname = usePathname();
  const { resetDemo, orders, user, logout, mode, loading, lastError, dismissError, connection, liveEvent } =
    useStore();
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    setNow(formatTime(new Date().toISOString()));
    const t = setInterval(() => setNow(formatTime(new Date().toISOString())), 30000);
    return () => clearInterval(t);
  }, []);

  const activeOrders = orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length;
  const currentRole: Role = (user?.role as Role) ?? 'customer';
  const visibleNav = NAV.filter((n) => ROLE_RANK[currentRole] >= ROLE_RANK[n.minRole]);

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar */}
      <aside className="no-print hidden w-64 shrink-0 flex-col bg-slate-900 text-slate-300 lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="rounded-xl bg-brand-600 p-2">
            <Utensils className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-white">Restoran Nusantara</p>
            <p className="text-[11px] text-slate-400">Sistem Informasi Terintegrasi</p>
          </div>
        </div>

        <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 pb-6">
          {visibleNav.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-800 hover:text-white'
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" style={{ height: 18, width: 18 }} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.href === '/kitchen' && activeOrders > 0 && (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {activeOrders}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 px-4 py-4 text-xs">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-bold text-white">{user?.fullName ?? 'Mode Tamu'}</p>
              <p className="truncate text-slate-400">
                {user ? `${user.username} · ${user.role}` : 'belum login'}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    connection === 'live' ? 'bg-emerald-500' : connection === 'connecting' ? 'bg-amber-400' : 'bg-slate-300'
                  )}
                />
                <span className="text-[11px] font-semibold text-slate-400">
                  {connection === 'live' ? 'Realtime aktif' : connection === 'connecting' ? 'Menghubungkan…' : 'Realtime offline'}
                </span>
              </div>
              <Badge tone={mode === 'server' ? 'green' : 'amber'}>
                {loading ? 'sinkron…' : mode === 'server' ? 'API/DB' : 'offline'}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/login"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-2 py-1.5 font-semibold text-slate-200 hover:bg-slate-700"
            >
              <LogIn className="h-3.5 w-3.5" /> {user ? 'Ganti akun' : 'Login'}
            </Link>
            {user && (
              <button
                onClick={() => void logout()}
                className="rounded-lg bg-slate-800 px-2 py-1.5 text-slate-300 hover:bg-slate-700"
                title="Keluar"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button onClick={resetDemo} className="mt-3 flex items-center gap-2 text-slate-400 hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" /> Refresh data dari server
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-slate-900 px-4 py-3 text-white lg:hidden">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-brand-600 p-1.5">
            <Utensils className="h-4 w-4" />
          </div>
          <span className="text-sm font-bold">Restoran Nusantara</span>
        </div>
        <button onClick={resetDemo} className="rounded-lg bg-slate-800 p-2">
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile nav */}
      <div className="no-print scrollbar-thin sticky top-[52px] z-30 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
        {visibleNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold',
              pathname === item.href ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <header className="no-print border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-extrabold text-slate-900">{title}</h1>
                <Badge tone="brand">{ROLE_LABEL[pathname] ?? 'Demo'}</Badge>
              </div>
              {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <div className="hidden items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 sm:flex">
                <MonitorSmartphone className="h-3.5 w-3.5" /> {now}
              </div>
            </div>
          </div>
        </header>

        <main className={cn('p-4 sm:p-6', wide ? 'max-w-none' : 'mx-auto max-w-7xl')}>
          {lastError && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <div>
                <p className="font-semibold">Permintaan ditolak server</p>
                <p className="text-xs">{lastError}</p>
              </div>
              <button onClick={dismissError} className="font-bold text-rose-500 hover:text-rose-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {children}
        </main>

        <footer className="no-print border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-400">
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <MenuIcon className="h-3 w-3" /> PWA Ready (offline capable)
            </span>
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-3 w-3" /> Pembayaran: Tunai / QRIS / Debit / Kredit
            </span>
            <span className="inline-flex items-center gap-1">
              <Radio className="h-3 w-3" />
              {connection === 'live'
                ? `Realtime aktif${liveEvent ? ` — ${liveEvent.channel}/${liveEvent.action}` : ''}`
                : 'Realtime offline'}
            </span>
            <span>Data dari REST API + SQLite</span>
          </p>
        </footer>

        <PwaPanel />
      </div>
    </div>
  );
}