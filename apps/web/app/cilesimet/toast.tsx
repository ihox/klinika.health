'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ToastState {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

export function useToast(): {
  toast: ToastState | null;
  showToast: (message: string, tone?: 'success' | 'error') => void;
} {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ id: Date.now() + Math.random(), message, tone });
  }, []);
  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  const [visible, setVisible] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    setVisible(toast);
    const t = setTimeout(() => setVisible(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!visible) return null;
  const isError = visible.tone === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg shadow-lg px-4 py-3 text-[13px] font-medium border flex items-center gap-2 ${
        isError
          ? 'bg-amber-50 border-amber-200 text-amber-900'
          : 'bg-stone-900 text-white border-stone-900'
      }`}
    >
      <span
        className={`h-5 w-5 grid place-items-center rounded-full text-[11px] font-bold ${
          isError ? 'bg-amber-200 text-amber-900' : 'bg-teal-500 text-white'
        }`}
        aria-hidden
      >
        {isError ? '!' : '✓'}
      </span>
      <span>{visible.message}</span>
    </div>
  );
}
