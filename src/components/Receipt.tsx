'use client';

import { useStore } from '@/lib/store';
import { formatIDR } from '@/lib/utils';
import { PAYMENT_LABEL } from '@/lib/analytics';
import type { Order } from '../types';

export function Receipt({ order, storeName = 'Restoran Nusantara' }: { order: Order; storeName?: string }) {
  return (
    <div id="print-area" className="mx-auto w-[80mm] rounded-lg bg-white p-4 font-mono text-[11px] leading-tight text-slate-900">
      <div className="text-center">
        <p className="text-sm font-bold uppercase">{storeName}</p>
        <p className="text-[10px]">Jl. Merdeka Raya No. 45, Jakarta</p>
        <p className="text-[10px]">Telp: (021) 555-0199 · NPWP 01.234.567.8-901.000</p>
      </div>

      <div className="my-2 border-t border-dashed border-slate-400" />

      <div className="space-y-0.5">
        <Row label="No. Struk" value={order.orderNo} />
        <Row label="Tanggal" value={new Date(order.createdAt).toLocaleString('id-ID')} />
        <Row label="Meja" value={order.tableNumber} />
        <Row label="Kasir/Pelanggan" value={order.customerName} />
        <Row
          label="Sumber"
          value={order.source === 'pos_cashier' ? 'Kasir (POS)' : 'Scan Barcode (QR)'}
        />
      </div>

      <div className="my-2 border-t border-dashed border-slate-400" />

      <table className="w-full">
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id} className="align-top">
              <td className="py-0.5 pr-2">
                {i.name}
                {i.notes && <div className="text-[10px] italic text-slate-500">* {i.notes}</div>}
              </td>
              <td className="py-0.5 text-right whitespace-nowrap">
                {i.quantity} x {formatIDR(i.price)}
              </td>
              <td className="py-0.5 text-right">{formatIDR(i.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-2 border-t border-dashed border-slate-400" />

      <div className="space-y-0.5">
        <Row label="Subtotal" value={formatIDR(order.subtotal)} />
        {order.discount > 0 && <Row label="Diskon" value={`- ${formatIDR(order.discount)}`} />}
        <Row label="Service Charge 5%" value={formatIDR(order.serviceCharge)} />
        <Row label="PPN 10%" value={formatIDR(order.tax)} />
      </div>

      <div className="mt-1 flex justify-between border-t border-slate-900 pt-1 text-sm font-bold">
        <span>TOTAL</span>
        <span>{formatIDR(order.total)}</span>
      </div>

      <div className="mt-2 space-y-0.5">
        <Row label="Metode Bayar" value={PAYMENT_LABEL[order.paymentMethod || ''] || 'Belum dibayar'} />
        {order.cashReceived ? <Row label="Uang Diterima" value={formatIDR(order.cashReceived)} /> : null}
        {order.change ? <Row label="Kembalian" value={formatIDR(order.change)} /> : null}
        <Row
          label="Status"
          value={order.paymentStatus === 'paid' ? 'LUNAS' : order.paymentStatus.toUpperCase()}
        />
      </div>

      <div className="my-2 border-t border-dashed border-slate-400" />
      <p className="text-center text-[10px]">Terima kasih telah makan di tempat kami.</p>
      <p className="text-center text-[10px]">Barang yang sudah dibeli tidak dapat ditukar.</p>
      <p className="mt-1 text-center text-[10px]">*** STRUK ELEKTRONIK ***</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}