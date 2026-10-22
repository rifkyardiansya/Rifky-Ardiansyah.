'use client';

import type { RestaurantTable } from '@/types';

export function FloorMap({
  tables,
  onPick,
}: {
  tables: RestaurantTable[];
  onPick?: (t: RestaurantTable) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-slate-50 p-4">
      <div className="relative mx-auto" style={{ width: 1000, height: 620, maxWidth: '100%' }}>
        <div className="absolute inset-x-0 top-0 h-[42%] rounded-2xl border-2 border-dashed border-slate-300 bg-white/70">
          <span className="absolute left-3 top-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Indoor Utama
          </span>
        </div>
        <div className="absolute right-0 top-0 h-[42%] w-[28%] rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/70">
          <span className="absolute left-3 top-2 text-[11px] font-bold uppercase tracking-wide text-violet-500">
            VIP Room
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[52%] rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/70">
          <span className="absolute left-3 top-2 text-[11px] font-bold uppercase tracking-wide text-emerald-600">
            Outdoor Garden
          </span>
        </div>

        {tables.map((t) => {
          const color =
            t.status === 'occupied' ? 'bg-sky-400' : t.status === 'reserved' ? 'bg-violet-400' : 'bg-emerald-400';
          return (
            <button
              key={t.id}
              onClick={onPick ? () => onPick(t) : undefined}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-xl ${color} text-[10px] font-bold text-white shadow transition hover:scale-105 ${
                onPick ? 'cursor-pointer' : 'cursor-default'
              }`}
              style={{ left: `${t.x}%`, top: `${t.y}%`, width: 76, height: 62 }}
            >
              <span className="text-[11px] font-extrabold">{t.tableNo}</span>
              <span className="opacity-90">{t.capacity} org</span>
              <span className="mt-0.5 rounded bg-black/20 px-1 text-[9px] uppercase">
                {t.status === 'occupied' ? 'isi' : t.status === 'reserved' ? 'reservasi' : 'kosong'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}