import { EventEmitter } from 'node:events';

export type RealtimeChannel = 'order' | 'booking' | 'inventory' | 'payment' | 'notification' | 'session';

export interface RealtimeEvent {
  channel: RealtimeChannel;
  action: string;
  payload: Record<string, unknown>;
  at: string;
}

/**
 * Bus event in-process untuk realtime antar modul.
 *
 * Backend saat ini berjalan sebagai satu proses Next.js, jadi EventEmitter
 * global cukup. Bila nanti dipecah menjadi microservice (sesuai blueprint),
 * ganti implementasi ini dengan Redis Pub/Sub atau Socket.io — kontrak
 * publish()/subscribe() tetap sama sehingga service tidak perlu berubah.
 */

const globalKey = '__restoEventBus';

declare global {
  // eslint-disable-next-line no-var
  var __restoEventBus: EventEmitter | undefined;
}

function bus(): EventEmitter {
  if (!global[globalKey]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    global[globalKey] = emitter;
  }
  return global[globalKey];
}

export function publish(channel: RealtimeChannel, payload: Record<string, unknown>, action = 'update') {
  const event: RealtimeEvent = { channel, action, payload, at: new Date().toISOString() };
  bus().emit('event', event);
  return event;
}

export function subscribe(listener: (event: RealtimeEvent) => void): () => void {
  bus().on('event', listener);
  return () => bus().off('event', listener);
}

/** Berapa subscriber yang sedang terhubung (untuk debug/dashboard). */
export function listenerCount() {
  return bus().listenerCount('event');
}