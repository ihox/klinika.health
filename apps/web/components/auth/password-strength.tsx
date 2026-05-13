'use client';

import { useEffect, useState } from 'react';
import { authClient, type PasswordStrength as Strength } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

const STRENGTH_LABELS: Record<Strength, { label: string; bars: number; tone: string }> = {
  empty: { label: '—', bars: 0, tone: 'text-stone-400' },
  weak: { label: 'I dobët', bars: 1, tone: 'text-amber-700' },
  fair: { label: 'I dobët', bars: 2, tone: 'text-amber-700' },
  medium: { label: 'Mesatar', bars: 3, tone: 'text-amber-600' },
  strong: { label: 'I fortë', bars: 4, tone: 'text-teal-700' },
  very_strong: { label: 'Shumë i fortë', bars: 5, tone: 'text-teal-700' },
};

const BAR_COLORS: Record<Strength, string> = {
  empty: 'bg-stone-200',
  weak: 'bg-amber-400',
  fair: 'bg-amber-500',
  medium: 'bg-amber-500',
  strong: 'bg-teal-500',
  very_strong: 'bg-teal-600',
};

/**
 * Live strength indicator. Calls the API for the canonical evaluation
 * (which also gives us HIBP checks consistency for free) with a 300ms
 * debounce. Falls back to a local-only "weak/medium" hint if offline.
 */
export function PasswordStrengthIndicator({ password }: { password: string }) {
  const [strength, setStrength] = useState<Strength>('empty');
  const [acceptable, setAcceptable] = useState(false);

  useEffect(() => {
    if (!password) {
      setStrength('empty');
      setAcceptable(false);
      return;
    }
    const timer = window.setTimeout(() => {
      authClient
        .passwordStrength(password)
        .then((r) => {
          setStrength(r.strength);
          setAcceptable(r.acceptable);
        })
        .catch(() => {
          // Local fallback so the UI still responds when the API is
          // briefly unreachable.
          const fallback = localStrength(password);
          setStrength(fallback);
          setAcceptable(fallback === 'medium' || fallback === 'strong' || fallback === 'very_strong');
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [password]);

  const meta = STRENGTH_LABELS[strength];

  return (
    <div className="flex items-center gap-3.5">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 w-7 rounded-full transition-colors',
              i < meta.bars ? BAR_COLORS[strength] : 'bg-stone-200',
            )}
          />
        ))}
      </div>
      <span className={cn('text-[12.5px] font-medium', meta.tone)}>{meta.label}</span>
      {!acceptable && password.length > 0 ? (
        <span className="text-[11.5px] text-stone-400 ml-auto italic">
          duhet të jetë të paktën &quot;Mesatar&quot;
        </span>
      ) : null}
    </div>
  );
}

function localStrength(plain: string): Strength {
  if (!plain) return 'empty';
  if (plain.length <= 6) return 'weak';
  if (plain.length <= 8) return 'fair';
  if (plain.length <= 11) return 'medium';
  if (plain.length <= 15) return 'strong';
  return 'very_strong';
}
