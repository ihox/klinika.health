interface BrandLogoProps {
  /** `primary` = heart icon + wordmark. `mark` = icon only. */
  variant?: 'primary' | 'mark';
  /** Rendered height in pixels. Width auto-scales via the SVG's intrinsic ratio. */
  height?: number;
  className?: string;
  /** Pass `""` when a parent element already supplies the accessible name. */
  alt?: string;
}

const SOURCES: Record<NonNullable<BrandLogoProps['variant']>, string> = {
  primary: '/brand/logo-primary.svg',
  mark: '/brand/logo-mark.svg',
};

export function BrandLogo({
  variant = 'primary',
  height = 22,
  className,
  alt = 'klinika.',
}: BrandLogoProps) {
  return (
    <img
      src={SOURCES[variant]}
      alt={alt}
      height={height}
      style={{ height }}
      className={className}
    />
  );
}
