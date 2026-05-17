import { BrandLogo } from '@/components/brand-logo';
import { cn } from '@/lib/utils';

interface BrandRowProps {
  className?: string;
  markSize?: number;
}

/**
 * Animated klinika.health brand-row used at the top of every auth
 * page. Mirrors design-reference/prototype/index.html `.brand-row`:
 * the heart-icon mark animates (tile-in on mount, infinite heart-beat
 * after 1500ms — see `.auth-brand-anim` in globals.css), the wordmark
 * is static text so the eye reads it as the product name, not part of
 * the loop.
 */
export function BrandRow({ className, markSize = 40 }: BrandRowProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span aria-hidden="true" className="auth-brand-anim inline-flex">
        <BrandLogo variant="mark" alt="" height={markSize} />
      </span>
      <span className="font-display text-[20px] font-semibold tracking-[-0.02em] text-stone-900">
        klinika<span className="font-normal text-stone-400">.health</span>
      </span>
    </div>
  );
}
