'use client';

import Dexie, { type EntityTable } from 'dexie';
import type { CartItem } from '@/types';

/**
 * Penyimpanan offline (IndexedDB) untuk PWA.
 *
 * Skenario yang ditangani:
 *  - pelanggan di area poor signal tetap bisa memilih menu dan isi keranjang,
 *  - keranjang tetap ada setelah browser ditutup / perangkat dimatikan,
 *  - ketika koneksi kembali, keranjang dapat dikirim ke server (flush),
 *  - antrean pesanan offline tercatat agar kasir tidak kehilangan transaksi.
 */

export interface OfflineCartRow {
  tableNo: string;
  items: CartItem[];
  subtotal: number;
  updatedAt: string;
}

export interface PendingOrder {
  id?: number;
  clientRef: string;
  tableNumber: string;
  customerName: string;
  items: { menuItemId: string; quantity: number; notes?: string }[];
  total: number;
  status: 'queued' | 'synced' | 'failed';
  error?: string;
  createdAt: string;
}

class RestaurantDatabase extends Dexie {
  cart!: EntityTable<OfflineCartRow, 'tableNo'>;
  pendingOrders!: EntityTable<PendingOrder, 'id'>;
  meta!: EntityTable<{ key: string; value: unknown }, 'key'>;

  constructor() {
    super('restoran-nusantara');

    this.version(1).stores({
      // tableNo sebagai primary key -> hanya satu keranjang aktif per meja
      cart: '&tableNo, updatedAt',
      pendingOrders: '++id, clientRef, status, createdAt',
      meta: '&key',
    });
  }
}

export const db = new RestaurantDatabase();

/* ------------------------------- Cart ------------------------------- */

export async function saveOfflineCart(row: OfflineCartRow) {
  try {
    await db.cart.put(row);
    return true;
  } catch {
    return false;
  }
}

export async function loadOfflineCart(tableNo = 'default') {
  try {
    return (await db.cart.get(tableNo)) ?? null;
  } catch {
    return null;
  }
}

export async function clearOfflineCart(tableNo = 'default') {
  try {
    await db.cart.delete(tableNo);
  } catch {
    /* abaikan */
  }
}

export async function listOfflineCarts() {
  try {
    return await db.cart.toArray();
  } catch {
    return [];
  }
}

/* ---------------------------- Pending order ---------------------------- */

export async function queuePendingOrder(order: Omit<PendingOrder, 'id' | 'status' | 'createdAt'>) {
  const row: PendingOrder = {
    ...order,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  try {
    await db.pendingOrders.add(row);
    return row;
  } catch {
    return null;
  }
}

export async function listPendingOrders() {
  try {
    return await db.pendingOrders.orderBy('createdAt').reverse().toArray();
  } catch {
    return [];
  }
}

export async function pendingCount() {
  try {
    return await db.pendingOrders.where('status').equals('queued').count();
  } catch {
    return 0;
  }
}

export interface FlushResult {
  synced: number;
  failed: number;
  remaining: number;
}

/**
 * Mengirim antrean pesanan offline ke server satu per satu.
 * Pesanan yang berhasil ditandai `synced`, yang gagal tetap `queued`
 * agar dapat dicoba lagi pada kesempatan berikutnya.
 */
export async function flushPendingOrders(send: (order: PendingOrder) => Promise<void>): Promise<FlushResult> {
  const queued = await db.pendingOrders.where('status').equals('queued').toArray();
  let synced = 0;
  let failed = 0;

  for (const order of queued) {
    try {
      await send(order);
      await db.pendingOrders.update(order.id as number, { status: 'synced' });
      synced += 1;
    } catch (error) {
      await db.pendingOrders.update(order.id as number, {
        status: 'queued',
        error: error instanceof Error ? error.message : 'Gagal mengirim',
      });
      failed += 1;
    }
  }

  return { synced, failed, remaining: await pendingCount() };
}

/* -------------------------------- Meta -------------------------------- */

export async function setMeta(key: string, value: unknown) {
  try {
    await db.meta.put({ key, value });
  } catch {
    /* abaikan */
  }
}

export async function getMeta<T>(key: string): Promise<T | null> {
  try {
    const row = await db.meta.get(key);
    return (row?.value as T) ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------ Utilitas ------------------------------ */

export function isOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

/** Ringkasan untuk UI. */
export async function offlineSummary() {
  const [carts, pending, online] = await Promise.all([listOfflineCarts(), listPendingOrders(), Promise.resolve(isOnline())]);
  const queued = pending.filter((p) => p.status === 'queued');
  return {
    online,
    cartCount: carts.length,
    cartItems: carts.reduce((s, c) => s + c.items.reduce((a, i) => a + i.quantity, 0), 0),
    pendingTotal: queued.length,
    pendingValue: queued.reduce((s, p) => s + p.total, 0),
    pending,
  };
}