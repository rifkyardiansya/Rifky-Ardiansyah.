'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import { Modal } from './ui';

/**
 * Pemindai barcode/QR berbasis kamera (html5-qrcode — turunan ZXing).
 * intensively: scanning berhenti otomatis setelah kode valid terbaca.
 */
export function BarcodeScanner({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const regionId = useRef<string>(`scanner-${Math.random().toString(36).slice(2, 9)}`);
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const handled = useRef(false);

  useEffect(() => {
    if (!open) return;

    let scanner: import('html5-qrcode').Html5Qrcode | null = null;
    let cancelled = false;
    handled.current = false;

    async function start() {
      setStatus('starting');
      setMessage('Meminta izin kamera…');
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        scanner = new Html5Qrcode(regionId.current, /* verbose */ false);
        const config = {
          fps: 10,
          qrbox: (w: number, h: number) => ({ width: Math.min(w, h) * 0.75, height: Math.min(w, h) * 0.5 }),
        };

        const instance = scanner;
        await instance.start(
          { facingMode: 'environment' },
          config,
          (decodedText: string) => {
            if (handled.current) return;
            handled.current = true;
            onDetected(decodedText.trim());
            stop();
          },
          () => {
            /* frame tanpa kode — abaikan */
          }
        );

        if (cancelled) {
          void instance.stop().catch(() => undefined);
          return;
        }
        setStatus('running');
        setMessage('Arahkan kamera ke QR barcode pada meja.');
      } catch (error) {
        setStatus('error');
        setMessage(
          error instanceof Error && error.name === 'NotAllowedError'
            ? 'Izin kamera ditolak. Gunakan input kode manual di bawah.'
            : 'Kamera tidak tersedia pada perangkat/environment ini. Gunakan input kode manual.'
        );
      }
    }

    function stop() {
      if (scanner) {
        void scanner.stop().catch(() => undefined);
        try {
          scanner.clear();
        } catch {
          /* ignore */
        }
        scanner = null;
      }
      setStatus('idle');
    }

    void start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onDetected]);

  return (
    <Modal open={open} onClose={onClose} title="Scan Barcode dengan Kamera">
      <div className="space-y-4">
        <div
          id={regionId.current}
          className="min-h-[280px] w-full overflow-hidden rounded-xl bg-slate-900"
        />

        <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {status === 'error' ? (
            <CameraOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
          )}
          <span>{message || 'Scanner siap digunakan.'}</span>
        </div>

        <p className="text-xs text-slate-500">
          Kamera memerlukan koneksi <code>https://</code> atau <code>localhost</code>. Bila tidak tersedia, gunakan
          tombol pintasan barcode meja pada halaman utama.
        </p>

        <button onClick={onClose} className="btn-outline w-full">
          <Camera className="h-4 w-4" /> Tutup Scanner
        </button>
      </div>
    </Modal>
  );
}