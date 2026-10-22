'use client';

import { useEffect, useState } from 'react';
import { BellRing, ChefHat, CheckCheck, Clock, Flame, Volume2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Card, EmptyState, type Tone } from '@/components/ui';
import { useStore } from '@/lib/store';
import { ORDER_STATUS_LABEL } from '@/lib/analytics';
import { cn, formatIDR, relativeTime } from '@/lib/utils';
import type { Order } from '@/types';

const FLOW: Order['status'][] = ['pending', 'cooking', 'ready', 'served', 'completed'];

export default function KitchenPage() {
  const { orders, updateOrderStatus } = useStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const active = orders.filter((o) => ['pending', 'cooking', 'ready'].includes(o.status));
  const done = orders.filter((o) => ['served', 'completed'].includes(o.status)).slice(0, 8);
  const pendingCount = orders.filter((o) => o.status === 'pending').length;

  function nextStatus(order: Order) {
    const idx = FLOW.indexOf(order.status);
    return idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : order.status;
  }

  return (
    <AppShell
      title="Kitchen Display System"
      subtitle="Papan pesanan dapur — data tersinkron otomatis antar tab browser dengan kasir & customer portal"
      actions={
        pendingCount > 0 ? (
          <Badge tone="red">
            <BellRing className="h-3.5 w-3.5" /> {pendingCount} pesanan baru
          </Badge>
        ) : (
          <Badge tone="green">Semua pesanan diproses</Badge>
        )
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {(['pending', 'cooking', 'ready'] as Order['status'][]).map((status) => {
          const list = active.filter((o) => o.status === status);
          return (
            <div key={status} className="space-y-3">
              <div
                className={cn(
                  'flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold',
                  status === 'pending' ? 'bg-rose-100 text-rose-700' : status === 'cooking' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
                )}
              >
                <span className="flex items-center gap-2">
                  {status === 'pending' ? <BellRing className="h-4 w-4" /> : status === 'cooking' ? <Flame className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
                  {status === 'pending' ? 'Pesanan Masuk' : status === 'cooking' ? 'Sedang Dimasak' : 'Siap Disajikan'}
                </span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">{list.length}</span>
              </div>

              {list.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-400">
                  Tidak ada pesanan
                </div>
              ) : (
                list.map((o) => {
                  const minutes = Math.floor((now - new Date(o.createdAt).getTime()) / 60000);
                  const late = minutes > 15;
                  return (
                    <Card key={o.id} data-testid={"kds-card-" + o.orderNo} className={cn('space-y-3', late && 'border-rose-300 bg-rose-50/40')}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-extrabold text-slate-900">{o.orderNo}</p>
                          <p className="text-xs text-slate-500">
                            {o.tableNumber} · {o.source === 'pos_cashier' ? 'Kasir' : 'Scan QR'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={cn('text-xs font-bold', late ? 'text-rose-600' : 'text-slate-500')}>
                            <Clock className="inline h-3 w-3" /> {minutes} menit
                          </p>
                          <p className="text-[11px] text-slate-400">{relativeTime(o.createdAt)}</p>
                        </div>
                      </div>

                      <ul className="space-y-1.5 rounded-lg bg-slate-50 p-3">
                        {o.items.map((i) => (
                          <li key={i.id} className="flex items-start justify-between gap-2 text-sm">
                            <span className="font-semibold text-slate-800">
                              <span className="mr-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-white">
                                {i.quantity}
                              </span>
                              {i.name}
                              {i.notes && <span className="block pl-6 text-[11px] italic text-amber-700">* {i.notes}</span>}
                            </span>
                            <span className="text-xs font-semibold text-slate-500">{formatIDR(i.subtotal)}</span>
                          </li>
                        ))}
                      </ul>

                      <button
                        onClick={() => updateOrderStatus(o.id, nextStatus(o))}
                        className={cn(
                          'btn w-full',
                          status === 'pending' ? 'btn-primary' : status === 'cooking' ? 'btn-dark' : 'btn-outline'
                        )}
                      >
                        {status === 'pending'
                          ? 'Mulai Masak'
                          : status === 'cooking'
                            ? 'Tandai Siap'
                            : 'Sudah Disajikan'}
                      </button>
                    </Card>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {/* Riwayat */}
      <Card className="mt-4">
        <p className="mb-3 text-sm font-bold text-slate-900">Riwayat Pesanan Dapur</p>
        {done.length === 0 ? (
          <EmptyState title="Belum ada pesanan selesai" icon={<ChefHat className="h-8 w-8" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">No. Pesanan</th>
                  <th className="th">Meja</th>
                  <th className="th">Item</th>
                  <th className="th">Total</th>
                  <th className="th">Status</th>
                  <th className="th">Waktu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {done.map((o) => (
                  <tr key={o.id}>
                    <td className="td font-semibold">{o.orderNo}</td>
                    <td className="td">{o.tableNumber}</td>
                    <td className="td text-xs">{o.items.length} item</td>
                    <td className="td font-bold">{formatIDR(o.total)}</td>
                    <td className="td">
                      <Badge tone={toneOf(o.status)}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </td>
                    <td className="td text-xs text-slate-500">{relativeTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-slate-900 p-2.5">
            <Volume2 className="h-5 w-5 text-white" />
          </div>
          <div className="text-sm text-slate-600">
            <p className="font-bold text-slate-900">Caraaning demo realtime</p>
            <p className="mt-1 text-xs">
              Buka modul <b>Kasir (POS)</b> atau <b>Customer Portal</b> di tab lain, lalu buat transaksi baru.
              Papan dapur di halaman ini akan langsung berubah karena state disimpan di localStorage dan
              disinkronkan antar tab (event <code>storage</code>). Pada versi produksi, lapisan ini diganti
              Socket.io / WebSocket untuk notifikasi push ke dapur.
            </p>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}

function toneOf(status: string): Tone {
  if (status === 'completed') return 'green';
  if (status === 'served') return 'blue';
  return 'slate';
}