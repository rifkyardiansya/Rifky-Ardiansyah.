import { subscribe, type RealtimeEvent } from '@/server/realtime/bus';
import { getSessionUser } from '@/server/auth/token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/v1/events — Server-Sent Events (SSE).
 *
 * Dipakai Kitchen Display System & Customer Portal agar status pesanan
 * berubah tanpa perlu refresh halaman. SSE dipilih karena:
 *  - built-in di browser (EventSource), tanpa library tambahan,
 *  - otomatis reconnect,
 *  - cukup untuk alur satu arah (server -> client).
 *
 * Untuk alur dua arah (chat, sinkronisasi kasir multi-terminal) blueprint
 * menyiapkan Socket.io pada versi production.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RealtimeEvent | { channel: 'system'; action: string; payload: Record<string, unknown>; at: string }) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.channel}\ndata: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          /* koneksi sudah tertutup */
        }
      };

      // Event awal: konfirmasi koneksi berhasil
      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      send({
        channel: 'system',
        action: 'connected',
        payload: { user: user?.username ?? 'guest', role: user?.role ?? 'customer' },
        at: new Date().toISOString(),
      });

      unsubscribe = subscribe(send);

      // Heartbeat agar proxy tidak memutus koneksi idle
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* ignore */
        }
      }, 20000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  req.signal.addEventListener('abort', () => {
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}