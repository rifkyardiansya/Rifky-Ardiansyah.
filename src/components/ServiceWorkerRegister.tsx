'use client';

import { useEffect } from 'react';

/**
 * Mendaftarkan service worker sederhana (offline shell) agar prototype
 * dapat di-install sebagai PWA. Pada versi produksi, filament ini diganti
 * Workbox (next-pwa) dengan strategi precache + runtime caching.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* prototype: diamkan kegagalan registrasi */
    });
  }, []);

  return null;
}