import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDb } from '../db/client';
import { ApiError } from '../http/api';
import { formatIDR } from '../../lib/utils';

/**
 * Pembuat struk PDF thermal 80mm menggunakan pdf-lib (pure JS, tanpa native
 * binding). Dipakai baik oleh kasir (cetak struk) maupun customer (unduh
 * e-receipt setelah pembayaran gateway berhasil.
 *
 * Lebar halaman 80mm = 226.77 pt, tinggi dinamis mengikuti jumlah baris item.
 */

const PAGE_WIDTH = 226.77;
const MARGIN = 12;
const LINE_HEIGHT = 11;

interface ReceiptLine {
  text: string;
  bold?: boolean;
  size?: number;
  align?: 'left' | 'center' | 'right';
  gap?: number;
}

function idr(value: number) {
  return formatIDR(value);
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  words.forEach((word) => {
    if ((current + word).length > maxChars && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = `${current}${word} `;
    }
  });
  if (current.trim()) lines.push(current.trim());
  return lines;
}

export interface ReceiptData {
  orderNo: string;
  tableNumber: string;
  customerName: string;
  source: string;
  items: { name: string; price: number; quantity: number; notes?: string | null; subtotal: number }[];
  subtotal: number;
  discount: number;
  serviceCharge: number;
  tax: number;
  total: number;
  paymentMethod: string | null;
  cashReceived: number | null;
  change: number | null;
  createdAt: string;
  paidAt: string | null;
  store: { name: string; address: string; phone: string; npwp?: string };
}

export async function buildReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const lines: ReceiptLine[] = [
    { text: data.store.name.toUpperCase(), bold: true, size: 13, align: 'center' },
    { text: data.store.address, size: 8, align: 'center' },
    { text: `Telp ${data.store.phone}${data.store.npwp ? ` · NPWP ${data.store.npwp}` : ''}`, size: 8, align: 'center' },
    { text: '================================================', size: 8, gap: 4 },
    { text: `No. Struk : ${data.orderNo}` },
    { text: `Tanggal  : ${new Date(data.createdAt).toLocaleString('id-ID')}` },
    { text: `Meja     : ${data.tableNumber}` },
    { text: `Pelanggan: ${data.customerName}` },
    { text: `Sumber   : ${data.source === 'pos_cashier' ? 'Kasir (POS)' : 'Scan Barcode (QR)'}` },
    { text: '================================================', size: 8, gap: 3 },
  ];

  data.items.forEach((item) => {
    const nameLines = wrap(`${item.quantity} x ${item.name}`, 32);
    nameLines.forEach((text, index) => {
      lines.push({ text, size: 9 });
      if (index === 0) {
        lines.push({ text: idr(item.subtotal), size: 9, align: 'right' });
      }
    });
    if (item.notes) {
      lines.push({ text: `   * ${item.notes}`, size: 8, align: 'left' });
    }
  });

  lines.push({ text: '================================================', size: 8, gap: 3 });
  lines.push({ text: `Subtotal        : ${idr(data.subtotal)}`, size: 9 });
  if (data.discount > 0) lines.push({ text: `Diskon          : - ${idr(data.discount)}`, size: 9 });
  lines.push({ text: `Service Charge 5%: ${idr(data.serviceCharge)}`, size: 9 });
  lines.push({ text: `PPN 10%         : ${idr(data.tax)}`, size: 9 });
  lines.push({ text: '--------------------------------', size: 8, gap: 2 });
  lines.push({ text: `TOTAL           : ${idr(data.total)}`, bold: true, size: 12 });
  lines.push({ text: '--------------------------------', size: 8, gap: 2 });
  lines.push({ text: `Metode Bayar    : ${paymentLabel(data.paymentMethod)}`, size: 9 });
  if (data.cashReceived) lines.push({ text: `Uang Diterima  : ${idr(data.cashReceived)}`, size: 9 });
  if (data.change) lines.push({ text: `Kembalian       : ${idr(data.change)}`, size: 9 });
  lines.push({ text: '================================================', size: 8, gap: 3 });
  lines.push({ text: 'Terima kasih telah makan di tempat kami.', size: 8, align: 'center' });
  lines.push({ text: 'Barang yang sudah dibeli tidak dapat ditukar.', size: 8, align: 'center' });
  lines.push({ text: '*** STRUK ELEKTRONIK ***', size: 8, align: 'center', gap: 2 });

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);

  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const totalHeight =
    MARGIN * 2 + lines.reduce((sum, l) => sum + (l.gap ?? 0) + LINE_HEIGHT * ((l.size ?? 9) / 9), 0);

  const page = doc.addPage([PAGE_WIDTH, totalHeight]);
  let y = totalHeight - MARGIN;

  lines.forEach((line) => {
    y -= (line.gap ?? 0);
    const size = line.size ?? 9;
    y -= LINE_HEIGHT;
    const font = line.bold ? bold : regular;
    const width = font.widthOfTextAtSize(line.text, size);
    const x =
      line.align === 'center'
        ? (PAGE_WIDTH - width) / 2
        : line.align === 'right'
          ? PAGE_WIDTH - MARGIN - width
          : MARGIN;

    page.drawText(line.text, {
      x,
      y,
      size,
      font,
      color: rgb(0.06, 0.09, 0.16),
      maxWidth: usableWidth,
    });
  });

  return doc.save();
}

function paymentLabel(method: string | null) {
  const map: Record<string, string> = {
    cash: 'TUNAI',
    qris: 'QRIS',
    debit: 'KARTU DEBIT',
    credit: 'KARTU KREDIT',
    transfer: 'VIRTUAL ACCOUNT',
  };
  return method ? (map[method] ?? method.toUpperCase()) : 'BELUM BAYAR';
}

/** Mengambil data struk siap cetak dari database. */
export function loadReceiptData(ref: string): ReceiptData {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT id, order_no, table_number, customer_name, source, subtotal, discount,
              service_charge, tax, total, payment_method, cash_received, change_amount,
              created_at, paid_at
       FROM orders WHERE id = ? OR order_no = ?`
    )
    .get(ref, ref) as Record<string, number | string | null> | undefined;

  if (!order) throw new ApiError(404, 'Struk tidak ditemukan.');

  const items = db
    .prepare('SELECT name, price, quantity, notes, subtotal FROM order_items WHERE order_id = ?')
    .all(String(order.id)) as ReceiptData['items'];

  return {
    orderNo: String(order.order_no),
    tableNumber: String(order.table_number),
    customerName: String(order.customer_name),
    source: String(order.source),
    items,
    subtotal: Number(order.subtotal),
    discount: Number(order.discount ?? 0),
    serviceCharge: Number(order.service_charge),
    tax: Number(order.tax),
    total: Number(order.total),
    paymentMethod: order.payment_method as string | null,
    cashReceived: order.cash_received === null ? null : Number(order.cash_received),
    change: order.change_amount === null ? null : Number(order.change_amount),
    createdAt: String(order.created_at),
    paidAt: order.paid_at as string | null,
    store: {
      name: 'Restoran Nusantara',
      address: 'Jl. Merdeka Raya No. 45, Jakarta',
      phone: '(021) 555-0199',
      npwp: '01.234.567.8-901.000',
    },
  };
}