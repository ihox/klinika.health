'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from './api';
import { authClient, type MeResponse } from './auth-client';

interface UseMeState {
  me: MeResponse['user'] | null;
  loading: boolean;
  error: 'forbidden' | 'unknown' | null;
  reload: () => Promise<void>;
}

/**
 * Shared client-side fetch of `/api/auth/me`. The top nav, the user
 * menu dropdown, and the role-gated route wrappers all need the
 * current user's identity + roles; centralising the fetch keeps the
 * cache behaviour consistent and prevents three independent network
 * calls per page mount.
 *
 * On 401 the hook redirects to `/login?reason=session-expired`
 * directly — every caller is on an authenticated clinic surface, so a
 * stale session is always the same outcome. Errors surface via the
 * `error` field so the consumer can render appropriately.
 */
export function useMe(): UseMeState {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'unknown' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await authClient.me();
      setMe(out.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login?reason=session-expired');
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setError('forbidden');
        return;
      }
      setError('unknown');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return { me, loading, error, reload: load };
}
