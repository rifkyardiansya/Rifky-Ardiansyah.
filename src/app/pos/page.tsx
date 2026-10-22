'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  Banknote,
  CreditCard,
  DoorOpen,
  FileDown,
  Minus,
  Plus,
  Printer,
  Receipt as ReceiptIcon,
  Search,
  ShoppingCart,
  Trash2,
  Wallet,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Receipt } from '@/components/Receipt';
import { Api, ApiRequestError } from '@/lib/api';
import { Badge, Card, Modal, StatCard, Toast, type Tone } from '@/components/ui';
import { useStore } from '@/lib/store';
import { ORDER_STATUS_LABEL, PAYMENT_LABEL, topProducts } from '@/lib/analytics';
import { formatDateTime, formatIDR, formatTime } from '@/lib/utils';
import type { MenuItem, Order, PaymentMethod } from '@/types';

export default function PosPage() {
  const {
    menuItems,
    tables,
    posSession,
    openSession,
    closeSession,
    orders,
    placeOrder,
    payOrder,
    voidOrder,
    updateOrderStatus,
    toggleMenuAvailability,
  } = useStore();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Semua');
  const [tableNo, setTableNo] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [cart, setCart] = useState<{ item: MenuItem; qty: number }[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [cashInput, setCashInput] = useState('');
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [zReport, setZReport] = useState(false);
  const [openShift, setOpenShift] = useState(false);
  const [closingCash, setClosingCash] = useState('');
  const [voidTarget, setVoidTarget] = useState<Order | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [toast, setToast] = useState('');

  const categories = ['Semua', ...Array.from(new Set(menuItems.map((m) => m.category)))];
  const filtered = menuItems.filter(
    (m) => (category === 'Semua' || m.category === category) && (!search || m.name.toLowerCase().includes(search.toLowerCase()))
  );

  const subtotal = cart.reduce((s, c) => s + c.item.price * c.qty, 0);
  const serviceCharge = Math.round(subtotal * 0.05);
  const tax = Math.round((subtotal + serviceCharge) * 0.1);
  const total = subtotal + serviceCharge + tax;
  const change = Math.max(0, Number(cashInput || 0) - total);
  const cashEnough = payMethod !== 'cash' || Number(cashInput || 0) >= total;

  const sessionOrders = useMemo(() => {
    if (!posSession) return [];
    return orders.filter((o) => o.source === 'pos_cashier' && o.paymentStatus === 'paid');
  }, [orders, posSession]);

  const todayOrders = useMemo(
    () => orders.filter((o) => (o.paidAt || o.createdAt).slice(0, 10) === new Date().toISOString().slice(0, 10)),
    [orders]
  );

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2200);
  }

  function addItem(item: MenuItem) {
    setCart((prev) => {
      const found = prev.find((c) => c.item.id === item.id);
      if (found) return prev.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { item, qty: 1 }];
    });
  }

  async function submitPayment() {
    const order = await placeOrder({
      items: cart.map((c) => ({ menuItem: c.item, quantity: c.qty })),
      tableNumber: tableNo || 'Takeaway',
      customerName: customerName || 'Pelanggan',
      source: 'pos_cashier',
      paymentMethod: payMethod,
      cashReceived: payMethod === 'cash' ? Number(cashInput) : undefined,
    });
    if (!order) return;
    setLastOrder(order);
    setCart([]);
    setCashInput('');
    setCustomerName('');
    setPayOpen(false);
    flash(`Transaksi ${order.orderNo} berhasil`);
  }

  /**
   * Pembayaran non-tunai melalui payment gateway:
   * order dibuat belum lunas -> arahkan kasir/customer ke halaman gateway
   * -> gateway mengirim webhook -> order otomatis lunas & jurnal tercatat.
   */
  async function payViaGateway() {
    const order = await placeOrder({
      items: cart.map((c) => ({ menuItem: c.item, quantity: c.qty })),
      tableNumber: tableNo || 'Takeaway',
      customerName: customerName || 'Pelanggan',
      source: 'pos_cashier',
    });
    if (!order) return;

    try {
      const intent = await Api.post<{ redirectUrl: string; total: number }>('/payment', {
        refType: 'order',
        refId: order.orderNo,
        method: payMethod === 'cash' ? 'qris' : payMethod,
      });
      flash('Mengalihkan ke halaman payment gateway…');
      window.location.href = intent.redirectUrl;
    } catch (error) {
      flash(error instanceof ApiRequestError ? error.message : 'Gagal membuat permintaan pembayaran');
      setPayOpen(false);
    }
  }

  const expectedCash = (posSession?.openingCash ?? 0) + sessionOrders.reduce((s, o) => s + (o.cashReceived || 0), 0);

  return (
    <AppShell
      title="Aplikasi Kasir — Point of Sale"
      subtitle="Transaksi cepat di meja, tipeahead produk, multi pembayaran, dan Z-Report shift kasir"
      wide
    >
      {!posSession?.isOpen ? (
        <Card className="mx-auto max-w-lg text-center">
          <div className="mx-auto mb-3 w-fit rounded-2xl bg-amber-100 p-3">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
          </div>
          <p className="text-base font-bold text-slate-900">Sesi kasir belum dibuka</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Buka sesi kasir terlebih dahulu untuk mulai mencatat transaksi penjualan. Sistem akan menghitung
            opening cash dan membuat Z-Report saat shift ditutup.
          </p>
          <button onClick={() => setOpenShift(true)} className="btn-primary mt-5">
            <DoorOpen className="h-4 w-4" /> Buka Sesi Kasir
          </button>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Kasir" value={posSession.cashierName.split(' ')[0]} sub={`Shift ${formatTime(posSession.startTime)}`} icon={<Wallet className="h-5 w-5" />} tone="blue" />
            <StatCard label="Transaksi Shift" value={String(posSession.totalTransactions)} sub={`Hari ini: ${todayOrders.length}`} icon={<ReceiptIcon className="h-5 w-5" />} tone="violet" />
            <StatCard label="Omzet Shift" value={formatIDR(posSession.totalRevenue)} sub="Penjualan terbayar" icon={<Banknote className="h-5 w-5" />} tone="green" />
            <StatCard label="Modal Awal" value={formatIDR(posSession.openingCash)} sub="Opening cash" icon={<Wallet className="h-5 w-5" />} tone="slate" />
            <StatCard
              label="Est. Kas di Meja"
              value={formatIDR(expectedCash)}
              sub="Modal + setoran tunai"
              icon={<Barcode className="h-5 w-5" />}
              tone="amber"
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
            {/* Katalog */}
            <div className="min-w-0 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input pl-9"
                    placeholder="Cari produk / pindai barcode..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select className="input sm:w-52" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map((m) => (
                  <button
                    key={m.id}
                    data-testid={"pos-item-" + m.id}
                    onClick={() => addItem(m)}
                    disabled={!m.available}
                    className="card flex flex-col overflow-hidden p-0 text-left transition hover:border-brand-400 disabled:opacity-50"
                  >
                    <div className="relative h-24 w-full bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.image} alt="" className="h-full w-full object-cover" />
                      {!m.available && (
                        <span className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-xs font-bold text-white">
                          Habis
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      <p className="line-clamp-2 text-xs font-bold text-slate-800">{m.name}</p>
                      <p className="mt-auto pt-2 text-sm font-extrabold text-brand-600">{formatIDR(m.price)}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Riwayat transaksi */}
              <Card>
                <p className="mb-3 text-sm font-bold text-slate-900">Transaksi Terbaru</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        <th className="th">No</th>
                        <th className="th">Waktu</th>
                        <th className="th">Meja</th>
                        <th className="th">Item</th>
                        <th className="th text-right">Total</th>
                        <th className="th">Status</th>
                        <th className="th">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orders.slice(0, 8).map((o) => (
                        <tr key={o.id} className="hover:bg-slate-50">
                          <td className="td font-semibold">{o.orderNo}</td>
                          <td className="td text-xs text-slate-500">{formatDateTime(o.createdAt)}</td>
                          <td className="td">{o.tableNumber}</td>
                          <td className="td text-xs">{o.items.length} item</td>
                          <td className="td text-right font-bold">{formatIDR(o.total)}</td>
                          <td className="td">
                            <Badge tone={orderTone(o.status)}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                          </td>
                          <td className="td">
                            <div className="flex gap-1">
                              {o.paymentStatus === 'unpaid' && (
                                <button
                                  onClick={() => {
                                    payOrder(o.id, 'cash', o.total);
                                    flash('Pembayaran diterima');
                                  }}
                                  className="rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700"
                                >
                                  Bayar
                                </button>
                              )}
                              {o.status !== 'completed' && o.status !== 'cancelled' && (
                                <button
                                  onClick={() => {
                                    setVoidTarget(o);
                                    setVoidReason('');
                                  }}
                                  className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-600"
                                >
                                  Void
                                </button>
                              )}
                              <button
                                onClick={() => setLastOrder(o)}
                                className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600"
                              >
                                Struk
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Keranjang kasir */}
            <aside className="xl:sticky xl:top-4 xl:self-start">
              <Card className="p-0">
                <div className="border-b border-slate-100 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-brand-600" />
                    <p className="text-sm font-bold text-slate-900">Keranjang Transaksi</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label">Meja</label>
                      <select className="input" value={tableNo} onChange={(e) => setTableNo(e.target.value)}>
                        <option value="">Takeaway</option>
                        {tables.map((t) => (
                          <option key={t.id} value={t.tableNo}>
                            {t.tableNo} ({t.capacity} org)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Pelanggan</label>
                      <input
                        className="input"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Nama"
                      />
                    </div>
                  </div>
                </div>

                <div data-testid="pos-cart-list" className="max-h-80 overflow-y-auto px-4 py-3">
                  {cart.length === 0 ? (
                    <p className="py-8 text-center text-sm text-slate-400">
                      Ketuk produk pada katalog untuk menambah ke keranjang.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {cart.map((c) => (
                        <li key={c.item.id} className="rounded-xl border border-slate-200 p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800">{c.item.name}</p>
                            <button
                              onClick={() => setCart((prev) => prev.filter((x) => x.item.id !== c.item.id))}
                              className="rounded p-1 text-rose-500 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() =>
                                  setCart((prev) =>
                                    prev
                                      .map((x) => (x.item.id === c.item.id ? { ...x, qty: x.qty - 1 } : x))
                                      .filter((x) => x.qty > 0)
                                  )
                                }
                                className="rounded-md bg-slate-100 p-1.5 hover:bg-slate-200"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-7 text-center text-sm font-bold">{c.qty}</span>
                              <button
                                onClick={() =>
                                  setCart((prev) =>
                                    prev.map((x) => (x.item.id === c.item.id ? { ...x, qty: x.qty + 1 } : x))
                                  )
                                }
                                className="rounded-md bg-slate-100 p-1.5 hover:bg-slate-200"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                            <span className="text-sm font-bold">{formatIDR(c.item.price * c.qty)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-1.5 border-t border-slate-100 p-4 text-sm">
                  <SumRow label="Subtotal" value={subtotal} />
                  <SumRow label="Service charge 5%" value={serviceCharge} />
                  <SumRow label="PPN 10%" value={tax} />
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-xl font-extrabold text-slate-900">
                    <span>Total</span>
                    <span>{formatIDR(total)}</span>
                  </div>
                  <button
                    onClick={() => setPayOpen(true)}
                    disabled={cart.length === 0}
                    className="btn-primary mt-2 w-full !py-3"
                  >
                    <CreditCard className="h-4 w-4" /> Proses Pembayaran
                  </button>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button onClick={() => setZReport(true)} className="btn-outline !py-2">
                      <Printer className="h-4 w-4" /> Z-Report
                    </button>
                    <button
                      onClick={() => {
                        setClosingCash(String(expectedCash));
                        setOpenShift(true);
                      }}
                      className="btn-outline !py-2"
                    >
                      <DoorOpen className="h-4 w-4" /> Tutup Shift
                    </button>
                  </div>
                </div>
              </Card>

              <Card className="mt-3">
                <p className="mb-2 text-sm font-bold text-slate-900">Produk Terlaris</p>
                <ul className="space-y-1.5">
                  {topProducts(orders, 4).map((p) => (
                    <li key={p.name} className="flex items-center justify-between text-xs">
                      <span className="truncate text-slate-600">{p.name}</span>
                      <span className="font-bold text-slate-800">{p.qty}×</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </aside>
          </div>
        </>
      )}

      {/* Buka / tutup shift */}
      <Modal
        open={openShift}
        onClose={() => {
          setOpenShift(false);
          setZReport(false);
        }}
        title={posSession?.isOpen ? 'Tutup Sesi Kasir' : 'Buka Sesi Kasir'}
      >
        {posSession?.isOpen ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <SumRow label="Modal awal" value={posSession.openingCash} />
              <SumRow label="Jumlah transaksi" value={posSession.totalTransactions} />
              <SumRow label="Omzet shift" value={posSession.totalRevenue} />
              <SumRow label="Harapan kas fisik" value={expectedCash} />
            </div>
            <div>
              <label className="label">Kas Aktual saat tutup (uang di laci)</label>
              <input
                className="input"
                inputMode="numeric"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value.replace(/\D/g, ''))}
              />
              <p className="mt-1.5 text-xs font-semibold">
                {Number(closingCash || 0) >= expectedCash ? (
                  <span className="text-emerald-600">Kas sesuai / lebih.</span>
                ) : (
                  <span className="text-rose-600">Selisih kurang: {formatIDR(expectedCash - Number(closingCash || 0))}</span>
                )}
              </p>
            </div>
            <button
              onClick={() => {
                closeSession(Number(closingCash || 0));
                setOpenShift(false);
                setZReport(false);
                flash('Shift kasir ditutup — Z-Report dicetak');
              }}
              className="btn-primary w-full"
            >
              Tutup Shift & Cetak Z-Report
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">Nama Kasir</label>
              <input className="input" defaultValue="Rifky (Kasir Utama)" id="kasir-name" />
            </div>
            <div>
              <label className="label">Modal Awal (Opening Cash)</label>
              <input className="input" inputMode="numeric" defaultValue="500000" id="opening-cash" />
            </div>
            <button
              onClick={() => {
                const name = (document.getElementById('kasir-name') as HTMLInputElement)?.value || 'Kasir';
                const cash = Number((document.getElementById('opening-cash') as HTMLInputElement)?.value || 0);
                openSession(name, cash);
                setOpenShift(false);
                flash('Sesi kasir dibuka');
              }}
              className="btn-primary w-full"
            >
              Buka Sesi
            </button>
          </div>
        )}
      </Modal>

      {/* Pembayaran */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Proses Pembayaran">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['cash', 'qris', 'debit', 'credit'] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setPayMethod(m)}
                className={
                  payMethod === m
                    ? 'rounded-xl border-2 border-brand-500 bg-brand-50 px-3 py-2.5 text-xs font-bold text-brand-700'
                    : 'rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600'
                }
              >
                {m === 'cash' ? <Banknote className="mx-auto mb-1 h-4 w-4" /> : <CreditCard className="mx-auto mb-1 h-4 w-4" />}
                {PAYMENT_LABEL[m]}
              </button>
            ))}
          </div>

          {payMethod === 'cash' && (
            <div>
              <label className="label">Uang Diterima</label>
              <input
                className="input"
                inputMode="numeric"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value.replace(/\D/g, ''))}
                placeholder={String(total)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {[total, 100000, 150000, 200000, 500000]
                  .filter((v, i, arr) => v >= total && arr.indexOf(v) === i)
                  .map((v) => (
                    <button
                      key={v}
                      onClick={() => setCashInput(String(v))}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"
                    >
                      {formatIDR(v)}
                    </button>
                  ))}
              </div>
              {cashInput && (
                <p className="mt-2 text-sm">
                  Kembalian: <span className="font-bold text-emerald-600">{formatIDR(change)}</span>
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <SumRow label="Total tagihan" value={total} />
          </div>

          <button onClick={() => void submitPayment()} disabled={!cashEnough} className="btn-primary w-full !py-3">
            Selesaikan Transaksi
          </button>
          {!cashEnough && <p className="text-center text-xs font-semibold text-rose-600">Uang diterima kurang.</p>}

          <div className="relative my-1 text-center">
            <span className="bg-white px-2 text-[11px] uppercase tracking-wide text-slate-400">atau</span>
          </div>

          <button onClick={() => void payViaGateway()} disabled={cart.length === 0} className="btn-dark w-full !py-3">
            <CreditCard className="h-4 w-4" /> Bayar Online via Gateway
          </button>
          <p className="text-center text-[11px] text-slate-500">
            Order dibuat belum lunas, lalu pelanggan diarahkan ke halaman QRIS/Kartu. Status berubah otomatis
            setelah webhook terverifikasi.
          </p>
        </div>
      </Modal>

      {/* Struk */}
      <Modal open={Boolean(lastOrder)} onClose={() => setLastOrder(null)} title="Struk Transaksi" wide>
        {lastOrder && (
          <div className="space-y-4">
            <Receipt order={lastOrder} />
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => window.print()} className="btn-dark flex-1">
                <Printer className="h-4 w-4" /> Cetak
              </button>
              <a
                href={`/api/v1/pos/receipt/${lastOrder.orderNo}/pdf`}
                className="btn-primary flex-1"
                target="_blank"
                rel="noreferrer"
              >
                <FileDown className="h-4 w-4" /> Unduh PDF 80mm
              </a>
              <button
                onClick={() => updateOrderStatus(lastOrder.id, 'served')}
                className="btn-outline flex-1"
              >
                Tandai Sudah Disajikan
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Void */}
      <Modal open={Boolean(voidTarget)} onClose={() => setVoidTarget(null)} title="Batalkan Transaksi">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Batalkan transaksi <b>{voidTarget?.orderNo}</b> ({formatIDR(voidTarget?.total ?? 0)})? Tindakan ini
            tercatat di jurnal sebagai beban operasional.
          </p>
          <input
            className="input"
            placeholder="Alasan pembatalan"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
          <button
            onClick={() => {
              if (voidTarget) {
                voidOrder(voidTarget.id, voidReason || 'Tanpa alasan');
                flash('Transaksi dibatalkan');
              }
              setVoidTarget(null);
            }}
            className="btn-danger w-full"
          >
            Ya, Batalkan Transaksi
          </button>
        </div>
      </Modal>

      {/* Z-Report */}
      <Modal open={zReport} onClose={() => setZReport(false)} title="Z-Report Harian" wide>
        <div id="print-area" className="space-y-4">
          <div className="text-center">
            <p className="text-sm font-bold uppercase">Restoran Nusantara</p>
            <p className="text-xs text-slate-500">Z-Report Shift Kasir</p>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <SumRow label="Kasir" value={posSession?.cashierName ?? '-'} raw />
            <SumRow label="Shift dibuka" value={posSession ? formatTime(posSession.startTime) : '-'} raw />
            <SumRow label="Modal awal" value={formatIDR(posSession?.openingCash ?? 0)} raw />
            <SumRow label="Jumlah transaksi" value={posSession?.totalTransactions ?? 0} raw />
            <SumRow label="Penjualan tunai" value={formatIDR(sessionOrders.filter((o) => o.paymentMethod === 'cash').reduce((s, o) => s + o.total, 0))} raw />
            <SumRow label="Penjualan non-tunai" value={formatIDR(sessionOrders.filter((o) => o.paymentMethod !== 'cash').reduce((s, o) => s + o.total, 0))} raw />
            <SumRow label="Total omzet" value={formatIDR(posSession?.totalRevenue ?? 0)} raw />
            <SumRow label="Uang tunai di laci" value={formatIDR(expectedCash)} raw />
            <SumRow label="Kas saat tutup" value={formatIDR(posSession?.closingCash ?? 0)} raw />
          </div>
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-center font-mono text-xs">
            <p>Total transaksi: {todayOrders.length}</p>
            <p>Selisih kas: {formatIDR((posSession?.closingCash ?? 0) - expectedCash)}</p>
            <p className="mt-1 text-slate-400">*** Thank you — Z-Report selesai ***</p>
          </div>
          <button onClick={() => window.print()} className="btn-dark w-full">
            <Printer className="h-4 w-4" /> Cetak Z-Report
          </button>
        </div>
      </Modal>

      <Toast message={toast} />

      {/* Produk Habis */}
      <Card className="mt-4">
        <p className="mb-2 text-sm font-bold text-slate-900">Ketersediaan Menu (kontrol dapur/admin)</p>
        <div data-testid="menu-availability" className="flex flex-wrap gap-2">
          {menuItems.map((m) => (
            <button
              key={m.id}
              onClick={() => toggleMenuAvailability(m.id)}
              className={
                m.available
                  ? 'rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200'
                  : 'rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200'
              }
            >
              {m.name} · {m.available ? 'Tersedia' : 'Habis'}
            </button>
          ))}
        </div>
      </Card>
    </AppShell>
  );
}

function orderTone(status: string): Tone {
  if (status === 'completed') return 'green';
  if (status === 'cancelled') return 'red';
  if (status === 'ready') return 'blue';
  if (status === 'cooking') return 'amber';
  return 'slate';
}

function SumRow({ label, value, raw }: { label: string; value: string | number; raw?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-800">
        {typeof value === 'number' ? formatIDR(value) : value}
      </span>
    </div>
  );
}