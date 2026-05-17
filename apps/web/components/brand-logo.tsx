interface BrandLogoProps {
  /** `primary` = gradient mark + "klinika.health" wordmark. `mark` = gradient tile only. */
  variant?: 'primary' | 'mark';
  /** Rendered height in pixels. Width auto-scales via the SVG's intrinsic ratio. */
  height?: number;
  className?: string;
  /** Pass `""` when a parent element already supplies the accessible name. */
  alt?: string;
}

const SOURCES: Record<NonNullable<BrandLogoProps['variant']>, string> = {
  primary: '/brand/logo.svg',
  mark: '/brand/mark.svg',
};

export function BrandLogo({
  variant = 'primary',
  height = 22,
  className,
  alt = 'klinika.health',
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
