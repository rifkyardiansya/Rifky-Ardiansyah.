'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Download,
  HardDriveDownload,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { Badge, Card, Toast } from './ui';
import {
  flushPendingOrders,
  isOnline,
  listOfflineCarts,
  offlineSummary,
  type OfflineCartRow,
} from '@/lib/offlineCart';
import { Api } from '@/lib/api';
import { formatDateTime, formatIDR } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

interface Summary {
  online: boolean;
  cartCount: number;
  cartItems: number;
  pendingTotal: number;
  pendingValue: number;
}

const EMPTY_SUMMARY: Summary = {
  online: true,
  cartCount: 0,
  cartItems: 0,
  pendingTotal: 0,
  pendingValue: 0,
};

/**
 * Panel PWA:
 *  - prompt instalasi aplikasi ke home screen,
 *  - indikator koneksi & keranjang tersimpan di IndexedDB,
 *  - aktivasi push notification (status pesanan & booking),
 *  - sinkronisasi antrean pesanan offline ke server.
 */
export function PwaPanel() {
  const [online, setOnline] = useState(true);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pushState, setPushState] = useState<PushState>('default');
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [carts, setCarts] = useState<OfflineCartRow[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');

  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2600);
  }, []);

  const refresh = useCallback(async () => {
    const data = await offlineSummary();
    setOnline(data.online);
    setSummary({
      online: data.online,
      cartCount: data.cartCount,
      cartItems: data.cartItems,
      pendingTotal: data.pendingTotal,
      pendingValue: data.pendingValue,
    });
    setCarts(await listOfflineCarts());
  }, []);

  /* ---------------------------- Koneksi ---------------------------- */
  useEffect(() => {
    setOnline(isOnline());
    void refresh();

    const onOnline = () => {
      setOnline(true);
      flash('Koneksi kembali — antrean offline siap dikirim');
      void refresh();
    };
    const onOffline = () => {
      setOnline(false);
      flash('Koneksi terputus — mode offline aktif');
      void refresh();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flash, refresh]);

  /* --------------------------- Install PWA --------------------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      flash('Aplikasi berhasil dipasang');
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [flash]);

  /* ------------------------- Push notification ------------------------- */
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushState('unsupported');
      return;
    }
    setPushState(Notification.permission as PushState);
  }, []);

  async function installApp() {
    if (!installEvent) {
      flash('Gunakan menu browser "Install app" / "Add to Home Screen"');
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallEvent(null);
  }

  async function enablePush() {
    if (!('Notification' in window)) {
      flash('Browser ini tidak mendukung notifikasi');
      return;
    }
    const permission = await Notification.requestPermission();
    setPushState(permission as PushState);

    if (permission === 'granted' && 'serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.ready;
        flash('Notifikasi aktif untuk pesanan & reservasi');
      } catch {
        flash('Izin notifikasi diberikan');
      }
    }
  }

  async function syncPending() {
    setSyncing(true);
    const result = await flushPendingOrders(async (order) => {
      await Api.post('/customer/orders', {
        tableNumber: order.tableNumber,
        customerName: order.customerName,
        source: 'customer_qr',
        items: order.items,
      });
    });
    setSyncing(false);
    await refresh();
    flash(
      result.failed === 0
        ? `${result.synced} pesanan offline berhasil dikirim`
        : `${result.synced} terkirim, ${result.failed} gagal dan akan dicoba lagi`
    );
  }

  const needsAttention = !online || summary.pendingTotal > 0 || (!installed && Boolean(installEvent));

  return (
    <>
      {/* Indikator mengambang */}
      <button
        onClick={() => setPanelOpen(true)}
        className="no-print fixed bottom-4 left-4 z-40 flex flex-col items-start gap-2"
        title="Status PWA & offline"
      >
        <span className="flex flex-col gap-1.5">
          <span
            className={
              online
                ? 'inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg'
                : 'inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg'
            }
          >
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? 'Online' : 'Offline'}
          </span>

          {summary.pendingTotal > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">
              <HardDriveDownload className="h-3 w-3" /> {summary.pendingTotal} antrean
            </span>
          )}

          {needsAttention && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">
              <Download className="h-3 w-3" /> Pasang &amp; offline
            </span>
          )}
        </span>
      </button>

      {panelOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">PWA & Mode Offline</h3>
              <button onClick={() => setPanelOpen(false)} className="btn-ghost !px-2 !py-1">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <Card className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">Status koneksi</span>
                  <Badge tone={online ? 'green' : 'amber'}>{online ? 'Online' : 'Offline'}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">Aplikasi terpasang</span>
                  <Badge tone={installed ? 'green' : 'slate'}>{installed ? 'Ya' : 'Belum'}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">Push notification</span>
                  <Badge
                    tone={
                      pushState === 'granted'
                        ? 'green'
                        : pushState === 'denied'
                          ? 'red'
                          : pushState === 'unsupported'
                            ? 'slate'
                            : 'amber'
                    }
                  >
                    {pushState === 'granted'
                      ? 'Aktif'
                      : pushState === 'denied'
                        ? 'Ditolak browser'
                        : pushState === 'unsupported'
                          ? 'Tidak didukung'
                          : 'Belum diaktifkan'}
                  </Badge>
                </div>
              </Card>

              <Card className="space-y-2 p-4">
                <p className="text-sm font-bold text-slate-900">Penyimpanan Lokal (IndexedDB)</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Keranjang tersimpan</span>
                  <span className="font-semibold">
                    {summary.cartCount} ({summary.cartItems} item)
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Pesanan menunggu sinkron</span>
                  <span className="font-semibold">{summary.pendingTotal}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Nilai antrean</span>
                  <span className="font-semibold">{formatIDR(summary.pendingValue)}</span>
                </div>
                {carts.map((c) => (
                  <div key={c.tableNo} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {c.tableNo || 'default'} · {c.items.length} jenis item · {formatIDR(c.subtotal)} ·{' '}
                    {formatDateTime(c.updatedAt)}
                  </div>
                ))}
              </Card>

              <div className="grid gap-2">
                <button onClick={installApp} disabled={installed} className="btn-primary">
                  <Download className="h-4 w-4" />
                  {installed ? 'Aplikasi sudah terpasang' : 'Pasang ke Home Screen'}
                </button>
                <button
                  onClick={enablePush}
                  disabled={pushState === 'granted' || pushState === 'unsupported'}
                  className="btn-outline"
                >
                  <Bell className="h-4 w-4" /> Aktifkan Notifikasi
                </button>
                <button
                  onClick={syncPending}
                  disabled={!online || syncing || summary.pendingTotal === 0}
                  className="btn-dark"
                >
                  {syncing ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Sinkronkan Pesanan Offline ({summary.pendingTotal})
                </button>
                <button
                  onClick={() => {
                    void refresh();
                    flash('Status diperbarui');
                  }}
                  className="btn-ghost"
                >
                  <RefreshCw className="h-4 w-4" /> Muat ulang status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} />
    </>
  );
}