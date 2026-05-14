'use client';

import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useConnectionStatus, type ConnectionState } from '@/lib/use-connection-status';

// Albanian strings — canonical per CLAUDE.md §1.5 and
// design-reference/prototype/components/connection-status.html.
//
// Online is intentionally label-less: per the reference the pill is
// "subtle/invisible" when everything is fine (just a faint green dot).
// Offline raises an amber pill with the signal-broken icon. Degraded
// (API up but DB down — 503) and unknown (initial, before first probe)
// both share the reconnecting visual idiom — a pulsing amber dot — but
// keep distinct labels so support can tell them apart from screen
// readers and the test suite.
const LABEL: Record<ConnectionState, string> = {
  online: '',
  offline: 'Pa lidhje',
  degraded: 'I kufizuar',
  unknown: 'Po lidhet…',
};

export interface ConnectionStatusProps {
  className?: string;
  /** Test hook — override the readiness endpoint. */
  endpoint?: string;
  /** Test hook — override the poll interval (default 30s). */
  intervalMs?: number;
}

/**
 * Compact connection-status pill anchored to the top-right of the
 * viewport. The visual states (online / offline / reconnecting) follow
 * components/connection-status.html. Sits above page headers via
 * z-index so the corner stays usable on every screen.
 */
export function ConnectionStatus({
  className,
  endpoint,
  intervalMs,
}: ConnectionStatusProps): ReactElement {
  const state = useConnectionStatus({ endpoint, intervalMs });
  const label = LABEL[state];
  return (
    <div
      role="status"
      aria-live="polite"
      data-state={state}
      className={cn(
        'pointer-events-none fixed right-3 top-3 z-40 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium transition-all duration-200',
        toneClass(state),
        className,
      )}
    >
      <Indicator state={state} />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

function toneClass(state: ConnectionState): string {
  switch (state) {
    case 'online':
      return 'bg-transparent text-stone-400';
    case 'offline':
      return 'border border-amber-200 bg-amber-50 text-amber-700';
    case 'degraded':
    case 'unknown':
      return 'border border-stone-200 bg-stone-100 text-stone-600';
  }
}

function Indicator({ state }: { state: ConnectionState }): ReactNode {
  if (state === 'offline') {
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 4c2.5-2 7.5-2 10 0" />
        <path d="M4 7c1.5-1 5-1 6.5 0" opacity="0.7" />
        <circle cx="7" cy="11" r="0.7" fill="currentColor" />
        <path d="M2 2l10 10" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  if (state === 'degraded' || state === 'unknown') {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
      />
    );
  }
  // online — faint green dot with subtle ring halo, no label
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/15"
    />
  );
}
