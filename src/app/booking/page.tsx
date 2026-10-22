'use client';

import { useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  DoorOpen,
  LayoutGrid,
  Mail,
  Phone,
  Plus,
  Printer,
  QrCode,
  Users,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { FloorMap } from '@/components/FloorMap';
import { Api, ApiRequestError } from '@/lib/api';
import { Badge, Card, EmptyState, Modal, QRCode, Toast, type Tone } from '@/components/ui';
import { useStore } from '@/lib/store';
import { PAYMENT_LABEL } from '@/lib/analytics';
import { DEPOSIT_RATE, formatDate, formatIDR, todayISO } from '@/lib/utils';
import type { PaymentMethod, TableBooking } from '@/types';

const SLOTS = ['11:00 - 13:00', '13:00 - 15:00', '15:00 - 17:00', '17:00 - 19:00', '19:00 - 21:00'];

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Menunggu Pembayaran',
  confirmed: 'Terkonfirmasi',
  checked_in: 'Sudah Check-in',
  cancelled: 'Dibatalkan',
};

const PACKAGES = [
  { name: 'Tanpa Paket (Bayar di Tempat)', price: 0, note: 'Tanpa uang muka' },
  { name: 'Paket Makan Siang (2 jam)', price: 150000, note: 'Makan siang 11-13' },
  { name: 'Paket Makan Malam (3 jam)', price: 300000, note: 'Menu pilihan + minuman' },
  { name: 'Paket_private Event', price: 1000000, note: 'VIP room, dekorasi, MC' },
];

export default function BookingPage() {
  const { tables, bookings, createBooking, payBookingDeposit, updateBookingStatus, cancelBooking, isTableReserved } =
    useStore();

  const [tab, setTab] = useState<'reservasi' | 'denah' | 'kelola'>('reservasi');
  const [date, setDate] = useState(todayISO());
  const [partySize, setPartySize] = useState(2);
  const [slot, setSlot] = useState(SLOTS[3]);
  const [tableId, setTableId] = useState('');
  const [pkgIndex, setPkgIndex] = useState(0);
  const [form, setForm] = useState({ guestName: '', guestPhone: '', guestEmail: '', specialRequests: '' });
  const [result, setResult] = useState<TableBooking | null>(null);
  const [payOpen, setPayOpen] = useState<TableBooking | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('qris');
  const [qrTarget, setQrTarget] = useState<TableBooking | null>(null);
  const [toast, setToast] = useState('');

  const selectedPkg = PACKAGES[pkgIndex];
  const deposit = Math.round(selectedPkg.price * DEPOSIT_RATE) || 100000;

  const availableTables = useMemo(
    () => tables.filter((t) => t.capacity >= partySize && !isTableReserved(t.id, date, slot)),
    [tables, partySize, date, slot, isTableReserved]
  );

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2400);
  }

  async function submitBooking() {
    if (!tableId || !form.guestName || !form.guestPhone) {
      flash('Lengkapi nama, telepon, dan pilih meja terlebih dahulu');
      return;
    }
    const booking = await createBooking({
      guestName: form.guestName,
      guestPhone: form.guestPhone,
      guestEmail: form.guestEmail,
      partySize,
      date,
      timeSlot: slot,
      tableId,
      specialRequests: form.specialRequests,
      packagePrice: selectedPkg.price,
    });
    if (!booking) return;
    setResult(booking);
    setPayOpen(booking);
    setForm({ guestName: '', guestPhone: '', guestEmail: '', specialRequests: '' });
    setTableId('');
  }

  const upcoming = bookings.filter((b) => b.status !== 'cancelled');
  const pendingList = bookings.filter((b) => b.status === 'pending_payment');

  /** Deposit dibayar lewat payment gateway (QRIS online / VA) via webhook. */
  async function payDepositOnline(booking: TableBooking) {
    try {
      const intent = await Api.post<{ redirectUrl: string; total: number; fee: number }>('/payment', {
        refType: 'booking',
        refId: booking.bookingCode,
        method: payMethod,
      });
      flash(`Mengarahkan ke gateway — total ${formatIDR(intent.total)}`);
      window.location.href = intent.redirectUrl;
    } catch (error) {
      flash(error instanceof ApiRequestError ? error.message : 'Gagal membuat pembayaran deposit');
    }
  }

  return (
    <AppShell
      title="Modul 3 — Reservasi & Booking Meja"
      subtitle="Pelanggan memilih tanggal, jam, dan meja; sistem menahan deposit dan menghasilkan QR code konfirmasi"
      wide
    >
      <div className="mb-4 flex gap-2">
        {[
          { key: 'reservasi', label: 'Form Reservasi', icon: CalendarCheck },
          { key: 'denah', label: 'Denah & Status Meja', icon: LayoutGrid },
          { key: 'kelola', label: 'Kelola Reservasi', icon: CalendarDays },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={
                tab === t.key
                  ? 'btn-primary flex-1 sm:flex-none'
                  : 'btn-outline flex-1 sm:flex-none'
              }
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ---------------- FORM RESERVASI ---------------- */}
      {tab === 'reservasi' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">1. Kebutuhan Tamu</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Tanggal</label>
                  <input type="date" className="input" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Jam Reservasi</label>
                  <select className="input" value={slot} onChange={(e) => setSlot(e.target.value)}>
                    {SLOTS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Jumlah tamu</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPartySize((p) => Math.max(1, p - 1))} className="btn-outline !px-3">
                      −
                    </button>
                    <div className="flex-1 rounded-xl bg-slate-50 py-2 text-center font-bold">
                      <Users className="mr-1 inline h-4 w-4" />
                      {partySize} orang
                    </div>
                    <button onClick={() => setPartySize((p) => Math.min(20, p + 1))} className="btn-outline !px-3">
                      +
                    </button>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">2. Meja yang Tersedia</p>
                <Badge tone="green">{availableTables.length} meja</Badge>
              </div>
              {availableTables.length === 0 ? (
                <EmptyState
                  title="Tidak ada meja tersedia"
                  hint="Coba ubah tanggal, jam, atau jumlah tamu — atau pilih jam lain."
                  icon={<Clock className="h-8 w-8" />}
                />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {availableTables.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTableId(t.id)}
                      className={
                        tableId === t.id
                          ? 'rounded-xl border-2 border-brand-500 bg-brand-50 p-3 text-left'
                          : 'rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300'
                      }
                    >
                      <p className="text-sm font-bold text-slate-900">{t.tableNo}</p>
                      <p className="text-[11px] text-slate-500">{t.section}</p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-600">Kapasitas {t.capacity} org</p>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">3. Data Pemesan</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="guest-name">
                    Nama Lengkap *
                  </label>
                  <input
                    id="guest-name"
                    className="input"
                    value={form.guestName}
                    onChange={(e) => setForm({ ...form, guestName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="guest-phone">
                    Nomor WhatsApp *
                  </label>
                  <input
                    id="guest-phone"
                    className="input"
                    value={form.guestPhone}
                    onChange={(e) => setForm({ ...form, guestPhone: e.target.value })}
                    placeholder="08xx-xxxx-xxxx"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Email (untuk e-ticket)</label>
                  <input className="input" value={form.guestEmail} onChange={(e) => setForm({ ...form, guestEmail: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Permintaan Tambahan</label>
                  <textarea
                    className="input h-20"
                    placeholder="Contoh: kursi bayi,NSAF ulang tahun,CCN survei"
                    value={form.specialRequests}
                    onChange={(e) => setForm({ ...form, specialRequests: e.target.value })}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Ringkasan */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <Card>
              <p className="mb-3 text-sm font-bold text-slate-900">Ringkasan Reservasi</p>

              <label className="label">Pilih Paket</label>
              <div className="space-y-2">
                {PACKAGES.map((p, i) => (
                  <button
                    key={p.name}
                    onClick={() => setPkgIndex(i)}
                    className={
                      pkgIndex === i
                        ? 'w-full rounded-xl border-2 border-brand-500 bg-brand-50 p-3 text-left'
                        : 'w-full rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300'
                    }
                  >
                    <p className="text-sm font-bold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.note}</p>
                    <p className="mt-1 text-xs font-bold text-brand-600">
                      {p.price === 0 ? 'Gratis' : formatIDR(p.price)}
                    </p>
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
                <Row label="Tanggal" value={formatDate(date)} />
                <Row label="Jam" value={slot} />
                <Row label="Jumlah tamu" value={`${partySize} orang`} />
                <Row label="Meja" value={tables.find((t) => t.id === tableId)?.tableNo ?? 'Belum dipilih'} />
                <Row label="Uang muka (25%)" value={formatIDR(deposit)} />
              </div>

              <button onClick={() => void submitBooking()} disabled={!tableId} className="btn-primary mt-4 w-full !py-3">
                <CalendarCheck className="h-4 w-4" /> Buat Reservasi
              </button>
              {!tableId && <p className="mt-2 text-center text-xs text-slate-500">Pilih meja terlebih dahulu.</p>}
            </Card>
          </aside>
        </div>
      )}

      {/* ---------------- DENAH MEJA ---------------- */}
      {tab === 'denah' && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-900">Denah Ruangan Restoran</p>
              <p className="text-xs text-slate-500">Klik meja untuk mengubah status secara manual (dummy admin control)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Legend tone="bg-emerald-400" label="Tersedia" />
              <Legend tone="bg-sky-400" label="Terisi" />
              <Legend tone="bg-violet-400" label="Reservasi" />
            </div>
          </div>
          <FloorMap tables={tables} />
        </Card>
      )}

      {/* ---------------- KELOLA RESERVASI ---------------- */}
      {tab === 'kelola' && (
        <div className="space-y-4">
          {pendingList.length > 0 && (
            <Card className="border-amber-300 bg-amber-50/50">
              <p className="text-sm font-bold text-amber-800">
                {pendingList.length} reservasi menunggu pembayaran deposit
              </p>
            </Card>
          )}

          {upcoming.length === 0 ? (
            <EmptyState title="Belum ada reservasi" hint="Reservasi baru akan muncul di sini." icon={<CalendarDays className="h-8 w-8" />} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {upcoming.map((b) => (
                <Card key={b.id} className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-slate-900">{b.bookingCode}</p>
                      <p className="text-xs text-slate-500">
                        {b.guestName} · {b.partySize} orang
                      </p>
                    </div>
                    <Badge tone={toneOf(b.status)}>{STATUS_LABEL[b.status]}</Badge>
                  </div>

                  <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    <p className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" /> {formatDate(b.date)} · {b.timeSlot}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <DoorOpen className="h-3.5 w-3.5" /> {b.tableNo}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" /> {b.guestPhone}
                    </p>
                    {b.guestEmail && (
                      <p className="flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" /> {b.guestEmail}
                      </p>
                    )}
                    {b.specialRequests && <p className="italic text-slate-500">Catatan: {b.specialRequests}</p>}
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-3 py-2">
                    <span className="text-xs text-slate-500">Deposit ({DEPOSIT_RATE * 100}%)</span>
                    <span className="text-sm font-bold text-slate-900">
                      {formatIDR(b.depositAmount)}{' '}
                      <Badge tone={b.depositStatus === 'paid' ? 'green' : b.depositStatus === 'refunded' ? 'red' : 'amber'}>
                        {b.depositStatus === 'paid' ? 'Lunas' : b.depositStatus === 'refunded' ? 'Refund' : 'Belum'}
                      </Badge>
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {b.status === 'pending_payment' && (
                      <button onClick={() => setPayOpen(b)} className="btn-primary !py-1.5 !text-xs">
                        Terima Deposit
                      </button>
                    )}
                    {b.status === 'confirmed' && (
                      <button onClick={() => updateBookingStatus(b.id, 'checked_in')} className="btn-dark !py-1.5 !text-xs">
                        Check-in Tamu
                      </button>
                    )}
                    <button onClick={() => setQrTarget(b)} className="btn-outline !py-1.5 !text-xs">
                      <QrCode className="h-3.5 w-3.5" /> QR Tiket
                    </button>
                    <button onClick={() => window.print()} className="btn-ghost !py-1.5 !text-xs">
                      <Printer className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        cancelBooking(b.id);
                        flash('Reservasi dibatalkan & deposit direfund');
                      }}
                      className="btn-ghost !py-1.5 !text-xs !text-rose-600"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Batalkan
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bayar deposit */}
      <Modal open={Boolean(payOpen)} onClose={() => setPayOpen(null)} title="Pembayaran Deposit Reservasi">
        {payOpen && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <Row label="Kode booking" value={payOpen.bookingCode} />
              <Row label="Nama tamu" value={payOpen.guestName} />
              <Row label="Meja" value={payOpen.tableNo} />
              <Row label="Total deposit" value={formatIDR(payOpen.depositAmount)} />
            </div>

            {payOpen.depositAmount > 0 ? (
              <>
                <div>
                  <label className="label">Metode Pembayaran Deposit</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(['qris', 'debit', 'credit', 'cash'] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setPayMethod(m)}
                        className={
                          payMethod === m
                            ? 'rounded-xl border-2 border-brand-500 bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700'
                            : 'rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600'
                        }
                      >
                        {PAYMENT_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => {
                    payBookingDeposit(payOpen.id, payMethod);
                    setQrTarget(payOpen);
                    setPayOpen(null);
                    flash('Deposit diterima — reservasi terkonfirmasi');
                  }}
                  className="btn-primary w-full !py-3"
                >
                  Bayar Langsung di Tempat ({PAYMENT_LABEL[payMethod]})
                </button>
                <button
                  onClick={() => void payDepositOnline(payOpen)}
                  className="btn-dark w-full !py-3"
                >
                  <CreditCard className="h-4 w-4" /> Bayar Online via Gateway
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  payBookingDeposit(payOpen.id, payMethod);
                  setPayOpen(null);
                  flash('Reservasi dikonfirmasi tanpa deposit');
                }}
                className="btn-primary w-full !py-3"
              >
                <CheckCircle2 className="h-4 w-4" /> Konfirmasi Reservasi (Tanpa Deposit)
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* QR Tiket */}
      <Modal open={Boolean(qrTarget)} onClose={() => setQrTarget(null)} title="E-Ticket Reservasi" wide>
        {qrTarget && (
          <div id="print-area" className="space-y-4">
            <div className="text-center">
              <p className="text-sm font-extrabold uppercase text-brand-600">E-Ticket Reservasi</p>
              <p className="text-xs text-slate-500">{qrTarget.bookingCode}</p>
            </div>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <QRCode value={`NUSANTARA-BOOKING:${qrTarget.bookingCode}:${qrTarget.tableNo}:${qrTarget.date}`} size={150} />
              <div className="flex-1 space-y-1.5 text-sm">
                <Row label="Nama" value={qrTarget.guestName} />
                <Row label="Tanggal" value={formatDate(qrTarget.date)} />
                <Row label="Jam" value={qrTarget.timeSlot} />
                <Row label="Meja" value={qrTarget.tableNo} />
                <Row label="Jumlah tamu" value={`${qrTarget.partySize} orang`} />
                <Row
                  label="Status deposit"
                  value={qrTarget.depositStatus === 'paid' ? `Lunas ${formatIDR(qrTarget.depositAmount)}` : 'Belum dibayar'}
                />
                <Row label="Status" value={STATUS_LABEL[qrTarget.status]} />
              </div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              Tunjukkan QR ini kepada kasir saat check-in. Pembatalan H-24 jam akan mengurangi deposit sebesar 50%.
            </div>
            <button onClick={() => window.print()} className="btn-dark w-full">
              <Printer className="h-4 w-4" /> Cetak E-Ticket
            </button>
          </div>
        )}
      </Modal>

      {/* Hasil booking */}
      <Modal open={Boolean(result)} onClose={() => setResult(null)} title="Reservasi Berhasil Dibuat">
        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <div>
                <p className="text-sm font-bold text-emerald-800">Kode Reservasi {result.bookingCode}</p>
                <p className="text-xs text-emerald-700">
                  {formatDate(result.date)} · {result.timeSlot} · {result.tableNo}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Meja ditandai <b>reserved</b>. Dalam jurnal akuntansi, deposit dicatat sebagai kewajiban
              (liabilitas) sampai tamu datang dan menampilkan QR code saat check-in.
            </p>
            <button
              onClick={() => {
                setPayOpen(result);
                setResult(null);
              }}
              className="btn-primary w-full !py-3"
            >
              Lanjut Bayar Deposit {formatIDR(result.depositAmount)}
            </button>
            <button onClick={() => setResult(null)} className="btn-outline w-full">
              Bayar nanti di tempat
            </button>
          </div>
        )}
      </Modal>

      <Toast message={toast} />
    </AppShell>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
      <span className={`h-3 w-3 rounded ${tone}`} /> {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function toneOf(status: string): Tone {
  if (status === 'confirmed') return 'green';
  if (status === 'checked_in') return 'blue';
  if (status === 'cancelled') return 'red';
  return 'amber';
}
