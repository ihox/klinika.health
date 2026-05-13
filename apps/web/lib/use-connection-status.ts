'use client';

import { useEffect, useRef, useState } from 'react';

import { apiUrl } from './api';

export type ConnectionState = 'online' | 'offline' | 'degraded' | 'unknown';

interface UseConnectionStatusOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Override the readiness endpoint — primarily for tests. */
  endpoint?: string;
}

/**
 * Polls `/health/ready` every `intervalMs` (default 30s) and surfaces a
 * connection state. The poll uses `navigator.onLine` as a fast-path
 * during full network drops so the UI flips to "offline" without
 * waiting for the next interval. A 503 from the readiness endpoint
 * surfaces as `degraded` — the DB is down but the API process is up,
 * which is meaningfully different from a network outage.
 *
 * The hook is SSR-safe: it returns `'unknown'` on the first render and
 * only kicks off polling after mount.
 */
export function useConnectionStatus(
  options: UseConnectionStatusOptions = {},
): ConnectionState {
  const intervalMs = options.intervalMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const endpoint = options.endpoint ?? '/health/ready';

  const [state, setState] = useState<ConnectionState>('unknown');
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function probe(): Promise<void> {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!cancelled) setState('offline');
        return;
      }

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(apiUrl(endpoint), {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store',
        });
        clearTimeout(timer);
        if (cancelled) return;
        if (res.ok) {
          setState('online');
        } else if (res.status === 503) {
          setState('degraded');
        } else {
          setState('offline');
        }
      } catch {
        clearTimeout(timer);
        if (!cancelled) setState('offline');
      }
    }

    void probe();
    const id = window.setInterval(probe, intervalMs);

    function onOnline(): void {
      void probe();
    }
    function onOffline(): void {
      setState('offline');
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      inFlight.current?.abort();
    };
  }, [intervalMs, timeoutMs, endpoint]);

  return state;
}
