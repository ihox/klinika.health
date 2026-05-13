import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'link';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-teal-600 hover:bg-teal-700 text-white border border-transparent shadow-sm disabled:opacity-60 disabled:cursor-not-allowed',
  secondary:
    'bg-white hover:bg-stone-50 text-stone-800 border border-stone-200 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed',
  ghost: 'bg-transparent hover:bg-stone-100 text-stone-700 disabled:opacity-60',
  link: 'bg-transparent text-teal-700 hover:text-teal-800 hover:underline p-0 shadow-none border-0',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-[14px]',
  lg: 'h-11 px-5 text-[14px] font-medium',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type, ...rest }: ButtonProps,
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
});
