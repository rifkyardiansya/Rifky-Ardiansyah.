import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const TAX_RATE = 0.1; // PPN 10%
export const SERVICE_RATE = 0.05; // Service charge 5%
export const DEPOSIT_RATE = 0.25; // Uang muka reservasi 25%

export function formatIDR(value: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

export function formatDateTime(iso: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTime(iso: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

export interface Totals {
  subtotal: number;
  serviceCharge: number;
  tax: number;
  discount: number;
  total: number;
}

export function calcTotals(subtotal: number, discount = 0): Totals {
  const netSubtotal = Math.max(0, subtotal - discount);
  const serviceCharge = Math.round(netSubtotal * SERVICE_RATE);
  const tax = Math.round((netSubtotal + serviceCharge) * TAX_RATE);
  return {
    subtotal,
    serviceCharge,
    tax,
    discount,
    total: netSubtotal + serviceCharge + tax,
  };
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}