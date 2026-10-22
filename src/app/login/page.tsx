'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, KeyRound, Lock, LogIn, ShieldCheck, User, Utensils } from 'lucide-react';
import { useStore } from '@/lib/store';

const DEMO_ACCOUNTS = [
  { username: 'kasir', password: 'kasir123', role: 'Kasir', desc: 'Buka transaksi POS, tutup shift, Z-Report' },
  { username: 'manager', password: 'manager123', role: 'Manager', desc: 'Kelola stok, PO, void transaksi, laporan' },
  { username: 'admin', password: 'admin123', role: 'Administrator', desc: 'Akses penuh seluruh modul' },
  { username: 'customer', password: 'customer123', role: 'Customer', desc: 'Scan barcode & buat reservasi' },
];

export default function LoginPage() {
  const router = useRouter();
  const { login, user } = useStore();
  const [username, setUsername] = useState('kasir');
  const [password, setPassword] = useState('kasir123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const success = await login(username, password);
    setBusy(false);
    if (success) router.push('/pos');
    else setError('Username atau password salah.');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_380px]">
        {/* Panel kiri: identitas aplikasi */}
        <section className="hidden flex-col justify-between rounded-3xl bg-white/5 p-8 text-white backdrop-blur lg:flex">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-xl bg-brand-600 p-2.5">
                <Utensils className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-extrabold">Restoran Nusantara</p>
                <p className="text-xs text-slate-400">Sistem Informasi Restoran Terintegrasi</p>
              </div>
            </div>
            <h1 className="text-3xl font-extrabold leading-tight">
              Lima modul,
              <br /> satu sistem yang terhubung.
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
              Pemesanan scan barcode, kasir POS, kitchen display, reservasi meja, manajemen stok, sampai laporan
              keuangan standar akuntansi — berjalan di atas basis data dan REST API yang sama.
            </p>
          </div>

          <ul className="space-y-2 text-xs text-slate-400">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Autentikasi JWT + RBAC (customer/kasir/manager/admin)
            </li>
            <li className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-emerald-400" /> Password di-hash dengan scrypt
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Jurnal akuntansi double-entry otomatis per transaksi
            </li>
          </ul>
        </section>

        {/* Panel kanan: form */}
        <section className="rounded-3xl bg-white p-7 shadow-2xl">
          <h2 className="text-xl font-extrabold text-slate-900">Masuk ke Sistem</h2>
          <p className="mt-1 text-sm text-slate-500">Gunakan akun demo di bawah untuk menjelajah modul.</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <div>
              <label className="label" htmlFor="username">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="username"
                  className="input pl-9"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  className="input pl-9"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {error && (
              <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
                <AlertCircle className="h-4 w-4" /> {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full !py-3">
              <LogIn className="h-4 w-4" /> {busy ? 'Memproses…' : 'Masuk'}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Akun demo</p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.username}
                  onClick={() => {
                    setUsername(a.username);
                    setPassword(a.password);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs transition hover:border-brand-400 hover:bg-brand-50"
                >
                  <span>
                    <span className="font-bold text-slate-800">{a.role}</span>
                    <span className="ml-2 text-slate-500">
                      {a.username} / {a.password}
                    </span>
                  </span>
                  <span className="hidden text-[11px] text-slate-400 sm:block">{a.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Link href="/customer" className="mt-4 block text-center text-xs font-semibold text-slate-400 hover:text-brand-600">
            Lanjut sebagai tamu (tanpa login) →
          </Link>
        </section>
      </div>
    </main>
  );
}