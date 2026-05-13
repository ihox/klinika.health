import { cn } from '@/lib/utils';

type ChipTone = 'green' | 'amber' | 'red' | 'stone';

interface StatusChipProps {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}

const tones: Record<ChipTone, { bg: string; dot: string; text: string }> = {
  green: { bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-900' },
  amber: { bg: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500', text: 'text-amber-900' },
  red: { bg: 'bg-red-50 border-red-200', dot: 'bg-red-500', text: 'text-red-900' },
  stone: { bg: 'bg-stone-100 border-stone-200', dot: 'bg-stone-400', text: 'text-stone-700' },
};

/**
 * Color + text status chip. Non-negotiable rule #12 — no emoji to
 * communicate state. Color carries the urgency, the dot marks it
 * visually for color-blind users, the text says it explicitly.
 */
export function StatusChip({ tone, children, className }: StatusChipProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11.5px] font-medium',
        t.bg,
        t.text,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />
      {children}
    </span>
  );
}

export function clinicStatusTone(status: 'active' | 'suspended'): ChipTone {
  return status === 'active' ? 'green' : 'amber';
}

export function clinicStatusLabel(status: 'active' | 'suspended'): string {
  return status === 'active' ? 'Aktive' : 'Pezullim';
}
