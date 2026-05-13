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
    },
  },
  plugins: [],
};

export default config;
