'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  History,
  Minus,
  Plus,
  QrCode,
  ScanLine,
  Search,
  ShoppingBag,
  Smartphone,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { Receipt } from '@/components/Receipt';
import { Badge, Card, EmptyState, Modal, Toast } from '@/components/ui';
import { useStore } from '@/lib/store';
import { ORDER_STATUS_LABEL, PAYMENT_LABEL } from '@/lib/analytics';
import { SERVICE_RATE, TAX_RATE, calcTotals, formatIDR, relativeTime } from '@/lib/utils';
import type { MenuItem, Order, PaymentMethod } from '@/types';

const CATEGORIES = ['Semua', 'Makanan Utama', 'Minuman', 'Camilan', 'Dessert', 'Paket Hemat'] as const;

function tableBarcode(tableNo: string) {
  return `NT-${tableNo.replace(/\s+/g, '').toUpperCase()}`;
}

export default function CustomerPage() {
  const {
    menuItems,
    tables,
    cart,
    cartTable,
    cartSubtotal,
    addToCart,
    updateCartQty,
    removeFromCart,
    clearCart,
    setCartTable,
    placeOrder,
    orders,
    updateOrderStatus,
  } = useStore();

  const [step, setStep] = useState<'scan' | 'menu' | 'history'>('scan');
  const [barcode, setBarcode] = useState('');
  const [scanError, setScanError] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Semua');
  const [search, setSearch] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('qris');
  const [cashInput, setCashInput] = useState('');
  const [guestName, setGuestName] = useState('');
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [toast, setToast] = useState('');
  const [notesFor, setNotesFor] = useState<MenuItem | null>(null);
  const [notesText, setNotesText] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const totals = calcTotals(cartSubtotal);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  const filteredMenu = useMemo(
    () =>
      menuItems.filter((m) => {
        const matchCategory = category === 'Semua' || m.category === category;
        const q = search.toLowerCase();
        const matchSearch = !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
        return matchCategory && matchSearch && m.available;
      }),
    [menuItems, category, search]
  );

  const myOrders = useMemo(
    () => orders.filter((o) => o.source === 'customer_qr').slice(0, 8),
    [orders]
  );

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 2200);
  }

  function handleScan(override?: string) {
    const code = (override ?? barcode).trim().toUpperCase();
    if (!code) return;
    if (code === 'TAKEAWAY' || code === 'NT-TAKEAWAY') {
      setCartTable('Takeaway');
      setBarcode('');
      setStep('menu');
      flash('Mode Takeaway aktif');
      return;
    }
    const table = tables.find((t) => tableBarcode(t.tableNo) === code);
    if (!table) {
      setScanError(`Kode "${code}" tidak dikenali. Gunakan kode yang tertera di QR meja.`);
      return;
    }
    setScanError('');
    setCartTable(table.tableNo);
    setBarcode('');
    setStep('menu');
    flash(`Berhasil scan ${table.tableNo}`);
  }

  function quickScan(tableNo: string) {
    setCartTable(tableNo);
    setStep('menu');
    flash(`Meja ${tableNo.replace('Meja ', '')} dipilih — silakan pilih menu`);
  }

  function handleAdd(item: MenuItem) {
    addToCart(item, 1);
    flash(`${item.name} ditambahkan ke keranjang`);
  }

  async function submitOrder() {
    if (cart.length === 0) return;
    const order = await placeOrder({
      items: cart,
      tableNumber: cartTable || 'Takeaway',
      customerName: guestName || 'Tamu Restoran Nusantara',
      source: 'customer_qr',
    });
    if (!order) return;
    setLastOrder(order);
    clearCart();
    setCheckoutOpen(false);
    setCartOpen(false);
    setGuestName('');
    setCashInput('');
    flash('Pesanan berhasil dibuat dan dikirim ke dapur');
  }

  const change = payMethod === 'cash' ? Math.max(0, Number(cashInput || 0) - totals.total) : 0;
  const cashEnough = payMethod !== 'cash' || Number(cashInput || 0) >= totals.total;

  return (
    <AppShell
      title="Customer Portal — Pesan dengan Scan Barcode"
      subtitle="Simulasi experience pelanggan: scan QR meja → pilih menu → bayar → pesanan masuk ke dapur"
    >
      {/* Langkah */}
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold">
        {[
          { key: 'scan', label: '1. Scan Meja' },
          { key: 'menu', label: '2. Pilih Menu' },
          { key: 'history', label: '3. Riwayat' },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key as typeof step)}
            className={
              step === s.key
                ? 'rounded-full bg-slate-900 px-3 py-1.5 text-white'
                : 'rounded-full bg-white px-3 py-1.5 text-slate-500 ring-1 ring-slate-200'
            }
          >
            {s.label}
          </button>
        ))}
        {cartTable && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1.5 text-brand-700">
            <QrCode className="h-3.5 w-3.5" /> {cartTable}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {step === 'scan' && (
            <div className="space-y-4">
              <Card>
                <p className="mb-1 text-sm font-bold text-slate-900">Scan QR / Barcode Meja</p>
                <p className="mb-4 text-sm text-slate-500">
                  Pada aplikasi nyata scanner kamera (ZXing/Quagga) akan membaca QR code di meja. Untuk demo, ketik
                  kode barcode meja atau pilih salah satu tombol pintasan di bawah.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    data-testid="barcode-input"
                    className="input flex-1"
                    placeholder="Contoh: NT-MEJA01"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                  />
                  <button onClick={() => handleScan()} className="btn-primary">
                    <ScanLine className="h-4 w-4" /> Scan
                  </button>
                </div>
                {scanError && (
                  <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
                    {scanError}
                  </p>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button onClick={() => setScannerOpen(true)} className="btn-primary justify-start">
                    <ScanLine className="h-4 w-4" /> Scan dengan Kamera
                  </button>
                  <button
                    onClick={() => {
                      setCartTable('Takeaway');
                      setStep('menu');
                      flash('Mode Takeaway aktif');
                    }}
                    className="btn-outline justify-start"
                  >
                    <Smartphone className="h-4 w-4 text-brand-600" /> Ambil Away / Bungkus
                  </button>
                  {tables
                    .filter((t) => t.status !== 'occupied')
                    .slice(0, 6)
                    .map((t) => (
                      <button key={t.id} onClick={() => quickScan(t.tableNo)} className="btn-outline justify-start">
                        <QrCode className="h-4 w-4 text-slate-400" />
                        <span className="flex-1 text-left">
                          {t.tableNo}
                          <span className="ml-1 text-xs text-slate-400">({t.capacity} org)</span>
                        </span>
                      </button>
                    ))}
                </div>
              </Card>

              <Card>
                <p className="mb-3 text-sm font-bold text-slate-900">Kode Barcode Meja (untuk demo)</p>
                <div className="flex flex-wrap gap-2">
                  {tables.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setBarcode(tableBarcode(t.tableNo))}
                      className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left hover:border-brand-400 hover:bg-brand-50"
                    >
                      <p className="font-mono text-xs font-bold text-slate-700">{tableBarcode(t.tableNo)}</p>
                      <p className="text-[11px] text-slate-500">{t.section}</p>
                    </button>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {step === 'menu' && (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button onClick={() => setStep('scan')} className="btn-outline sm:w-auto">
                  <ChevronLeft className="h-4 w-4" /> Ganti meja
                </button>
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input pl-9"
                    placeholder="Cari menu (nasi, kopi, ayam...)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={
                      category === c
                        ? 'whitespace-nowrap rounded-full bg-brand-600 px-3.5 py-1.5 text-xs font-bold text-white'
                        : 'whitespace-nowrap rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200'
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>

              {filteredMenu.length === 0 ? (
                <EmptyState
                  title="Menu tidak ditemukan"
                  hint="Coba kata kunci lain atau pilih kategori berbeda."
                  icon={<Search className="h-8 w-8" />}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {filteredMenu.map((m) => (
                    <div key={m.id} data-testid={"menu-item-" + m.id} className="card overflow-hidden">
                      <div className="relative h-36 w-full overflow-hidden bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.image} alt={m.name} className="h-full w-full object-cover" />
                        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {m.category}
                        </span>
                      </div>
                      <div className="p-4">
                        <p className="text-sm font-bold text-slate-900">{m.name}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{m.description}</p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-base font-extrabold text-brand-600">{formatIDR(m.price)}</p>
                            <p className="text-[10px] text-slate-400">
                              HPP ± {formatIDR(m.costPrice)} · {m.barcode}
                            </p>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => {
                                setNotesFor(m);
                                setNotesText('');
                              }}
                              className="btn-outline !px-2.5 !py-1.5"
                              title="Tambah catatan"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button onClick={() => handleAdd(m)} className="btn-primary !px-3 !py-1.5">
                              <ShoppingBag className="h-4 w-4" /> Tambah
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'history' && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-900">Riwayat Pesanan Saya</p>
                <Badge tone="blue">{myOrders.length} pesanan</Badge>
              </div>
              {myOrders.length === 0 ? (
                <EmptyState title="Belum ada pesanan" hint="Mulai pesan dengan scan meja terlebih dahulu." />
              ) : (
                <ul className="space-y-3">
                  {myOrders.map((o) => (
                    <li key={o.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">
                            {o.orderNo} · {o.tableNumber}
                          </p>
                          <p className="text-xs text-slate-500">
                            {o.items.length} item · {relativeTime(o.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            tone={
                              o.status === 'completed'
                                ? 'green'
                                : o.status === 'cancelled'
                                  ? 'red'
                                  : o.status === 'ready'
                                    ? 'blue'
                                    : 'amber'
                            }
                          >
                            {ORDER_STATUS_LABEL[o.status]}
                          </Badge>
                          <span className="text-sm font-extrabold text-slate-900">{formatIDR(o.total)}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {o.items.map((i) => (
                          <span key={i.id} className="rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                            {i.quantity}× {i.name}
                          </span>
                        ))}
                      </div>
                      {o.status === 'ready' && (
                        <button onClick={() => updateOrderStatus(o.id, 'served')} className="btn-primary mt-3 !py-1.5">
                          <CheckCircle2 className="h-4 w-4" /> Konfirmasi diterima
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        {/* Keranjang */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p data-testid="cart-title" className="text-sm font-bold text-slate-900">Keranjang</p>
              <Badge data-testid="cart-count" tone={cartCount ? 'brand' : 'slate'}>{cartCount} item</Badge>
            </div>

            <div className="max-h-[45vh] overflow-y-auto px-4 py-3 lg:max-h-[52vh]">
              {cart.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Keranjang masih kosong. Pilih menu terlebih dahulu.
                </p>
              ) : (
                <ul className="space-y-3">
                  {cart.map((c) => (
                    <li key={c.menuItem.id} className="flex gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.menuItem.image} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{c.menuItem.name}</p>
                        {c.notes && <p className="truncate text-[11px] italic text-slate-500">Catatan: {c.notes}</p>}
                        <p className="text-xs font-bold text-slate-700">
                          {formatIDR(c.menuItem.price * c.quantity)}
                        </p>
                        <div className="mt-1 flex items-center gap-1">
                          <button
                            onClick={() => updateCartQty(c.menuItem.id, c.quantity - 1)}
                            className="rounded-md bg-slate-100 p-1 hover:bg-slate-200"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-6 text-center text-sm font-bold">{c.quantity}</span>
                          <button
                            onClick={() => updateCartQty(c.menuItem.id, c.quantity + 1)}
                            className="rounded-md bg-slate-100 p-1 hover:bg-slate-200"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => removeFromCart(c.menuItem.id)}
                            className="ml-auto rounded-md p-1 text-rose-500 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm">
              <div data-testid="cart-subtotal">
                <Row label="Subtotal" value={formatIDR(totals.subtotal)} />
              </div>
              <Row label={`Service charge ${SERVICE_RATE * 100}%`} value={formatIDR(totals.serviceCharge)} />
              <Row label={`PPN ${TAX_RATE * 100}%`} value={formatIDR(totals.tax)} />
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold text-slate-900">
                <span>Total</span>
                <span data-testid="cart-subtotal">{formatIDR(totals.total)}</span>
              </div>
            </div>

            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={() => setCheckoutOpen(true)}
                disabled={cart.length === 0}
                className="btn-primary flex-1"
              >
                <Wallet className="h-4 w-4" /> Bayar Sekarang
              </button>
              <button onClick={() => setCartOpen(!cartOpen)} className="btn-outline lg:hidden">
                <ShoppingBag className="h-4 w-4" />
              </button>
            </div>
          </Card>

          <Card className="mt-3">
            <p className="mb-2 text-sm font-bold text-slate-900">Status Pesanan Aktif</p>
            {orders.filter((o) => o.source === 'customer_qr' && !['completed', 'cancelled'].includes(o.status)).length ===
            0 ? (
              <p className="text-xs text-slate-500">Tidak ada pesanan aktif.</p>
            ) : (
              <ul className="space-y-2">
                {orders
                  .filter((o) => o.source === 'customer_qr' && !['completed', 'cancelled'].includes(o.status))
                  .map((o) => (
                    <li key={o.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <span className="font-semibold text-slate-700">{o.orderNo}</span>
                      <Badge tone="amber">{ORDER_STATUS_LABEL[o.status]}</Badge>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      {/* Scanner kamera */}
      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(code) => {
          setScannerOpen(false);
          setBarcode(code);
          handleScan(code);
        }}
      />

      {/* Modal mobile cart */}
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Keranjang Belanja">
        <ul className="space-y-3">
          {cart.map((c) => (
            <li key={c.menuItem.id} className="flex items-center justify-between gap-2">
              <span className="text-sm text-slate-700">
                {c.quantity}× {c.menuItem.name}
              </span>
              <span className="text-sm font-bold">{formatIDR(c.menuItem.price * c.quantity)}</span>
            </li>
          ))}
        </ul>
      </Modal>

      {/* Catatan menu */}
      <Modal open={Boolean(notesFor)} onClose={() => setNotesFor(null)} title={`Catatan untuk ${notesFor?.name ?? ''}`}>
        <textarea
          className="input h-24"
          placeholder="Contoh: Pedas 3, tanpa sambal,well done"
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
        />
        <div className="mt-4 flex gap-2">
          <button
            className="btn-outline flex-1"
            onClick={() => {
              if (notesFor) addToCart(notesFor, 1, notesText || undefined);
              setNotesFor(null);
            }}
          >
            <Plus className="h-4 w-4" /> Tambah
          </button>
          <button
            className="btn-dark flex-1"
            onClick={() => {
              if (notesFor) addToCart(notesFor, 2, notesText || undefined);
              setNotesFor(null);
            }}
          >
            <Plus className="h-4 w-4" /> Tambah 2
          </button>
        </div>
      </Modal>

      {/* Checkout */}
      <Modal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Checkout & Pembayaran">
        <div className="space-y-4">
          <div>
            <label className="label">Nama Pemesan (opsional)</label>
            <input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Contoh: Budi" />
          </div>

          <div>
            <label className="label">Meja / Layanan</label>
            <div className="flex flex-wrap gap-2">
              {['Takeaway', ...tables.map((t) => t.tableNo)].map((t) => (
                <button
                  key={t}
                  onClick={() => setCartTable(t)}
                  className={
                    cartTable === t
                      ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white'
                      : 'rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600'
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Metode Pembayaran</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['qris', 'cash', 'debit', 'credit'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={
                    payMethod === m
                      ? 'rounded-xl border-2 border-brand-500 bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700'
                      : 'rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600'
                  }
                >
                  {m === 'cash' ? <Wallet className="mx-auto mb-1 h-4 w-4" /> : <CreditCard className="mx-auto mb-1 h-4 w-4" />}
                  {PAYMENT_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {payMethod === 'cash' && (
            <div>
              <label className="label">Uang yang Dibayar</label>
              <input
                className="input"
                inputMode="numeric"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value.replace(/\D/g, ''))}
                placeholder={String(totals.total)}
              />
              <div className="mt-2 flex gap-2">
                {[totals.total, 100000, 150000, 200000]
                  .filter((v, i, arr) => v >= totals.total && arr.indexOf(v) === i)
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
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  Kembalian: <span className="text-emerald-600">{formatIDR(change)}</span>
                </p>
              )}
            </div>
          )}

          <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
            <Row label="Subtotal" value={formatIDR(totals.subtotal)} />
            <Row label="Service charge" value={formatIDR(totals.serviceCharge)} />
            <Row label="PPN" value={formatIDR(totals.tax)} />
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold">
              <span>Total Bayar</span>
              <span>{formatIDR(totals.total)}</span>
            </div>
          </div>

          <button
            onClick={() => void submitOrder()}
            disabled={!cashEnough || cart.length === 0}
            className="btn-primary w-full !py-3"
          >
            {payMethod === 'cash' ? 'Bayar Tunai & Kirim Pesanan' : 'Bayar & Kirim Pesanan'}
          </button>
          {!cashEnough && (
            <p className="text-center text-xs font-semibold text-rose-600">Uang yang dibayar belum cukup.</p>
          )}
        </div>
      </Modal>

      {/* Sukses */}
      <Modal
        open={Boolean(lastOrder)}
        onClose={() => setLastOrder(null)}
        title="Pesanan Berhasil Dibuat"
        wide
      >
        {lastOrder && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <div>
                <p className="text-sm font-bold text-emerald-800">Nomor Pesanan {lastOrder.orderNo}</p>
                <p className="text-xs text-emerald-700">
                  Pesanan sudah diteruskan ke dapur. Estimasi penyajian 10-15 menit.
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Instructions: pesanan dibuat & menunggu dapur
                </p>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  {lastOrder.items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-3">
                      <span>
                        {i.quantity}× {i.name}
                        {i.notes && <span className="text-xs italic text-slate-400"> ({i.notes})</span>}
                      </span>
                      <span className="font-semibold">{formatIDR(i.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-sm">
                  <Row label="Subtotal" value={formatIDR(lastOrder.subtotal)} />
                  <Row label="Service + PPN" value={formatIDR(lastOrder.serviceCharge + lastOrder.tax)} />
                  <Row label="Total" value={formatIDR(lastOrder.total)} />
                  <Row label="Status pembayaran" value={lastOrder.paymentStatus === 'paid' ? 'LUNAS' : 'Bayar di kasir'} />
                </div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Receipt order={lastOrder} />
                <button onClick={() => window.print()} className="btn-dark w-full">
                  Cetak Struk
                </button>
                <button data-testid="close-success" onClick={() => setLastOrder(null)} className="btn-outline w-full">
                  <X className="h-4 w-4" /> Tutup
                </button>
              </div>
            </div>
            <button
              onClick={() => {
                setLastOrder(null);
                setStep('history');
              }}
              className="btn-outline w-full"
            >
              <History className="h-4 w-4" /> Lihat riwayat pesanan
            </button>
          </div>
        )}
      </Modal>

      <Toast message={toast} />
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}