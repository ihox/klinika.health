'use client';

import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import { useConnectionStatus, type ConnectionState } from '@/lib/use-connection-status';

// Albanian strings — canonical per CLAUDE.md §1.5. Status labels are
// intentionally short to fit in a corner indicator without crowding
// the doctor's working surface.
const LABEL: Record<ConnectionState, string> = {
  online: 'I lidhur',
  offline: 'Pa lidhje',
  degraded: 'I kufizuar',
  unknown: 'Duke u lidhur',
};

// Color + text — no emoji in production UI (CLAUDE.md §1.12). The dot
// is a Tailwind ring; screen readers get the aria-live text.
const DOT: Record<ConnectionState, string> = {
  online: 'bg-emerald-500',
  offline: 'bg-rose-500',
  degraded: 'bg-amber-500',
  unknown: 'bg-zinc-400',
};

export interface ConnectionStatusProps {
  className?: string;
  /** Test hook — override the readiness endpoint. */
  endpoint?: string;
  /** Test hook — override the poll interval (default 30s). */
  intervalMs?: number;
}

export function ConnectionStatus({
  className,
  endpoint,
  intervalMs,
}: ConnectionStatusProps): ReactElement {
  const state = useConnectionStatus({ endpoint, intervalMs });
  return (
    <div
      role="status"
      aria-live="polite"
      data-state={state}
      className={cn(
        'pointer-events-none fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm ring-1 ring-zinc-200 backdrop-blur',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('inline-block h-2 w-2 rounded-full', DOT[state])}
      />
      <span>{LABEL[state]}</span>
    </div>
  );
}
