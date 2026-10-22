'use client';

import { useEffect, useRef, useState } from 'react';

export interface RealtimeEvent {
  channel: string;
  action: string;
  payload: Record<string, unknown>;
  at: string;
}

export type ConnectionState = 'connecting' | 'live' | 'offline';

/**
 * Hook realtime berbasis Server-Sent Events.
 *
 * EventSource otomatis reconnect; setiap pesan dari server (mis. "pesanan baru
 * masuk dapur") memicu callback onEvent sehingga UI dapat memuat ulang data
 * tanpa polling. Ini menggantikan mekanisme `storage` event yang sebelumnya
 * dipakai untuk sinkronisasi antar tab.
 */
export function useRealtime(onEvent?: (event: RealtimeEvent) => void) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (typeof window === 'undefined' || !('EventSource' in window)) {
      setState('offline');
      return;
    }

    const source = new EventSource('/api/v1/events');
    let opened = false;

    source.onopen = () => {
      opened = true;
      setState('live');
    };

    source.onerror = () => {
      setState(opened ? 'offline' : 'connecting');
    };

    const handle = (raw: MessageEvent) => {
      try {
        const event = JSON.parse(raw.data) as RealtimeEvent;
        setLastEvent(event);
        handlerRef.current?.(event);
      } catch {
        /* abaikan frame yang tidak valid */
      }
    };

    ['order', 'booking', 'inventory', 'payment', 'notification', 'session', 'system'].forEach((channel) => {
      source.addEventListener(channel, handle as EventListener);
    });

    return () => {
      source.close();
      setState('offline');
    };
  }, []);

  return { state, lastEvent };
}