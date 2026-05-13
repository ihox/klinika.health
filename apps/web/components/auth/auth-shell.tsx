import type { ReactNode } from 'react';
import { BrandRow } from './brand-row';

interface AuthShellProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Split-screen auth layout. Left: form (centered, max-width 380px).
 * Right: dark-teal hero with subtle WHO-curve illustration. The hero
 * collapses on viewports < 900px to keep the form usable on tablets.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-stone-50 grid lg:grid-cols-2">
      <div className="grid place-items-center p-6 lg:p-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-10">
            <BrandRow />
          </div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-stone-900">
            {title}
          </h1>
          {subtitle ? <div className="mt-1.5 text-[14px] text-stone-500">{subtitle}</div> : null}
          <div className="mt-8 flex flex-col gap-4">{children}</div>
          {footer ? (
            <div className="mt-12 flex gap-3 text-[12px] text-stone-400">{footer}</div>
          ) : null}
        </div>
      </div>
      <div className="hidden lg:flex relative flex-col justify-between p-14 text-white overflow-hidden bg-gradient-to-br from-teal-800 to-teal-900">
        <HeroIllustration />
        <div className="relative z-10">
          <div className="text-[12px] uppercase tracking-[0.12em] text-teal-200 font-medium mb-4">
            Pediatër · Kosovo
          </div>
          <h2 className="font-display text-[36px] font-semibold leading-[1.15] tracking-[-0.025em] max-w-md">
            Softueri për<br />
            <em className="not-italic text-teal-300">klinikat moderne</em>.
          </h2>
        </div>
        <div className="relative z-10 flex items-center gap-3 text-[13px] text-teal-100">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
          Përdoret nga DonetaMED prej maj 2026
        </div>
      </div>
    </main>
  );
}

function HeroIllustration() {
  return (
    <svg
      className="absolute inset-0 pointer-events-none opacity-90"
      viewBox="0 0 600 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g stroke="rgba(204,251,241,0.18)" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M -20 700 Q 150 600 320 500 T 640 280" />
        <path d="M -20 740 Q 150 650 320 560 T 640 350" />
        <path d="M -20 770 Q 150 700 320 620 T 640 410" />
        <path d="M -20 660 Q 150 540 320 430 T 640 200" />
        <path d="M -20 620 Q 150 480 320 360 T 640 130" />
      </g>
      <path
        d="M -20 720 Q 150 620 320 510 T 640 270"
        stroke="rgba(94,234,212,0.85)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <g fill="rgba(94,234,212,0.95)">
        <circle cx="80" cy="660" r="5" />
        <circle cx="200" cy="580" r="5" />
        <circle cx="320" cy="510" r="5" />
        <circle cx="440" cy="420" r="5" />
        <circle cx="560" cy="320" r="5" />
      </g>
    </svg>
  );
}
