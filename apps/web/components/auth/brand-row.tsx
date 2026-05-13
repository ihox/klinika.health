export function BrandRow({ size = 36 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="text-teal-600"
      >
        <path
          d="M32 54 C 12 40, 8 26, 18 18 C 24 14, 30 16, 32 22 C 34 16, 40 14, 46 18 C 56 26, 52 40, 32 54 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10 34 L 22 34 L 26 28 L 30 40 L 34 30 L 38 36 L 54 36"
          stroke="#115E59"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className="font-display text-[20px] font-semibold tracking-tight text-stone-900">
        klinika<span className="text-stone-400 font-normal">.</span>
      </span>
    </div>
  );
}
