'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  MfaVerifyForm,
  type MfaResendResult,
  type MfaVerifyResult,
} from '@/components/auth/mfa-verify-form';
import { ApiError } from '@/lib/api';
import { authClient, homePathForRoles } from '@/lib/auth-client';

export function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const pendingSessionId = params.get('s');
  const maskedEmail = params.get('e');
  // Captures the post-success route from the verify response so the
  // form's success flash can navigate via onSuccess without holding a
  // promise's resolved value across renders.
  const successRedirect = useRef<string>('/');

  useEffect(() => {
    if (!pendingSessionId) {
      router.replace('/login');
    }
  }, [pendingSessionId, router]);

  if (!pendingSessionId) {
    return null;
  }

  const handleVerify = async ({
    code,
    trustDevice,
  }: {
    code: string;
    trustDevice: boolean;
  }): Promise<MfaVerifyResult> => {
    try {
      const out = await authClient.mfaVerify({ pendingSessionId, code, trustDevice });
      successRedirect.current = homePathForRoles(out.roles);
      return { ok: true };
    } catch (err) {
      return mapVerifyError(err);
    }
  };

  const handleResend = async (): Promise<MfaResendResult> => {
    try {
      const out = await authClient.mfaResend({ pendingSessionId });
      return { ok: true, maskedEmail: out.maskedEmail };
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        return { ok: false, kind: 'rate_limited' };
      }
      return { ok: false, kind: 'unknown' };
    }
  };

  return (
    <MfaVerifyForm
      maskedEmail={maskedEmail}
      onVerify={handleVerify}
      onResend={handleResend}
      onSuccess={() => router.replace(successRedirect.current)}
    />
  );
}

function mapVerifyError(err: unknown): MfaVerifyResult {
  if (!(err instanceof ApiError)) {
    return { ok: false, kind: 'network', message: 'Gabim i rrjetit. Provoni përsëri.' };
  }
  if (err.status === 401) {
    const reason = err.body.reason;
    if (reason === 'too_many_attempts') return { ok: false, kind: 'too_many_attempts' };
    if (reason === 'expired') {
      return { ok: false, kind: 'expired_code', message: err.body.message };
    }
    return { ok: false, kind: 'invalid_code', message: err.body.message };
  }
  if (err.status === 429) {
    return { ok: false, kind: 'rate_limited', message: err.body.message };
  }
  return { ok: false, kind: 'unknown', message: err.body.message };
}
