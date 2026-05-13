import type { Config } from 'tailwindcss';

/**
 * Plain-JS Tailwind preset shared between the HTML prototype and the
 * Next.js app. The values are pinned in `tailwind.config.js`; this
 * declaration just gives TypeScript a shape so `tsc --noEmit` doesn't
 * flag the import as implicit-any.
 */
declare const config: Partial<Config>;
export default config;
