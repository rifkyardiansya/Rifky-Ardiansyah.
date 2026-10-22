'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn, formatIDR } from '@/lib/utils';

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <div className={cn('card p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  slate: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-rose-100 text-rose-700',
  blue: 'bg-sky-100 text-sky-700',
  violet: 'bg-violet-100 text-violet-700',
  brand: 'bg-brand-100 text-brand-700',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  children,
  tone = 'slate',
  className,
  ...rest
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
} & Record<string, unknown>) {
  return (
    <span className={cn('badge', TONES[tone], className)} {...rest}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className={cn(
          'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h3 className="font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="btn-ghost !px-2 !py-1" aria-label="Tutup">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="card flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 truncate text-xl font-extrabold text-slate-900">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
      </div>
      {icon && <div className={cn('rounded-xl p-2.5', TONES[tone])}>{icon}</div>}
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
      {icon && <div className="text-slate-300">{icon}</div>}
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value, tone = 'bg-brand-500' }: { value: number; tone?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function QRCode({ value, size = 160 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(value, {
          width: size * 2,
          margin: 1,
          color: { dark: '#0f172a', light: '#ffffff' },
        })
      )
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) {
    return <div style={{ width: size, height: size }} className="animate-pulse rounded-lg bg-slate-100" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={value} width={size} height={size} className="rounded-lg border border-slate-200" />;
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatIDR(value)}</span>;
}

export function Toast({ message, tone = 'green' }: { message: string; tone?: Tone }) {
  if (!message) return null;
  return (
    <div data-testid="toast" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 no-print">
      <div className={cn('rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg', tone === 'green' ? 'bg-emerald-600' : tone === 'red' ? 'bg-rose-600' : 'bg-slate-800')}>
        {message}
      </div>
    </div>
  );
}