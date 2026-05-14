'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { authClient, homePathForRole } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

const RESEND_COOLDOWN_SECONDS = 30;

type VerifyState =
  | 'idle'
  | 'verifying'
  | 'success'
  | 'error_invalid'
  | 'error_expired'
  | 'locked';

export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const pendingSessionId = params.get('s');
  const [maskedEmail, setMaskedEmail] = useState<string | null>(params.get('e'));
  const [digits, setDigits] = useState<string[]>(() => Array(6).fill(''));
  const [trustDevice, setTrustDevice] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [state, setState] = useState<VerifyState>('idle');
  const [cooldown, setCooldown] = useState<number>(RESEND_COOLDOWN_SECONDS);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!pendingSessionId) {
      router.replace('/login');
    }
  }, [pendingSessionId, router]);

  useEffect(() => {
    // Cooldown timer for "Dërgoje përsëri". Starts at 30s and ticks
    // down to 0; we re-arm it after each resend.
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    // Auto-focus the first empty cell so the user can start typing
    // immediately on page load, or paste a 6-digit code anywhere.
    const idx = digits.findIndex((d) => !d);
    const target = inputsRef.current[idx === -1 ? digits.length - 1 : idx];
    target?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const code = useMemo(() => digits.join(''), [digits]);

  const setDigit = (i: number, value: string) => {
    // Strip non-digits and cap to a single char.
    const cleaned = value.replace(/\D/g, '').slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = cleaned;
      return next;
    });
    if (cleaned && i < digits.length - 1) {
      inputsRef.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, digits.length);
    if (!text) return;
    e.preventDefault();
    setDigits(text.split('').concat(Array(digits.length - text.length).fill('')) as string[]);
    const focusAt = Math.min(text.length, digits.length - 1);
    inputsRef.current[focusAt]?.focus();
  };

  const handleKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && i < digits.length - 1) {
      inputsRef.current[i + 1]?.focus();
    }
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pendingSessionId || code.length !== 6) return;
    setState('verifying');
    setErrorMessage(null);
    try {
      const out = await authClient.mfaVerify({
        pendingSessionId,
        code,
        trustDevice,
      });
      setState('success');
      // Brief success flash, then navigate to the role-appropriate home.
      window.setTimeout(() => {
        router.replace(homePathForRole(out.role));
      }, 500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          const reason = err.body.reason;
          if (reason === 'too_many_attempts') {
            // Per components/mfa-verify.html the lockout state stays on
            // the verify page and shows an inline banner — the user
            // chooses when to navigate back to login.
            setState('locked');
            setErrorMessage(null);
            return;
          }
          if (reason === 'expired') {
            setState('error_expired');
            setErrorMessage('Kodi ka skaduar. Kërkoni një kod të ri.');
          } else {
            setState('error_invalid');
            // Best-effort attempt count from the next response would be
            // ideal; for now the message text is the signal.
            setAttemptsRemaining((prev) => {
              const next = (prev ?? 3) - 1;
              return next > 0 ? next : 0;
            });
            setErrorMessage('Kod i pasaktë. Provoni përsëri.');
          }
        } else if (err.status === 429) {
          setState('error_invalid');
          setErrorMessage('Tepër përpjekje. Prisni pak.');
        } else {
          setState('error_invalid');
          setErrorMessage(err.body.message ?? 'Verifikimi dështoi.');
        }
      } else {
        setState('error_invalid');
        setErrorMessage('Gabim i rrjetit. Provoni përsëri.');
      }
      setDigits(Array(6).fill(''));
      inputsRef.current[0]?.focus();
    }
  };

  useEffect(() => {
    // Auto-submit when the 6th digit lands.
    if (code.length === 6 && /^\d{6}$/.test(code) && state !== 'verifying' && state !== 'success') {
      void onSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleResend = async () => {
    if (!pendingSessionId || cooldown > 0) return;
    try {
      const result = await authClient.mfaResend({ pendingSessionId });
      setMaskedEmail(result.maskedEmail);
      setAttemptsRemaining(null);
      setErrorMessage(null);
      setState('idle');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setDigits(Array(6).fill(''));
      inputsRef.current[0]?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setErrorMessage('Tepër kërkesa. Prisni para se të kërkoni një kod të ri.');
      } else {
        setErrorMessage('Nuk u dërgua kodi. Provoni më vonë.');
      }
    }
  };

  if (state === 'success') {
    return (
      <div className="flex flex-col items-center text-center py-8">
        <div className="h-12 w-12 rounded-full bg-teal-100 text-teal-700 grid place-items-center mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L20 7" />
          </svg>
        </div>
        <div className="text-stone-900 font-medium">U verifikua</div>
        <div className="text-stone-500 text-[13px] mt-1">Po ju dërgojmë te kartelat…</div>
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-stone-500 text-[14px] leading-relaxed">
          Ne dërguam një kod 6-shifror në <EmailPill value={maskedEmail} />
        </div>
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-px shrink-0 text-amber-700"
            aria-hidden="true"
          >
            <path d="M8 2.5l6 10.5H2z" />
            <path d="M8 6.5v3M8 11.5v.01" />
          </svg>
          <div>
            <strong className="font-semibold text-amber-700">Tepër përpjekje.</strong>{' '}
            Filloni prej fillimit — hyni përsëri me email + fjalëkalim.
            <div className="mt-2">
              <Link
                href="/login"
                className="font-semibold text-amber-700 hover:underline"
              >
                ← Kthehu te hyrja
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="text-stone-500 text-[14px] leading-relaxed">
        Ne dërguam një kod 6-shifror në <EmailPill value={maskedEmail} />
      </div>

      <div>
        <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">Kodi</label>
        <div className="mt-2 flex gap-2" aria-label="Kodi gjashtëshifror">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputsRef.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={handleKeyDown(i)}
              onPaste={handlePaste}
              aria-label={`Shifra ${i + 1}`}
              className={cn(
                'h-12 w-11 rounded-md border bg-white text-center font-mono text-[20px] text-stone-900 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500',
                state === 'error_invalid' || state === 'error_expired'
                  ? 'border-amber-700 bg-amber-50/60'
                  : 'border-stone-200',
              )}
              disabled={state === 'verifying'}
            />
          ))}
        </div>
        {errorMessage ? (
          <p className="mt-2 text-[12.5px] text-amber-700 flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="7" cy="7" r="5.5" />
              <path d="M7 4v3.5M7 9.6v.01" />
            </svg>
            {errorMessage}
            {attemptsRemaining !== null && attemptsRemaining > 0 ? (
              <span className="text-stone-400 ml-1">({attemptsRemaining} përpjekje të mbetura)</span>
            ) : null}
          </p>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-[13px] text-stone-600 cursor-pointer select-none">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-teal-600"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
        />
        Mos pyet përsëri në këtë pajisje
      </label>

      <Button type="submit" size="lg" disabled={state === 'verifying' || code.length !== 6}>
        {state === 'verifying' ? (
          <>
            <span
              className="inline-block h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin"
              aria-hidden="true"
            />
            Po verifikohet…
          </>
        ) : (
          'Verifiko'
        )}
      </Button>

      <div className="flex justify-between items-center text-[13px] text-stone-500 mt-1">
        <span>Nuk e morët kodin?</span>
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0}
          className="font-medium text-teal-700 hover:text-teal-800 hover:underline disabled:text-stone-400 disabled:hover:no-underline"
        >
          {cooldown > 0 ? `Dërgoje përsëri (${cooldown}s)` : 'Dërgoje përsëri'}
        </button>
      </div>
    </form>
  );
}

/**
 * Subtle pill around the masked email, matching the
 * .email-mask token in components/mfa-verify.html.
 */
function EmailPill({ value }: { value: string | null }) {
  return (
    <span className="inline-block rounded border border-stone-200 bg-stone-100 px-1.5 py-px font-mono text-[12.5px] font-medium text-stone-700">
      {value ?? '—'}
    </span>
  );
}
