import * as React from 'react';
import { cn } from '@/lib/utils';

interface FieldProps {
  label?: string;
  error?: string | null;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, error, hint, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium uppercase tracking-wide text-stone-500"
        >
          {label}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-[12.5px] text-amber-700">{error}</p> : null}
      {!error && hint ? <p className="text-[12.5px] text-stone-500">{hint}</p> : null}
    </div>
  );
}
