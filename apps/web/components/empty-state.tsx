import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type EmptyStateTone = 'default' | 'amber' | 'red';

interface EmptyStateProps {
  /** Optional uppercase code label above the title (e.g. "Gabim 404"). */
  code?: string;
  title: string;
  subtitle?: ReactNode;
  /** Schematic icon — no illustrations or mascots per the reference. */
  icon: ReactNode;
  /** Up to two action buttons rendered below the subtitle. */
  actions?: ReactNode;
  tone?: EmptyStateTone;
  /** Taller min-height variant used by 404 / 403 / network-error screens. */
  tall?: boolean;
  className?: string;
}

const ICON_TONE: Record<EmptyStateTone, string> = {
  default: 'border-stone-200 bg-stone-100 text-stone-400',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
};

/**
 * Empty/error-state primitive matching
 * design-reference/prototype/components/empty-states.html — small
 * iconed circle, optional code label, title, one-sentence subtitle, up
 * to two actions. Schematic only; no illustrations.
 */
export function EmptyState({
  code,
  title,
  subtitle,
  icon,
  actions,
  tone = 'default',
  tall = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-lg border border-stone-200 bg-white text-center shadow-xs',
        tall ? 'min-h-[320px] px-7 py-9' : 'min-h-[240px] px-6 py-7',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'mb-2 grid h-14 w-14 place-items-center rounded-full border',
          ICON_TONE[tone],
        )}
      >
        {icon}
      </div>
      {code ? (
        <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-stone-400">
          {code}
        </div>
      ) : null}
      <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">{title}</h3>
      {subtitle ? (
        <div className="max-w-[320px] text-[13px] leading-relaxed text-stone-500">{subtitle}</div>
      ) : null}
      {actions ? <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
