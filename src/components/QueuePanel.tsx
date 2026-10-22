'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  ListChecks,
  RefreshCcw,
  Server,
  Trash2,
} from 'lucide-react';
import { Api, ApiRequestError } from '@/lib/api';
import { Badge, Card, EmptyState, StatCard, type Tone } from '@/components/ui';
import { formatDateTime } from '@/lib/utils';

/**
 * Panel monitoring antrean job & Redis (Phase 7).
 *
 * Ini yang biasanya tidak terlihat saat demo: apakah worker hidup, berapa job
 * yang menumpuk, dan job mana yang gagal permanen. Job yang gagal permanen
 * disimpan di *dead-letter queue* supaya bisa diantrekan ulang setelah penyebab
 * masalah diperbaiki — bukan hilang begitu saja.
 */

interface QueueStats {
  backend: 'redis' | 'memory';
  pending: number;
  active: number;
  completed: number;
  failed: number;
  deadLetter: number;
}

interface DeadLetter {
  job: { id: string; name: string; data: unknown; maxAttempts: number; enqueuedAt: string };
  error: string;
  attempts: number;
  failedAt: string;
}

interface HistoryItem {
  id: string;
  name: string;
  status: 'completed' | 'failed';
  durationMs: number;
  error?: string;
  at: string;
}

interface Schedule {
  name: string;
  kind: string;
  builtIn: boolean;
  nextRunAt: string;
}

interface QueueSnapshot {
  backend: 'redis' | 'memory';
  redis: { configured: boolean; url: string | null; connected: boolean };
  workerAlive: boolean;
  stats: QueueStats;
  deadLetter: DeadLetter[];
  history: HistoryItem[];
  jobs: string[];
  schedules: Schedule[];
}

export function QueuePanel() {
  const [data, setData] = useState<QueueSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await Api.get<QueueSnapshot>('/admin/queue'));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function retryDeadLetter() {
    setBusy(true);
    setMessage('');
    try {
      const result = await Api.post<{ requeued: number }>('/admin/queue', { limit: 20 });
      setMessage(`${result.requeued} job diantrekan ulang.`);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : 'Gagal/antrekan ulang.');
    } finally {
      setBusy(false);
    }
  }

  async function purgeDeadLetter() {
    setBusy(true);
    setMessage('');
    try {
      const result = await Api.del<{ purged: number }>('/admin/queue');
      setMessage(`${result.purged} job dibuang dari dead-letter.`);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : 'Gagal membuang job.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return <Card><p className="text-sm text-slate-500">Memuat status antrean…</p></Card>;
  }

  if (!data) {
    return (
      <Card>
        <EmptyState
          title="Status antrean tidak dapat dimuat"
          hint="Endpoint monitoring tidak merespons. Periksa apakah server berjalan."
          icon={<AlertTriangle className="h-8 w-8" />}
        />
      </Card>
    );
  }

  const { stats, redis } = data;
  const usingRedis = stats.backend === 'redis';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Backend Antrean"
          value={usingRedis ? 'Redis' : 'In-Memory'}
          sub={
            usingRedis
              ? data.workerAlive
                ? 'terhubung · worker hidup'
                : redis.connected
                  ? 'terhubung · worker mati'
                  : 'belum terhubung'
              : 'tanpa REDIS_URL'
          }
          icon={<Server className="h-5 w-5" />}
          tone={usingRedis && data.workerAlive ? 'green' : 'slate'}
        />
        <StatCard label="Tertunda" value={String(stats.pending)} sub="menunggu worker" icon={<Inbox className="h-5 w-5" />} tone="blue" />
        <StatCard label="Sedang Jalan" value={String(stats.active)} sub="diproses sekarang" icon={<Clock className="h-5 w-5" />} tone="violet" />
        <StatCard label="Selesai" value={String(stats.completed)} sub="berhasil" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
        <StatCard
          label="Gagal Permanen"
          value={String(stats.deadLetter)}
          sub="menunggu tindakan"
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={stats.deadLetter > 0 ? 'red' : 'slate'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void load()} className="btn-outline !py-2" disabled={loading}>
          <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
        </button>
        <button onClick={() => void retryDeadLetter()} className="btn-primary !py-2" disabled={busy || stats.deadLetter === 0}>
          <ListChecks className="h-4 w-4" /> Antrikan Ulang Job Gagal
        </button>
        <button onClick={() => void purgeDeadLetter()} className="btn-outline !py-2" disabled={busy || stats.deadLetter === 0}>
          <Trash2 className="h-4 w-4" /> Buang Job Gagal
        </button>
        {message && <span className="text-sm text-slate-600">{message}</span>}
      </div>

      <Card className="p-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-sm font-bold text-slate-900">Job Gagal Permanen (Dead-Letter Queue)</p>
          <p className="text-xs text-slate-500">
            Job yang sudah habis percobaan. Tidak dihapus otomatis agar bisa diperiksa dan diantrekan ulang.
          </p>
        </div>
        {data.deadLetter.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Tidak ada job gagal"
              hint="Semua pekerjaan yang diproses berhasil. Dead-letter queue akan terisi bila ada job yang gagal terus-menerus."
              icon={<CheckCircle2 className="h-8 w-8" />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Job</th>
                  <th className="th">Percobaan</th>
                  <th className="th">Gagal Pada</th>
                  <th className="th">Penyebab</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.deadLetter.map((entry) => (
                  <tr key={entry.job.id}>
                    <td className="td">
                      <Badge tone="violet">{entry.job.name}</Badge>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">{entry.job.id}</p>
                    </td>
                    <td className="td">{entry.attempts}×</td>
                    <td className="td text-xs">{formatDateTime(entry.failedAt)}</td>
                    <td className="td max-w-md text-xs text-rose-700">{entry.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-sm font-bold text-slate-900">Riwayat Pekerjaan Terakhir</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Waktu</th>
                  <th className="th">Job</th>
                  <th className="th">Hasil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.history.length === 0 ? (
                  <tr>
                    <td className="td text-center text-xs text-slate-500" colSpan={3}>
                      Belum ada riwayat pekerjaan pada proses ini.
                    </td>
                  </tr>
                ) : (
                  data.history.map((item) => (
                    <tr key={`${item.id}-${item.at}`}>
                      <td className="td text-xs">{formatDateTime(item.at)}</td>
                      <td className="td">
                        <span className="text-xs font-semibold">{item.name}</span>
                        <p className="text-[11px] text-slate-500">{item.durationMs} ms</p>
                      </td>
                      <td className="td">
                        <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-sm font-bold text-slate-900">Jadwal Otomatis</p>
            <p className="text-xs text-slate-500">
              Dijalankan oleh <span className="font-mono">npm run worker</span> — tidak bergantung cron eksternal.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Job</th>
                  <th className="th">Pola</th>
                  <th className="th">Dijalankan Berikutnya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.schedules.length === 0 ? (
                  <tr>
                    <td className="td text-center text-xs text-slate-500" colSpan={3}>
                      Worker belum berjalan, jadi belum ada jadwal terdaftar.
                    </td>
                  </tr>
                ) : (
                  data.schedules.map((schedule) => (
                    <tr key={schedule.name}>
                      <td className="td">
                        <span className="text-xs font-semibold">{schedule.name}</span>
                      </td>
                      <td className="td">
                        <Badge tone={schedule.builtIn ? 'blue' : 'slate'}>{schedule.kind}</Badge>
                      </td>
                      <td className="td text-xs">{formatDateTime(schedule.nextRunAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {usingRedis && !data.workerAlive && (
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <p className="text-sm text-slate-600">
              <span className="font-semibold">Worker tidak berjalan.</span> Antrean Redis sudah aktif, tetapi
              belum ada proses yang mengambil job. Jalankan{' '}
              <span className="font-mono text-xs">npm run worker</span> — tanpa itu, job yang diantrekan akan
              menumpuk dan jadwal harian tidak akan dieksekusi.
            </p>
          </div>
        </Card>
      )}

      {!usingRedis && (
        <Card>
          <p className="text-sm text-slate-600">
            Saat ini memakai antrean <span className="font-semibold">in-memory</span>. Isi{' '}
            <span className="font-mono text-xs">REDIS_URL</span> lalu jalankan{' '}
            <span className="font-mono text-xs">npm run worker</span> untuk mengaktifkan antrean terpusat,
            dead-letter yang bertahan melewati restart, dan jadwal harian otomatis.
          </p>
        </Card>
      )}
    </div>
  );
}

function statusTone(status: HistoryItem['status']): Tone {
  return status === 'completed' ? 'green' : 'red';
}
