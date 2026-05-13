import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest }: InputProps,
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'block w-full rounded-md border bg-white px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-400 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal-500/30',
        invalid
          ? 'border-amber-700 focus:border-amber-700'
          : 'border-stone-200 focus:border-teal-500',
        'h-10',
        className,
      )}
      {...rest}
    />
  );
});
