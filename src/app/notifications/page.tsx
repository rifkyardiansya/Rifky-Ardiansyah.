'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  CreditCard,
  Inbox,
  Mail,
  MessageSquare,
  Radio,
  RefreshCcw,
  Send,
  Webhook,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Card, EmptyState, Modal, StatCard, Toast } from '@/components/ui';
import { Api, ApiRequestError } from '@/lib/api';
import { useStore } from '@/lib/store';
import { formatDateTime, formatIDR } from '@/lib/utils';

interface NotificationRow {
  id: string;
  channel: 'email' | 'sms' | 'whatsapp';
  recipient: string;
  template: string;
  subject: string | null;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  refType: string | null;
  refId: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface PaymentRow {
  id: string;
  method: string;
  amount: number;
  referenceId: string;
  status: string;
  channel: string;
  createdAt: string;
  paidAt: string | null;
}

interface WebhookRow {
  id: string;
  provider: string;
  externalId: string;
  eventType: string;
  signatureValid: number;
  processed: number;
  createdAt: string;
}

const CHANNEL_META = {
  email: { icon: Mail, label: 'Email', tone: 'blue' as const },
  sms: { icon: MessageSquare, label: 'SMS', tone: 'violet' as const },
  whatsapp: { icon: MessageSquare, label: 'WhatsApp', tone: 'green' as const },
};

export default function NotificationsPage() {
  const { connection, liveEvent } = useStore();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [stats, setStats] = useState<{ sent: number; failed: number } | { sent: 0; failed: 0 }>({ sent: 0, failed: 0 });
  const [tab, setTab] = useState<'pesan' | 'pembayaran' | 'webhook'>('pesan');
  const [detail, setDetail] = useState<NotificationRow | null>(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const n = await Api.get<{ notifications: NotificationRow[]; stats: typeof stats }>('/notifications');
      setNotifications(n.notifications ?? []);
      setStats(n.stats ?? { sent: 0, failed: 0 });

      const p = await Api.get<{ payments: PaymentRow[]; webhooks: WebhookRow[] }>('/payment');
      setPayments(p.payments ?? []);
      setWebhooks((p.webhooks ?? []) as WebhookRow[]);
    } catch (error) {
      setToast(error instanceof ApiRequestError ? error.message : 'Gagal memuat data notifikasi.');
      setTimeout(() => setToast(''), 2500);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <AppShell
      title="Notifikasi & Payment Monitor"
      subtitle="Outbox email/SMS/WhatsApp, transaksi payment gateway, dan log webhook"
      actions={
        <button onClick={() => void load()} className="btn-outline">
          <RefreshCcw className="h-4 w-4" /> Muat ulang
        </button>
      }
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pesan Terkirim"
          value={String(stats.sent)}
          sub="email / SMS / WhatsApp"
          icon={<Send className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="Pesan Gagal"
          value={String(stats.failed)}
          sub="perlu pemeriksaan"
          icon={<Inbox className="h-5 w-5" />}
          tone={stats.failed ? 'red' : 'slate'}
        />
        <StatCard
          label="Transaksi Gateway"
          value={String(payments.length)}
          sub={`${payments.filter((p) => p.status === 'success').length} berhasil`}
          icon={<CreditCard className="h-5 w-5" />}
          tone="blue"
        />
        <StatCard
          label="Webhook"
          value={String(webhooks.length)}
          sub={`${webhooks.filter((w) => w.signatureValid).length} signature valid`}
          icon={<Webhook className="h-5 w-5" />}
          tone="violet"
        />
      </div>

      <Card className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              connection === 'live' ? 'bg-emerald-500' : connection === 'connecting' ? 'bg-amber-400' : 'bg-slate-300'
            }`}
          />
          <span className="text-sm font-semibold text-slate-700">
            Stream realtime (SSE):{' '}
            {connection === 'live' ? 'terhubung' : connection === 'connecting' ? 'menyambung…' : 'terputus'}
          </span>
        </div>
        {liveEvent && (
          <span className="font-mono text-xs text-slate-500">
            event terakhir: {liveEvent.channel}/{liveEvent.action} · {formatDateTime(liveEvent.at)}
          </span>
        )}
      </Card>

      <div className="my-4 flex flex-wrap gap-2">
        {[
          { key: 'pesan', label: 'Outbox Pesan', icon: Bell, count: notifications.length },
          { key: 'pembayaran', label: 'Payment Gateway', icon: CreditCard, count: payments.length },
          { key: 'webhook', label: 'Log Webhook', icon: Radio, count: webhooks.length },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key as typeof tab)} className={tab === t.key ? 'btn-primary' : 'btn-outline'}>
              <Icon className="h-4 w-4" /> {t.label}
              <Badge tone="slate">{t.count}</Badge>
            </button>
          );
        })}
      </div>

      {tab === 'pesan' && (
        <Card className="p-0">
          {loading && notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">Memuat…</p>
          ) : notifications.length === 0 ? (
            <EmptyState
              title="Belum ada pesan terkirim"
              hint="Pesan otomatis dibuat saat ada transaksi, reservasi, pembayaran, atau alert stok."
              icon={<Bell className="h-8 w-8" />}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((n) => {
                const meta = CHANNEL_META[n.channel] ?? CHANNEL_META.email;
                const Icon = meta.icon;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => setDetail(n)}
                      className="flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-slate-50"
                    >
                      <div className="mt-0.5 rounded-lg bg-slate-100 p-2">
                        <Icon className="h-4 w-4 text-slate-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{n.template}</span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <Badge tone={n.status === 'sent' ? 'green' : n.status === 'failed' ? 'red' : 'amber'}>
                            {n.status}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          ke <span className="font-mono">{n.recipient}</span>
                          {n.refId && (
                            <>
                              {' · ref '}
                              <span className="font-mono">{n.refId}</span>
                            </>
                          )}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-600">{n.body}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === 'pembayaran' && (
        <Card className="p-0">
          {payments.length === 0 ? (
            <EmptyState title="Belum ada transaksi gateway" hint="Buat pembayaran dari halaman kasir atau e-ticket reservasi." icon={<CreditCard className="h-8 w-8" />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">ID Transaksi</th>
                    <th className="th">Metode</th>
                    <th className="th">Channel</th>
                    <th className="th text-right">Nominal</th>
                    <th className="th">Status</th>
                    <th className="th">Dibuat</th>
                    <th className="th">Selesai</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="td font-mono text-xs font-bold">{p.referenceId}</td>
                      <td className="td uppercase">{p.method}</td>
                      <td className="td">
                        <Badge tone="slate">{p.channel}</Badge>
                      </td>
                      <td className="td text-right font-bold">{formatIDR(p.amount)}</td>
                      <td className="td">
                        <Badge tone={p.status === 'success' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="td text-xs text-slate-500">{formatDateTime(p.createdAt)}</td>
                      <td className="td text-xs text-slate-500">{p.paidAt ? formatDateTime(p.paidAt) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'webhook' && (
        <Card className="p-0">
          {webhooks.length === 0 ? (
            <EmptyState
              title="Belum ada webhook masuk"
              hint="Webhook tercatat saat gateway mengirim callback pembayaran (lihat halaman /pay/[token])."
              icon={<Radio className="h-8 w-8" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Provider</th>
                    <th className="th">External ID</th>
                    <th className="th">Event</th>
                    <th className="th">Signature</th>
                    <th className="th">Diproses</th>
                    <th className="th">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {webhooks.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50">
                      <td className="td uppercase">{w.provider}</td>
                      <td className="td font-mono text-xs">{w.externalId}</td>
                      <td className="td">{w.eventType}</td>
                      <td className="td">
                        <Badge tone={w.signatureValid ? 'green' : 'red'}>
                          {w.signatureValid ? 'valid' : 'ditolak'}
                        </Badge>
                      </td>
                      <td className="td">
                        <Badge tone={w.processed ? 'blue' : 'slate'}>{w.processed ? 'ya' : 'belum'}</Badge>
                      </td>
                      <td className="td text-xs text-slate-500">{formatDateTime(w.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={`Detail Pesan — ${detail?.template ?? ''}`}>
        {detail && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="blue">{detail.channel}</Badge>
              <Badge tone={detail.status === 'sent' ? 'green' : 'red'}>{detail.status}</Badge>
              <Badge tone="slate">{formatDateTime(detail.createdAt)}</Badge>
            </div>
            {detail.subject && <p className="text-sm font-bold text-slate-900">{detail.subject}</p>}
            <p className="text-xs text-slate-500">Penerima: {detail.recipient}</p>
            <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-mono text-xs text-slate-700">
              {detail.body}
            </pre>
          </div>
        )}
      </Modal>

      <Toast message={toast} />
    </AppShell>
  );
}