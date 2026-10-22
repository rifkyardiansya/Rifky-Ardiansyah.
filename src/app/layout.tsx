import type { Metadata, Viewport } from 'next';
import './globals.css';
import { StoreProvider } from '@/lib/store';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'Restoran Nusantara — Sistem Informasi Restoran Terintegrasi',
  description:
    'Prototype aplikasi web restoran: pemesanan scan barcode, kasir POS, booking meja, manajemen stok, dan laporan keuangan.',
  applicationName: 'Restoran Nusantara',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Restoran Nusantara',
  },
};

export const viewport: Viewport = {
  themeColor: '#ea580c',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <StoreProvider>{children}</StoreProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}