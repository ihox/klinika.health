import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import {
  colorIndicatorForLastVisit,
  type LastVisitColor,
} from '@/lib/appointment-client';

const COLOR_CLASS: Record<NonNullable<LastVisitColor>, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  red: 'bg-danger',
};

const COLOR_LABEL: Record<NonNullable<LastVisitColor>, string> = {
  green: 'Vizita e fundit më shumë se 30 ditë',
  yellow: 'Vizita e fundit 7–30 ditë',
  red: 'Vizita e fundit brenda 7 ditëve',
};

// Reuses colorIndicatorForLastVisit so the dot color rule stays in
// one place — the same rule the receptionist already sees on
// calendar cards. Null lastVisitAt → no dot.
export function LastVisitDot({
  lastVisitAt,
  className,
}: {
  lastVisitAt: string | null;
  className?: string;
}): ReactElement | null {
  const color = colorIndicatorForLastVisit(lastVisitAt);
  if (!color) return null;
  return (
    <span
      aria-label={COLOR_LABEL[color]}
      title={COLOR_LABEL[color]}
      className={cn('inline-block h-2 w-2 rounded-full', COLOR_CLASS[color], className)}
    />
  );
}
