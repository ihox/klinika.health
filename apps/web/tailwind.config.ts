import type { Config } from 'tailwindcss';
// The canonical token set lives in design-reference/tokens/. Extend it here
// instead of duplicating values — keeps the prototype and app in lockstep.
import baseConfig from '../../design-reference/tokens/tailwind.config.js';

const config: Config = {
  presets: [baseConfig as Partial<Config>],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-inter-display)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Dashboard in-progress chip family. Intentionally distinct
        // from the CYAN `colors.status.in-progress-*` cards: blue here
        // is reserved for stat-foot / DayStats summary chips on the
        // receptionist + doctor dashboards. The two surfaces share a
        // semantic meaning ("active visit") but live on different
        // layers and read differently to the eye.
        'in-progress': {
          bg:   'var(--in-progress-bg)',
          fg:   'var(--in-progress-fg)',
          soft: 'var(--in-progress-soft)',
          dot:  'var(--in-progress-dot)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
