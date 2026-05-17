'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const RESEND_COOLDOWN_SECONDS = 30;
const CODE_LENGTH = 6;

export type MfaVerifyResult =
  | { ok: true }
  | { ok: false; kind: 'invalid_code'; attemptsRemaining?: number | null; message?: string }
  | { ok: false; kind: 'expired_code'; message?: string }
  | { ok: false; kind: 'too_many_attempts' }
  | { ok: false; kind: 'rate_limited'; message?: string }
  | { ok: false; kind: 'network' | 'unknown'; message?: string };

export type MfaResendResult =
  | { ok: true; maskedEmail: string }
  | { ok: false; kind: 'rate_limited' | 'network' | 'unknown'; message?: string };

interface MfaVerifyFormProps {
  maskedEmail: string | null;
  onVerify: (input: { code: string; trustDevice: boolean }) => Promise<MfaVerifyResult>;
  onResend: () => Promise<MfaResendResult>;
  onSuccess: () => void;
  loginPath?: string;
}

type InternalState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'success' }
  | { kind: 'invalid'; message: string; attemptsRemaining: number | null }
  | { kind: 'expired'; message: string }
  | { kind: 'locked' }
  | { kind: 'error'; message: string };

/**
 * Single MFA verify card used by both the clinic /verify route and the
 * platform-admin login flow. Mirrors
 * design-reference/prototype/components/mfa-verify.html — brand row,
 * title, masked-email subtitle, 6 OTP cells, trusted-device checkbox,
 * 30s resend cooldown, locked-out banner, back-to-login link.
 *
 * The call site translates its API errors into MfaVerifyResult /
 * MfaResendResult so the visual states stay identical regardless of
 * which scope (clinic vs platform admin) is authenticating.
 */
export function MfaVerifyForm({
  maskedEmail: initialEmail,
  onVerify,
  onResend,
  onSuccess,
  loginPath = '/login',
}: MfaVerifyFormProps) {
  const [maskedEmail, setMaskedEmail] = useState<string | null>(initialEmail);
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(''));
  const [trustDevice, setTrustDevice] = useState(true);
  const [state, setState] = useState<InternalState>({ kind: 'idle' });
  const [cooldown, setCooldown] = useState<number>(RESEND_COOLDOWN_SECONDS);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    const idx = digits.findIndex((d) => !d);
    inputsRef.current[idx === -1 ? digits.length - 1 : idx]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const code = useMemo(() => digits.join(''), [digits]);
  const isErrorState =
    state.kind === 'invalid' || state.kind === 'expired' || state.kind === 'error';

  const setDigit = (i: number, value: string) => {
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

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.length !== CODE_LENGTH) return;
    setState({ kind: 'verifying' });
    let result: MfaVerifyResult;
    try {
      result = await onVerify({ code, trustDevice });
    } catch {
      result = { ok: false, kind: 'unknown', message: 'Gabim i rrjetit. Provoni përsëri.' };
    }
    if (result.ok) {
      setState({ kind: 'success' });
      window.setTimeout(onSuccess, 500);
      return;
    }
    if (result.kind === 'too_many_attempts') {
      setState({ kind: 'locked' });
      return;
    }
    if (result.kind === 'expired_code') {
      setState({
        kind: 'expired',
        message: result.message ?? 'Kodi ka skaduar. Kërkoni një kod të ri.',
      });
    } else if (result.kind === 'invalid_code') {
      setState({
        kind: 'invalid',
        message: result.message ?? 'Kod i pasaktë. Provoni përsëri.',
        attemptsRemaining: result.attemptsRemaining ?? null,
      });
    } else if (result.kind === 'rate_limited') {
      setState({ kind: 'error', message: result.message ?? 'Tepër kërkesa. Prisni pak.' });
    } else {
      setState({ kind: 'error', message: result.message ?? 'Verifikimi dështoi.' });
    }
    setDigits(Array(CODE_LENGTH).fill(''));
    inputsRef.current[0]?.focus();
  };

  useEffect(() => {
    if (
      code.length === CODE_LENGTH &&
      /^\d{6}$/.test(code) &&
      state.kind !== 'verifying' &&
      state.kind !== 'success'
    ) {
      void submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleResend = async () => {
    if (cooldown > 0) return;
    const result = await onResend();
    if (result.ok) {
      setMaskedEmail(result.maskedEmail);
      setState({ kind: 'idle' });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setDigits(Array(CODE_LENGTH).fill(''));
      inputsRef.current[0]?.focus();
      return;
    }
    setState({
      kind: 'error',
      message:
        result.kind === 'rate_limited'
          ? 'Tepër kërkesa. Prisni para se të kërkoni një kod të ri.'
          : result.message ?? 'Nuk u dërgua kodi. Provoni më vonë.',
    });
  };

  const errorMessage = isErrorState ? state.message : null;
  const attemptsRemaining = state.kind === 'invalid' ? state.attemptsRemaining : null;
  const showForm = state.kind !== 'locked' && state.kind !== 'success';

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-6 flex items-center gap-2.5">
        <BrandLogo height={28} />
      </div>

      <h1 className="font-display text-[24px] font-semibold tracking-[-0.025em] text-stone-900">
        Verifikoni se jeni ju
      </h1>
      <p className="mt-1 mb-5 text-[13px] leading-[1.55] text-stone-500">
        Ne dërguam një kod 6-shifror në <EmailPill value={maskedEmail} />
      </p>

      {state.kind === 'locked' ? <LockoutBanner loginPath={loginPath} /> : null}

      {state.kind === 'success' ? <SuccessFlash /> : null}

      {showForm ? (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div>
            <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">
              Kodi
            </label>
            <div className="mt-2 grid grid-cols-6 gap-2" aria-label="Kodi gjashtëshifror">
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
                    'min-w-0 rounded-md border bg-white py-3.5 text-center font-mono text-[22px] font-semibold leading-none text-stone-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-500/30',
                    isErrorState
                      ? 'border-amber-700 bg-amber-50 text-amber-700'
                      : 'border-stone-300',
                  )}
                  disabled={state.kind === 'verifying'}
                />
              ))}
            </div>
            {errorMessage ? (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-amber-700">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M7 4v3.5M7 9.6v.01" />
                </svg>
                {errorMessage}
                {attemptsRemaining !== null && attemptsRemaining > 0 ? (
                  <span className="ml-1 text-stone-400">
                    ({attemptsRemaining} përpjekje të mbetura)
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-stone-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-teal-600"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
            />
            Mos pyet përsëri në këtë pajisje
          </label>

          <Button
            type="submit"
            size="lg"
            disabled={state.kind === 'verifying' || code.length !== CODE_LENGTH}
            className="mt-1"
          >
            {state.kind === 'verifying' ? (
              <>
                <span
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden="true"
                />
                Po verifikohet…
              </>
            ) : (
              'Verifiko'
            )}
          </Button>

          <div className="mt-1 flex items-center justify-between border-t border-stone-200 pt-3 text-[12px] text-stone-500">
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
      ) : null}

      {state.kind === 'locked' ? null : (
        <div className="mt-8 text-[12px] text-stone-500">
          <Link href={loginPath} className="hover:text-teal-700">
            ← Kthehu te hyrja
          </Link>
        </div>
      )}
    </div>
  );
}

function EmailPill({ value }: { value: string | null }) {
  return (
    <span className="inline-block rounded border border-stone-200 bg-stone-100 px-1.5 py-px font-mono text-[12.5px] font-medium text-stone-700">
      {value ?? '—'}
    </span>
  );
}

function LockoutBanner({ loginPath }: { loginPath: string }) {
  return (
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
          <Link href={loginPath} className="font-semibold text-amber-700 hover:underline">
            ← Kthehu te hyrja
          </Link>
        </div>
      </div>
    </div>
  );
}

function SuccessFlash() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-teal-100 text-teal-700">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L20 7" />
        </svg>
      </div>
      <div className="font-medium text-stone-900">U verifikua</div>
      <div className="mt-1 text-[13px] text-stone-500">Po ju dërgojmë…</div>
    </div>
  );
}
