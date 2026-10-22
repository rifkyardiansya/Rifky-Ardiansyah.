'use client';

import Link from 'next/link';
import { Compass, Home, RefreshCw, Utensils, WifiOff } from 'lucide-react';

/**
 * Halaman fallback ketika service worker tidak menemukan cache dan jaringan
 * sedang tidak tersedia.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 w-fit rounded-2xl bg-amber-100 p-3">
          <WifiOff className="h-8 w-8 text-amber-600" />
        </div>

        <h1 className="text-xl font-extrabold text-slate-900">Anda sedang offline</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Halaman ini belum tersimpan di perangkat. Keranjang yang Anda pilih tetap aman di penyimpanan
          lokal dan akan terkirim otomatis begitu koneksi kembali.
        </p>

        <div className="mt-6 space-y-2">
          <Link href="/customer" className="btn-primary w-full !py-3">
            <Utensils className="h-4 w-4" /> Buka Menu (mode offline)
          </Link>
          <Link href="/" className="btn-outline w-full">
            <Home className="h-4 w-4" /> Beranda
          </Link>
          <Link href="/booking" className="btn-outline w-full">
            <Compass className="h-4 w-4" /> Lihat Reservasi
          </Link>
        </div>

        <button onClick={() => window.location.reload()} className="btn-ghost mt-4 w-full">
          <RefreshCw className="h-4 w-4" /> Muat ulang saat koneksi tersedia
        </button>

        <p className="mt-5 text-[11px] text-slate-400">
          Restoran Nusantara · mode offline-first PWA
        </p>
      </div>
    </main>
  );
}