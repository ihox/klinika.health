/**
 * Klinika — Tailwind config (klinika.health)
 * Drop into the root of a Tailwind project. Mirrors prototype/styles.css.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./**/*.{html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: {
          50:  '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
        primary: {
          DEFAULT: '#0D9488',
          dark:    '#0F766E',
          soft:    '#CCFBF1',
          tint:    '#F0FDFA',
        },
        accent: {
          50:  '#FFF7ED',
          100: '#FFEDD5',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C',
        },
        surface: {
          DEFAULT:  '#FAFAF9',   // page bg
          elevated: '#FFFFFF',
          subtle:   '#F5F5F4',
          muted:    '#EFEEEC',
        },
        ink: {
          DEFAULT: '#1C1917',
          strong:  '#0C0A09',
          muted:   '#57534E',
          faint:   '#A8A29E',
        },
        line: {
          DEFAULT: '#E7E5E4',
          strong:  '#D6D3D1',
          soft:    '#F0EFEC',
        },
        success: { DEFAULT: '#15803D', bg: '#DCFCE7', soft: '#BBF7D0' },
        warning: { DEFAULT: '#B45309', bg: '#FEF3C7', soft: '#FDE68A' },
        danger:  { DEFAULT: '#B91C1C', bg: '#FEE2E2', soft: '#FECACA' },

        // Canonical visit-status color system (klinika v1.2).
        // ONE color per visit lifecycle state, used consistently across
        // filter pills, calendar cards, hover overlays, and badges in
        // every surface. Pairings pass WCAG AA at ≥12.5px.
        //   scheduled    → indigo  (calm, future event)
        //   in-progress  → cyan    (active; arrived shares this family)
        //   completed    → green   (done, positive)
        //   no-show      → amber   (didn't happen, attention)
        //   cancelled    → red     (won't happen, destructive)
        // Usage in Tailwind:
        //   bg-status-scheduled-bg text-status-scheduled-fg
        //   border-status-scheduled-border
        //   bg-status-scheduled-solid text-white   (active filter pill)
        status: {
          'scheduled-bg':       '#E0E7FF',
          'scheduled-fg':       '#3730A3',
          'scheduled-border':   '#C7D2FE',
          'scheduled-solid':    '#4F46E5',
          'in-progress-bg':     '#CFFAFE',
          'in-progress-fg':     '#155E75',
          'in-progress-border': '#A5F3FC',
          'in-progress-solid':  '#0E7490',
          'completed-bg':       '#DCFCE7',
          'completed-fg':       '#14532D',
          'completed-border':   '#BBF7D0',
          'completed-solid':    '#15803D',
          'no-show-bg':         '#FEF3C7',
          'no-show-fg':         '#92400E',
          'no-show-border':     '#FDE68A',
          'no-show-solid':      '#B45309',
          'cancelled-bg':       '#FEE2E2',
          'cancelled-fg':       '#991B1B',
          'cancelled-border':   '#FECACA',
          'cancelled-solid':    '#B91C1C',
        },

        // Role-chip family (canonical) — distinct from status & brand chips
        // so a user's authority is unambiguous at a glance.
        role: {
          doctor:    { DEFAULT: '#3730A3', bg: '#EEF2FF', border: '#C7D2FE' },
          reception: { DEFAULT: '#5B21B6', bg: '#F5F3FF', border: '#DDD6FE' },
          admin:     { DEFAULT: '#334155', bg: '#F1F5F9', border: '#CBD5E1' },
        },

        // Pediatric WHO growth chart — patient-line color driven by sex.
        // Blue = boy (Djalë), pink = girl (Vajzë). Percentile bands and
        // axes stay neutral; the chip label always accompanies the color
        // as a non-color accessibility backup.
        chart: {
          male:        'var(--chart-male)',
          'male-bg':   'var(--chart-male-bg)',
          'male-border': 'var(--chart-male-border)',
          female:        'var(--chart-female)',
          'female-bg':   'var(--chart-female-bg)',
          'female-border': 'var(--chart-female-border)',
        },
      },

      spacing: {
        // Token aliases (in addition to Tailwind defaults)
        'page-x': '32px',
        'page-y': '24px',
        topbar:   '60px',
      },

      borderRadius: {
        xs:  '4px',
        sm:  '6px',
        md:  '8px',
        lg:  '12px',
        xl:  '16px',
        '2xl': '20px',
        pill:  '999px',
      },

      boxShadow: {
        xs:    '0 1px 2px rgba(28, 25, 23, 0.04)',
        sm:    '0 1px 3px rgba(28, 25, 23, 0.06), 0 1px 2px rgba(28, 25, 23, 0.04)',
        md:    '0 4px 12px rgba(28, 25, 23, 0.06), 0 2px 4px rgba(28, 25, 23, 0.04)',
        lg:    '0 12px 28px rgba(28, 25, 23, 0.08), 0 4px 10px rgba(28, 25, 23, 0.04)',
        modal: '0 24px 48px rgba(28, 25, 23, 0.16), 0 8px 16px rgba(28, 25, 23, 0.08)',
        'btn-primary-inset': '0 1px 0 rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.15)',
        focus: '0 0 0 3px rgba(13, 148, 136, 0.25)',
      },

      fontFamily: {
        sans:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },

      fontSize: {
        xs:   ['11px', { lineHeight: '1.4' }],
        sm:   ['12px', { lineHeight: '1.45' }],
        base: ['13px', { lineHeight: '1.5' }],
        md:   ['14px', { lineHeight: '1.5' }],
        lg:   ['16px', { lineHeight: '1.4' }],
        xl:   ['18px', { lineHeight: '1.35' }],
        '2xl': ['20px', { lineHeight: '1.3',  letterSpacing: '-0.015em' }],
        '3xl': ['24px', { lineHeight: '1.25', letterSpacing: '-0.02em'  }],
        '4xl': ['28px', { lineHeight: '1.2',  letterSpacing: '-0.02em'  }],
      },

      fontWeight: {
        regular:  '400',
        medium:   '500',
        semibold: '600',
        bold:     '700',
      },

      letterSpacing: {
        tight:   '-0.02em',
        tighter: '-0.015em',
        snug:    '-0.01em',
        wide:    '0.01em',
      },

      transitionDuration: {
        fast:   '150ms',
        medium: '180ms',
        slow:   '250ms',
      },

      keyframes: {
        'fade-in':  { from: { opacity: '0' }, to: { opacity: '1' } },
        'modal-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },

      animation: {
        'fade-in':  'fade-in 150ms ease',
        'modal-in': 'modal-in 180ms ease',
      },

      zIndex: {
        topbar: '30',
        modal:  '50',
        toast:  '100',
      },

      maxWidth: {
        page: '1440px',
      },
    },
  },
  plugins: [],
};
