'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Minus,
  Package,
  Plus,
  ReceiptText,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Card, EmptyState, Modal, ProgressBar, StatCard, Toast } from '@/components/ui';
import { useStore } from '@/lib/store';
import { formatDate, formatIDR } from '@/lib/utils';
import type { RawMaterial } from '@/types';

export default function InventoryPage() {
  const {
    rawMaterials,
    suppliers,
    purchaseOrders,
    menuItems,
    createPurchaseOrder,
    receivePurchaseOrder,
    adjustStock,
  } = useStore();

  const [tab, setTab] = useState<'stok' | 'po' | 'supplier' | 'resep'>('stok');
  const [poOpen, setPoOpen] = useState(false);
  const [poSupplier, setPoSupplier] = useState(suppliers[0]?.id ?? '');
  const [poItems, setPoItems] = useState<{ rawMaterialId: string; quantity: number }[]>([]);
  const [poNotes, setPoNotes] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<RawMaterial | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('0');
  const [adjustReason, setAdjustReason] = useState('Stock opname');
  const [toast, setToast] = useState('');

  const lowStock = rawMaterials.filter((m) => m.currentStock <= m.minStock);
  const expiring = useMemo(() => {
    const limit = new Date();
    limit.setDate(limit.getDate() + 30);
    return rawMaterials.filter((m) => m.expiryDate && new Date(m.expiryDate) <= limit);
  }, [rawMaterials]);

  const totalValue = rawMaterials.reduce((s, m) => s + m.currentStock * m.unitCost, 0);

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2400);
  }

  const poTotal = poItems.reduce((sum, i) => {
    const m = rawMaterials.find((r) => r.id === i.rawMaterialId);
    return sum + (m ? m.unitCost * i.quantity : 0);
  }, 0);

  async function submitPO() {
    if (poItems.length === 0) {
      flash('Tambahkan minimal 1 bahan');
      return;
    }
    const po = await createPurchaseOrder({ supplierId: poSupplier, items: poItems, notes: poNotes });
    if (!po) return;
    setPoOpen(false);
    setPoNotes('');
    setPoItems([]);
    flash(`PO ${po.poNumber} dibuat dan dikirim ke supplier`);
  }

  function addPoItem() {
    const candidate = rawMaterials.find((m) => !poItems.some((i) => i.rawMaterialId === m.id));
    if (!candidate) return;
    setPoItems((prev) => [...prev, { rawMaterialId: candidate.id, quantity: 1 }]);
  }

  return (
    <AppShell
      title="Modul 4 — Manajemen Stok & Bahan Baku"
      subtitle="Persediaan, purchase order ke supplier, penerimaan barang (GRN), dan alert stok menipis / kedaluwarsa"
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Nilai Persediaan" value={formatIDR(totalValue)} sub={`${rawMaterials.length} jenis bahan`} icon={<Boxes className="h-5 w-5" />} tone="blue" />
        <StatCard label="Stok Menipis" value={`${lowStock.length} bahan`} sub="Perlu purchase order" icon={<AlertTriangle className="h-5 w-5" />} tone={lowStock.length ? 'red' : 'green'} />
        <StatCard label="Mendekati Kedaluwarsa" value={`${expiring.length} bahan`} sub="≤ 30 hari" icon={<CalendarClock className="h-5 w-5" />} tone={expiring.length ? 'amber' : 'slate'} />
        <StatCard
          label="Purchase Order Aktif"
          value={String(purchaseOrders.filter((p) => p.status !== 'received').length)}
          sub={`${purchaseOrders.length} PO dibuat`}
          icon={<Truck className="h-5 w-5" />}
          tone="violet"
        />
      </div>

      <div className="my-4 flex flex-wrap gap-2">
        {[
          { key: 'stok', label: 'Stok Bahan Baku', icon: Package },
          { key: 'po', label: 'Purchase Order', icon: ClipboardCheck },
          { key: 'supplier', label: 'Supplier', icon: Users },
          { key: 'resep', label: 'Resep & HPP Menu', icon: ReceiptText },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={tab === t.key ? 'btn-primary' : 'btn-outline'}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
        <button onClick={() => { setPoItems([]); setPoOpen(true); }} className="btn-dark ml-auto">
          <Plus className="h-4 w-4" /> Buat PO Baru
        </button>
      </div>

      {/* ---------------- STOK ---------------- */}
      {tab === 'stok' && (
        <div className="space-y-4">
          {lowStock.length > 0 && (
            <Card className="border-rose-200 bg-rose-50/60">
              <p className="mb-2 flex items-center gap-2 text-sm font-bold text-rose-700">
                <AlertTriangle className="h-4 w-4" /> Peringatan Stok Menipis
              </p>
              <div className="flex flex-wrap gap-2">
                {lowStock.map((m) => (
                  <span key={m.id} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                    {m.name} — sisa {m.currentStock} {m.unit} (min {m.minStock})
                  </span>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">SKU</th>
                    <th className="th">Nama Bahan</th>
                    <th className="th">Kategori</th>
                    <th className="th">Stok</th>
                    <th className="th">Minimum</th>
                    <th className="th">Harga Beli</th>
                    <th className="th">Nilai</th>
                    <th className="th">Supplier</th>
                    <th className="th">Kedaluwarsa</th>
                    <th className="th">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rawMaterials.map((m) => {
                    const ratio = (m.currentStock / Math.max(1, m.minStock)) * 100;
                    const isLow = m.currentStock <= m.minStock;
                    return (
                      <tr key={m.id} data-testid={"stock-row-" + m.id} className={isLow ? 'bg-rose-50/40' : ''}>
                        <td className="td font-mono text-xs">{m.sku}</td>
                        <td className="td font-semibold">{m.name}</td>
                        <td className="td text-xs">{m.category}</td>
                        <td className="td">
                          <span className={isLow ? 'font-bold text-rose-600' : 'font-semibold'}>
                            {m.currentStock} {m.unit}
                          </span>
                          <div className="mt-1 w-24">
                            <ProgressBar value={Math.min(100, ratio)} tone={isLow ? 'bg-rose-500' : 'bg-emerald-500'} />
                          </div>
                        </td>
                        <td className="td text-xs text-slate-500">
                          {m.minStock} {m.unit}
                        </td>
                        <td className="td">{formatIDR(m.unitCost)}/{m.unit}</td>
                        <td className="td font-bold">{formatIDR(m.currentStock * m.unitCost)}</td>
                        <td className="td text-xs">{m.supplierName}</td>
                        <td className="td text-xs">
                          {m.expiryDate ? (
                            <Badge
                              tone={
                                new Date(m.expiryDate) <= new Date()
                                  ? 'red'
                                  : new Date(m.expiryDate).getTime() - Date.now() < 30 * 86400000
                                    ? 'amber'
                                    : 'slate'
                              }
                            >
                              {formatDate(m.expiryDate)}
                            </Badge>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="td">
                          <button
                            onClick={() => {
                              setAdjustTarget(m);
                              setAdjustDelta('0');
                              setAdjustReason('Stock opname');
                            }}
                            className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600"
                          >
                            Penyesuaian
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- PURCHASE ORDER ---------------- */}
      {tab === 'po' && (
        <div className="space-y-3">
          {purchaseOrders.length === 0 ? (
            <EmptyState
              title="Belum ada purchase order"
              hint="Klik 'Buat PO Baru' untuk membuat pesanan pembelian ke supplier."
              icon={<Truck className="h-8 w-8" />}
            />
          ) : (
            purchaseOrders.map((po) => (
              <Card key={po.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-slate-900">{po.poNumber}</p>
                    <p className="text-xs text-slate-500">
                      {po.supplierName} · dibuat {formatDate(po.orderDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={po.status === 'received' ? 'green' : po.status === 'submitted' ? 'amber' : 'slate'}>
                      {po.status === 'received' ? 'Diterima (GRN)' : 'Dikirim'}
                    </Badge>
                    <span className="text-sm font-extrabold text-slate-900">{formatIDR(po.totalCost)}</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px]">
                    <thead className="border-b border-slate-100">
                      <tr>
                        <th className="th !py-2">Bahan</th>
                        <th className="th !py-2">Qty</th>
                        <th className="th !py-2">Harga</th>
                        <th className="th !py-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {po.items.map((i) => (
                        <tr key={i.rawMaterialId}>
                          <td className="td !py-2">{i.name}</td>
                          <td className="td !py-2">
                            {i.quantity} {i.unit}
                          </td>
                          <td className="td !py-2">{formatIDR(i.unitCost)}</td>
                          <td className="td !py-2 text-right font-semibold">{formatIDR(i.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {po.status !== 'received' && (
                  <button
                    onClick={() => {
                      receivePurchaseOrder(po.id);
                      flash(`Barang ${po.poNumber} diterima — stok & jurnal diperbarui`);
                    }}
                    className="btn-primary"
                  >
                    <ClipboardCheck className="h-4 w-4" /> Terima Barang (GRN)
                  </button>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {/* ---------------- SUPPLIER ---------------- */}
      {tab === 'supplier' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s) => (
            <Card key={s.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{s.name}</p>
                <Badge tone="blue">{s.paymentTerms}</Badge>
              </div>
              <p className="text-xs text-slate-600">{s.contactPerson}</p>
              <p className="text-xs text-slate-500">{s.phone}</p>
              <p className="text-xs text-slate-500">{s.email}</p>
              <p className="text-xs leading-relaxed text-slate-500">{s.address}</p>
              <div className="border-t border-slate-100 pt-2 text-xs font-semibold text-slate-700">
                {rawMaterials.filter((m) => m.supplierId === s.id).length} bahan baku aktif
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ---------------- RESEP ---------------- */}
      {tab === 'resep' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {menuItems.map((m) => {
            const estimated = (m.recipe ?? []).reduce((sum, r) => {
              const mat = rawMaterials.find((x) => x.id === r.rawMaterialId);
              return sum + (mat ? mat.unitCost * r.amountNeeded : 0);
            }, 0);
            const margin = m.price > 0 ? ((m.price - estimated) / m.price) * 100 : 0;
            return (
              <Card key={m.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">{m.name}</p>
                  <Badge tone={margin > 60 ? 'green' : margin > 40 ? 'amber' : 'red'}>Margin {margin.toFixed(0)}%</Badge>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Harga jual {formatIDR(m.price)}</span>
                  <span>HPP resep {formatIDR(estimated)}</span>
                </div>
                {!m.recipe || m.recipe.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Belum ada resep — HPP memakai estimasi manual.
                  </p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-600">
                    {m.recipe.map((r) => {
                      const mat = rawMaterials.find((x) => x.id === r.rawMaterialId);
                      return (
                        <li key={r.rawMaterialId} className="flex justify-between gap-2">
                          <span>{mat?.name ?? r.rawMaterialId}</span>
                          <span className="font-semibold">
                            {r.amountNeeded} {r.unit}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Buat PO */}
      <Modal open={poOpen} onClose={() => setPoOpen(false)} title="Buat Purchase Order" wide>
        <div className="space-y-4">
          <div>
            <label className="label">Supplier</label>
            <select className="input" value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.paymentTerms}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Daftar Bahan</label>
            <div className="space-y-2">
              {poItems.map((i, idx) => {
                const mat = rawMaterials.find((m) => m.id === i.rawMaterialId);
                return (
                  <div key={i.rawMaterialId} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2">
                    <select
                      className="input flex-1"
                      value={i.rawMaterialId}
                      onChange={(e) =>
                        setPoItems((prev) =>
                          prev.map((x, j) => (j === idx ? { ...x, rawMaterialId: e.target.value } : x))
                        )
                      }
                    >
                      {rawMaterials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input w-28"
                      inputMode="numeric"
                      value={i.quantity}
                      onChange={(e) =>
                        setPoItems((prev) =>
                          prev.map((x, j) =>
                            j === idx ? { ...x, quantity: Math.max(1, Number(e.target.value.replace(/\D/g, '') || 1)) } : x
                          )
                        )
                      }
                    />
                    <span className="w-14 text-xs text-slate-500">{mat?.unit}</span>
                    <span className="w-28 text-right text-sm font-bold">
                      {formatIDR((mat?.unitCost ?? 0) * i.quantity)}
                    </span>
                    <button
                      onClick={() => setPoItems((prev) => prev.filter((_, j) => j !== idx))}
                      className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button onClick={addPoItem} className="btn-outline mt-2">
              <Plus className="h-4 w-4" /> Tambah Bahan
            </button>
          </div>

          <div>
            <label className="label">Catatan</label>
            <input className="input" value={poNotes} onChange={(e) => setPoNotes(e.target.value)} placeholder="Contoh: kirim sebelum Jumat" />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
            <span className="text-sm font-semibold text-slate-600">Total PO</span>
            <span className="text-lg font-extrabold text-slate-900">{formatIDR(poTotal)}</span>
          </div>

          <button
            onClick={() => void submitPO()}
            className="btn-primary w-full !py-3"
          >
            <Truck className="h-4 w-4" /> Kirim Purchase Order
          </button>
        </div>
      </Modal>

      {/* Penyesuaian stok */}
      <Modal open={Boolean(adjustTarget)} onClose={() => setAdjustTarget(null)} title="Penyesuaian Stok (Stock Opname)">
        {adjustTarget && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-bold text-slate-900">{adjustTarget.name}</p>
              <p className="text-xs text-slate-500">
                Stok sistem: {adjustTarget.currentStock} {adjustTarget.unit} · harga beli {formatIDR(adjustTarget.unitCost)}/{adjustTarget.unit}
              </p>
            </div>

            <div>
              <label className="label">Selisih (+/- jumlah)</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setAdjustDelta(String(Number(adjustDelta) - 1))} className="btn-outline !px-3">
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  data-testid="adjust-delta"
                  className="input text-center"
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value.replace(/[^\-\d]/g, ''))}
                />
                <button onClick={() => setAdjustDelta(String(Number(adjustDelta) + 1))} className="btn-outline !px-3">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-600">
                Stok setelah adjustment:{' '}
                <span className="text-slate-900">
                  {Math.max(0, adjustTarget.currentStock + Number(adjustDelta || 0))} {adjustTarget.unit}
                </span>
              </p>
            </div>

            <div>
              <label className="label">Alasan</label>
              <input className="input" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
            </div>

            <button
              onClick={() => {
                const delta = Number(adjustDelta || 0);
                if (delta === 0) {
                  flash('Selisih tidak boleh nol');
                  return;
                }
                adjustStock(adjustTarget.id, delta, adjustReason);
                setAdjustTarget(null);
                flash('Penyesuaian stok dicatat ke jurnal persediaan');
              }}
              className="btn-primary w-full"
            >
              Simpan Penyesuaian
            </button>
          </div>
        )}
      </Modal>

      <Toast message={toast} />
    </AppShell>
  );
}