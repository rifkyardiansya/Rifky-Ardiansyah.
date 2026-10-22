'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, Banknote, CheckCircle2, Clock, CreditCard, Loader2, QrCode, ShieldCheck, XCircle } from 'lucide-react';
import { Api, ApiRequestError, type SessionPayload } from '@/lib/api';
import { Badge, Card } from '@/components/ui';
import { QRCode } from '@/components/ui';
import { formatDateTime, formatIDR } from '@/lib/utils';

interface Intent {
  externalId: string;
  refType: 'order' | 'booking';
  refId: string;
  method: string;
  channel: string;
  amount: number;
  fee: number;
  total: number;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  qrPayload: string | null;
  expiresAt: string;
  createdAt: string;
}

const METHOD_META: Record<string, { label: string; icon: typeof Banknote; desc: string }> = {
  qris: { label: 'QRIS', icon: QrCode, desc: 'Pindai QRIS pada aplikasi m-banking Anda' },
  debit: { label: 'Kartu Debit', icon: CreditCard, desc: 'Gesek kartu pada terminal' },
  credit: { label: 'Kartu Kredit', icon: CreditCard, desc: 'Masukkan kartu kredit' },
  transfer: { label: 'Virtual Account', icon: Banknote, desc: 'Transfer ke nomor VA yang ditampilkan' },
};

export default function PaymentPage() {
  const params = useParams<{ token: string }>();
  const token = String(params.token);

  const [intent, setIntent] = useState<Intent | null>(null);
  const [user, setUser] = useState<SessionPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await Api.get<Intent>(`/payment/${token}`)) as Intent;
      setIntent(data);
      setError('');
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Gagal memuat data pembayaran.');
    }
  }, [token]);

  useEffect(() => {
    void load();
    Api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
  }, [load]);

  useEffect(() => {
    if (!intent) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(intent.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [intent]);

  /** Meniru perilaku gateway: kirim webhook ke merchant setelah "pembayaran". */
  async function simulatePay(outcome: 'capture' | 'deny' | 'expire') {
    if (!intent) return;
    setBusy(true);
    setResult(null);

    const payload = {
      provider: 'midtrans',
      externalId: intent.externalId,
      eventType: 'payment',
      transactionStatus: outcome,
      amount: intent.total,
    };

    // Signature dihitung server agar konsisten dengan verifikasi HMAC.
    const signature = await Api.post<{ signature: string }>('/webhooks/payment-gateway/sign', payload)
      .then((r) => r.signature)
      .catch(() => null);

    if (!signature) {
      setBusy(false);
      setError('Tidak dapat membuat signature webhook.');
      return;
    }

    const res = await fetch('/api/v1/webhooks/payment-gateway', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': signature },
      body: JSON.stringify(payload),
    });

    const json = (await res.json()) as { success: boolean; data?: { message: string; status: string }; error?: string };
    setBusy(false);

    if (json.success && json.data) {
      setResult({ ok: json.data.status === 'paid', message: json.data.message });
      if (json.data.status === 'paid') {
        await load();
        return;
      }
    } else {
      setResult({ ok: false, message: json.error ?? 'Pembayaran gagal diproses.' });
    }
    await load();
  }

  const meta = intent ? (METHOD_META[intent.channel] ?? METHOD_META.qris) : null;
  const expired = secondsLeft === 0;
  const settled = intent?.status === 'paid' || result?.ok;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="mx-auto max-w-md">
        <header className="mb-4 flex items-center gap-3 text-white">
          <div className="rounded-xl bg-brand-600 p-2">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-extrabold">Payment Gateway (Simulasi)</p>
            <p className="text-[11px] text-slate-400">Menggantikan halaman Midtrans/Xendit saat produksi</p>
          </div>
        </header>

        {error && (
          <Card className="mb-4 border-rose-200 bg-rose-50 text-rose-700">
            <p className="text-sm font-semibold">{error}</p>
            <Link href="/customer" className="mt-2 inline-block text-xs font-bold underline">
              Kembali ke aplikasi
            </Link>
          </Card>
        )}

        {!intent && !error && (
          <Card className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat transaksi…
          </Card>
        )}

        {intent && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {intent.refType === 'order' ? 'Pembayaran Pesanan' : 'Deposit Reservasi'}
                  </p>
                  <p className="text-lg font-extrabold text-slate-900">{intent.refId}</p>
                </div>
                <Badge tone={settled ? 'green' : intent.status === 'pending' ? 'amber' : 'red'}>
                  {settled ? 'LUNAS' : intent.status.toUpperCase()}
                </Badge>
              </div>

              <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
                <Row label="Metode" value={meta?.label ?? intent.method.toUpperCase()} />
                <Row label="Nominal" value={formatIDR(intent.amount)} />
                {intent.fee > 0 && <Row label="Biaya admin" value={formatIDR(intent.fee)} />}
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-extrabold">
                  <span>Total Bayar</span>
                  <span className="text-brand-600">{formatIDR(intent.total)}</span>
                </div>
                <Row label="ID Transaksi" value={intent.externalId} mono />
                <Row label="Dibuat" value={formatDateTime(intent.createdAt)} />
              </div>

              {!settled && intent.status === 'pending' && !expired && (
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  Berlaku {String(Math.floor((secondsLeft ?? 0) / 60)).padStart(2, '0')}:
                  {String((secondsLeft ?? 0) % 60).padStart(2, '0')} menit
                </p>
              )}
            </Card>

            {/* QRIS */}
            {intent.channel === 'qris' && intent.qrPayload && !settled && (
              <Card className="text-center">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Pindai QRIS</p>
                <div className="flex justify-center">
                  <QRCode value={intent.qrPayload} size={200} />
                </div>
                <p className="mt-3 break-all rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-500">
                  {intent.qrPayload}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  String QR di atas mengikuti format EMVCo (CRC16-CCITT) seperti QRIS statis Bank Pusat.
                </p>
              </Card>
            )}

            {/* Metode non-QRIS */}
            {intent.channel === 'va' && !settled && (
              <Card className="text-center">
                <Banknote className="mx-auto mb-2 h-8 w-8 text-slate-400" />
                <p className="text-xs font-semibold text-slate-500">Nomor Virtual Account</p>
                <p className="font-mono text-xl font-extrabold text-slate-900">8808 1234 5678 9012</p>
                <p className="mt-1 text-xs text-slate-500">a.n. Restoran Nusantara</p>
              </Card>
            )}

            {/* Aksi simulasi */}
            {!settled && intent.status === 'pending' && !expired && (
              <Card className="space-y-2">
                <p className="text-center text-xs text-slate-500">
                  Gateway asli akan memanggil webhook merchant secara otomatis. Klik tombol di bawah untuk
                  menyimulasikan proses tersebut.
                </p>
                <button onClick={() => void simulatePay('capture')} disabled={busy} className="btn-primary w-full !py-3">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Simulasikan Pembayaran Berhasil
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => void simulatePay('deny')} disabled={busy} className="btn-outline !py-2">
                    <XCircle className="h-4 w-4" /> Gagal / Ditolak
                  </button>
                  <button onClick={() => void simulatePay('expire')} disabled={busy} className="btn-outline !py-2">
                    <AlertTriangle className="h-4 w-4" /> Kedaluwarsa
                  </button>
                </div>
              </Card>
            )}

            {settled && (
              <Card className="border-emerald-200 bg-emerald-50 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-600" />
                <p className="text-sm font-extrabold text-emerald-800">Pembayaran Berhasil</p>
                <p className="mt-1 text-xs text-emerald-700">{result?.message ?? 'Status pesanan sudah diperbarui.'}</p>
                <p className="mt-3 rounded-lg bg-white/70 p-2 text-[11px] text-emerald-800">
                  Webhook telah diverifikasi (HMAC-SHA512), order ditandai lunas, jurnal akuntansi otomatis
                  tercatat, dan notifikasi dikirim ke kasir.
                </p>
              </Card>
            )}

            {result && !result.ok && (
              <Card className="border-rose-200 bg-rose-50 text-center">
                <XCircle className="mx-auto mb-2 h-8 w-8 text-rose-600" />
                <p className="text-sm font-bold text-rose-700">{result.message}</p>
              </Card>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={`/api/v1/pos/receipt/${intent.refId}/pdf`}
                className="btn-outline flex-1"
              >
                Unduh Struk PDF
              </Link>
              <Link href={user ? '/pos' : '/customer'} className="btn-dark flex-1">
                Selesai
              </Link>
            </div>

            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" /> Demo ini tidak 연결 ke bank sungguhan. Tidak ada uang
              riil yang berpindah.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-semibold text-slate-800 ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  );
}