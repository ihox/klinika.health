import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  /** Custom inline style — useful for ad-hoc widths/heights. */
  style?: React.CSSProperties;
  /** Accessible label, applied as aria-label when the skeleton stands alone. */
  ariaLabel?: string;
}

/**
 * Skeleton block — single pulsing rectangle used as a building block
 * for loading states. Pulse animation defined in app/globals.css
 * (.sk-pulse) and mirrors design-reference/prototype/components/
 * loading-skeletons.html. Compose multiple Skeletons to mimic the real
 * shape of the content within ±2px so there's no jump on swap.
 */
export function Skeleton({ className, style, ariaLabel }: SkeletonProps) {
  return (
    <div
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'status' : undefined}
      className={cn('sk-pulse rounded-[4px]', className)}
      style={style}
    />
  );
}
