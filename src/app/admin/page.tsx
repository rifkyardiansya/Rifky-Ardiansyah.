'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  Database,
  History,
  KeyRound,
  ListChecks,
  RefreshCcw,
  Save,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Card, EmptyState, Modal, StatCard, Toast } from '@/components/ui';
import { QueuePanel } from '@/components/QueuePanel';
import { useStore } from '@/lib/store';
import { Api, ApiRequestError } from '@/lib/api';
import { formatDateTime, formatIDR } from '@/lib/utils';
import type { Tone } from '@/components/ui';

function auditTone(action: string): Tone {
  if (action === 'LOGIN') return 'blue';
  if (action === 'CRON_DAILY_REPORT') return 'violet';
  if (action === 'ADJUST_STOCK') return 'amber';
  if (action === 'EXPORT_REPORT') return 'green';
  if (action === 'CREATE_PAYMENT') return 'brand';
  return 'slate';
}

const DEMO_USERS = [
  { username: 'admin', fullName: 'Administrator Restoran', email: 'admin@resto.test', phone: '0812-0000-0000', role: 'admin' },
  { username: 'manager', fullName: 'Budi Santoso (Manager)', email: 'manager@resto.test', phone: '0812-0000-0000', role: 'manager' },
  { username: 'kasir', fullName: 'Rifky (Kasir Utama)', email: 'kasir@resto.test', phone: '0812-0000-0000', role: 'cashier' },
  { username: 'kasir2', fullName: 'Siti Rahma (Kasir)', email: 'kasir2@resto.test', phone: '0812-0000-0000', role: 'cashier' },
  { username: 'customer', fullName: 'Ahmad Fauzi', email: 'customer@resto.test', phone: '0812-0000-0000', role: 'customer' },
];

export default function AdminPage() {
  const { user, mode, refresh, ledger, orders, bookings, rawMaterials, posSession } = useStore();
  const [tab, setTab] = useState<'akun' | 'keamanan' | 'audit' | 'aktivitas' | 'antrean'>('akun');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState({ username: '', fullName: '', email: '', password: '' });
  const [toast, setToast] = useState('');
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [reports, setReports] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    Api.reportHistory()
      .then((r) => setReports((r.history ?? []) as Record<string, unknown>[]))
      .catch(() => setReports([]));
  }, [orders.length, bookings.length]);

  useEffect(() => {
    if (tab !== 'aktivitas') return;
    Api.get<{ logs: Record<string, unknown>[] }>('/audit-logs')
      .then((r) => setAudit(r.logs ?? []))
      .catch(() => setAudit([]));
  }, [tab, orders.length]);

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2400);
  }

  return (
    <AppShell
      title="Panel Administrator"
      subtitle="Manajemen akun, audit aktivitas, dan konfigurasi keamanan sistem"
      actions={
        <button onClick={() => void refresh()} className="btn-outline">
          <RefreshCcw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Akun Terdaftar" value={String(DEMO_USERS.length)} sub="4 role berbeda" icon={<Users className="h-5 w-5" />} tone="blue" />
        <StatCard label="Mode Data" value={mode === 'server' ? 'API + DB' : 'Offline'} sub={mode === 'server' ? 'SQLite terenkripsi WAL' : 'fallback localStorage'} icon={<Database className="h-5 w-5" />} tone={mode === 'server' ? 'green' : 'amber'} />
        <StatCard label="Baris Jurnal" value={String(ledger.length)} sub="double-entry" icon={<Wallet className="h-5 w-5" />} tone="violet" />
        <StatCard
          label="Login Anda"
          value={user?.username ?? 'guest'}
          sub={user ? `role ${user.role}` : 'belum login'}
          icon={<ShieldCheck className="h-5 w-5" />}
          tone="brand"
        />
      </div>

      <div className="my-4 flex flex-wrap gap-2">
        {[
          { key: 'akun', label: 'Manajemen Akun', icon: Users },
          { key: 'keamanan', label: 'Keamanan & Peran', icon: ShieldCheck },
          { key: 'audit', label: 'Ekspor Laporan', icon: Activity },
          { key: 'aktivitas', label: 'Log Aktivitas', icon: History },
          { key: 'antrean', label: 'Antrean & Worker', icon: ListChecks },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} data-testid={"admin-tab-" + t.key} onClick={() => setTab(t.key as typeof tab)} className={tab === t.key ? 'btn-primary' : 'btn-outline'}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'antrean' && <QueuePanel />}

      {tab === 'akun' && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <p className="text-sm font-bold text-slate-900">Daftar Pengguna Sistem</p>
            <button onClick={() => setRegisterOpen(true)} className="btn-primary !py-2">
              <Users className="h-4 w-4" /> Tambah Akun
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Username</th>
                  <th className="th">Nama Lengkap</th>
                  <th className="th">Email</th>
                  <th className="th">Role</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {DEMO_USERS.map((u) => (
                  <tr key={u.username} className={user?.username === u.username ? 'bg-brand-50/50' : ''}>
                    <td className="td font-mono text-xs font-bold">{u.username}</td>
                    <td className="td font-semibold">{u.fullName}</td>
                    <td className="td text-xs">{u.email}</td>
                    <td className="td">
                      <Badge tone={u.role === 'admin' ? 'red' : u.role === 'manager' ? 'violet' : u.role === 'cashier' ? 'blue' : 'slate'}>
                        {u.role}
                      </Badge>
                    </td>
                    <td className="td">
                      <Badge tone="green">aktif</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'keamanan' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <p className="mb-3 text-sm font-bold text-slate-900">Matriks Hak Akses (RBAC)</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="th !py-2">Fitur</th>
                    <th className="th !py-2 text-center">Customer</th>
                    <th className="th !py-2 text-center">Kasir</th>
                    <th className="th !py-2 text-center">Manager</th>
                    <th className="th !py-2 text-center">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {[
                    ['Scan barcode & pesan', 1, 1, 1, 1],
                    ['Lihat riwayat pesanan', 1, 1, 1, 1],
                    ['Buat reservasi', 1, 1, 1, 1],
                    ['Terima deposit', 0, 1, 1, 1],
                    ['Buka/tutup shift kasir', 0, 1, 1, 1],
                    ['Batalkan transaksi (void)', 0, 0, 1, 1],
                    ['Kelola stok & stock opname', 0, 0, 1, 1],
                    ['Purchase Order & GRN', 0, 0, 1, 1],
                    ['Laporan keuangan', 0, 0, 1, 1],
                    ['Kelola akun pengguna', 0, 0, 0, 1],
                  ].map(([label, ...perms]) => (
                    <tr key={String(label)}>
                      <td className="td !py-2">{label}</td>
                      {perms.map((p, i) => (
                        <td key={i} className="td !py-2 text-center">
                          {p ? <span className="text-emerald-600">✓</span> : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <p className="mb-2 text-sm font-bold text-slate-900">Implementasi Keamanan</p>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex gap-2">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  Password di-hash dengan <b>scrypt</b> (salt 16 byte + timing-safe compare), bukan plaintext.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  Token sesi berformat <b>JWT HS256</b>, disimpan di cookie <code>HttpOnly + SameSite=Lax</code>.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  Route halaman dilindungi <b>middleware</b> (halaman kasir/stok/laporan wajib role minimal).
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  Seluruh input divalidasi dengan <b>Zod</b> sebelum menyentuh database.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  SQL memakai <b>prepared statement</b> (parameterized) — bebas dari SQL injection.
                </li>
              </ul>
            </Card>

            <Card>
              <p className="mb-2 text-sm font-bold text-slate-900">Status Sistem</p>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <li className="flex justify-between">
                  <span>Sesi kasir</span>
                  <span className="font-semibold">
                    {posSession?.isOpen ? `Terbuka — ${posSession.cashierName}` : 'Tertutup'}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>Jenis bahan baku</span>
                  <span className="font-semibold">{rawMaterials.length}</span>
                </li>
                <li className="flex justify-between">
                  <span>Total transaksi tercatat</span>
                  <span className="font-semibold">{orders.length}</span>
                </li>
                <li className="flex justify-between">
                  <span>Total reservasi</span>
                  <span className="font-semibold">{bookings.length}</span>
                </li>
                <li className="flex justify-between">
                  <span>Nilai jurnal</span>
                  <span className="font-semibold">
                    {formatIDR(ledger.reduce((s, e) => s + e.debit, 0))}
                  </span>
                </li>
              </ul>
            </Card>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-4">
          <Card>
            <p className="mb-3 text-sm font-bold text-slate-900">Riwayat Ekspor Laporan Keuangan</p>
            {reports.length === 0 ? (
              <EmptyState
                title="Belum ada laporan diekspor"
                hint="Buka modul Laporan Keuangan lalu gunakan tombol ekspor — setiap ekspor tercatat di sini."
                icon={<Activity className="h-8 w-8" />}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="th">ID</th>
                      <th className="th">Jenis Laporan</th>
                      <th className="th">Periode</th>
                      <th className="th">Waktu</th>
                      <th className="th">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reports.map((r) => (
                      <tr key={String(r.id)}>
                        <td className="td font-mono text-xs">{String(r.id).slice(0, 12)}</td>
                        <td className="td font-semibold">{String(r.reportType)}</td>
                        <td className="td">{String(r.period)}</td>
                        <td className="td text-xs text-slate-500">{formatDateTime(String(r.generatedAt))}</td>
                        <td className="td">
                          <Badge tone="green">{String(r.status)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-sm font-bold text-slate-900">Aktivitas Terakhir pada Jurnal</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
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
                  {ledger.slice(0, 12).map((e) => (
                    <tr key={e.id}>
                      <td className="td text-xs">{e.date}</td>
                      <td className="td text-xs">{e.description}</td>
                      <td className="td">
                        <Badge tone="slate">{e.category}</Badge>
                      </td>
                      <td className="td font-mono text-[11px] text-slate-500">{e.referenceId ?? '—'}</td>
                      <td className="td text-right font-semibold text-emerald-700">{e.debit ? formatIDR(e.debit) : '—'}</td>
                      <td className="td text-right font-semibold text-rose-600">{e.credit ? formatIDR(e.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'aktivitas' && (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <p className="text-sm font-bold text-slate-900">Log Aktivitas (Audit Trail)</p>
              <p className="text-xs text-slate-500">
                Setiap login, penyesuaian stok, pembuatan pembayaran, dan laporan terjadwal tercatat di sini.
              </p>
            </div>
            <Badge tone="blue">{audit.length} entri</Badge>
          </div>

          {audit.length === 0 ? (
            <EmptyState title="Belum ada aktivitas tercatat" icon={<Activity className="h-8 w-8" />} />
          ) : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[720px]">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Waktu</th>
                    <th className="th">Aksi</th>
                    <th className="th">Entitas</th>
                    <th className="th">ID</th>
                    <th className="th">Pengguna</th>
                    <th className="th">Sumber</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {audit.map((log) => (
                    <tr key={String(log.id)} className="hover:bg-slate-50">
                      <td className="td text-xs whitespace-nowrap">{formatDateTime(String(log.createdAt))}</td>
                      <td className="td">
                        <Badge tone={auditTone(String(log.action))}>{String(log.action)}</Badge>
                      </td>
                      <td className="td text-xs">{String(log.entity)}</td>
                      <td className="td font-mono text-[11px] text-slate-500">{String(log.entityId ?? '—')}</td>
                      <td className="td text-xs">{String(log.username ?? 'sistem')}</td>
                      <td className="td text-xs text-slate-500">{String(log.ipAddress ?? '-')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={registerOpen} onClose={() => setRegisterOpen(false)} title="Tambah Akun Pengguna">
        <div className="space-y-3">
          <div>
            <label className="label">Username</label>
            <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <label className="label">Nama Lengkap</label>
            <input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Password (min. 6 karakter)</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <button
            onClick={async () => {
              try {
                await Api.register({
                  username: form.username,
                  fullName: form.fullName,
                  email: form.email,
                  password: form.password,
                });
                setRegisterOpen(false);
                setForm({ username: '', fullName: '', email: '', password: '' });
                flash('Akun baru dibuat dengan role customer');
              } catch (error) {
                flash(error instanceof ApiRequestError ? error.message : 'Gagal membuat akun');
              }
            }}
            className="btn-primary w-full !py-3"
          >
            <Save className="h-4 w-4" /> Simpan Akun
          </button>
          <p className="text-xs text-slate-500">
            Akun baru otomatis mendapat role <b>customer</b>. Role kasir/manager/admin hanya dapat dibuat
            melalui seed atau langsung di database.
          </p>
        </div>
      </Modal>

      <Toast message={toast} />
    </AppShell>
  );
}