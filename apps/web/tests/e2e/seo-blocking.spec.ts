import { expect, test } from './fixtures/auth';

// Klinika handles PHI and must never appear in search engines or
// AI training datasets — see CLAUDE.md §1. The no-index policy
// has three defense layers, asserted here:
//   1. <meta name="robots"> + <meta name="googlebot"> on every
//      page (app/layout.tsx)
//   2. /robots.txt blocking the wildcard + a named AI denylist
//      (app/robots.ts)
//   3. X-Robots-Tag HTTP response header on every response
//      (next.config.mjs)
// Layers 1+2 catch HTML-aware crawlers; layer 3 catches every
// other client (non-HTML routes, AI scrapers that ignore meta and
// robots.txt). Each layer is independently asserted so a single
// regression doesn't slip through.

const EXPECTED_HEADER_DIRECTIVES = [
  'noindex',
  'nofollow',
  'noarchive',
  'nosnippet',
  'noimageindex',
  'nocache',
  'notranslate',
];

function assertXRobotsTagHeader(headerValue: string | undefined, where: string) {
  expect(headerValue, `X-Robots-Tag present on ${where}`).toBeDefined();
  const lowered = (headerValue ?? '').toLowerCase();
  for (const directive of EXPECTED_HEADER_DIRECTIVES) {
    expect(lowered, `X-Robots-Tag on ${where} contains "${directive}"`).toContain(
      directive,
    );
  }
}

// 18 known AI training / answer-engine crawlers. The denylist in
// app/robots.ts is the source of truth — keep these in sync.
const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'anthropic-ai',
  'ClaudeBot',
  'Claude-Web',
  'Google-Extended',
  'CCBot',
  'PerplexityBot',
  'cohere-ai',
  'ByteSpider',
  'Bytespider',
  'Meta-ExternalAgent',
  'FacebookBot',
  'AppleBot-Extended',
  'Amazonbot',
  'DuckAssistBot',
  'YouBot',
  'ImagesiftBot',
];

test.describe('SEO + AI-crawler blocking', () => {
  test('GET / renders <meta name="robots"> with the full directive set', async ({
    page,
  }) => {
    await page.goto('/');
    const robotsMeta = await page
      .locator('head > meta[name="robots"]')
      .getAttribute('content');
    expect(robotsMeta, 'meta robots tag is present').not.toBeNull();
    const lowered = (robotsMeta ?? '').toLowerCase();
    // Next.js renders the `robots` metadata as a single comma-joined
    // content attribute. We assert each directive token rather than
    // an exact string so the test survives non-meaningful ordering
    // changes from Next.js across versions.
    expect(lowered).toContain('noindex');
    expect(lowered).toContain('nofollow');
    expect(lowered).toContain('noarchive');
    expect(lowered).toContain('nosnippet');
    expect(lowered).toContain('noimageindex');
    expect(lowered).toContain('notranslate');
  });

  test('GET / also renders a googlebot meta tag with stricter limits', async ({
    page,
  }) => {
    await page.goto('/');
    const googlebotMeta = await page
      .locator('head > meta[name="googlebot"]')
      .getAttribute('content');
    expect(googlebotMeta, 'meta googlebot tag is present').not.toBeNull();
    const lowered = (googlebotMeta ?? '').toLowerCase();
    expect(lowered).toContain('noindex');
    expect(lowered).toContain('nofollow');
    expect(lowered).toContain('max-image-preview:none');
    expect(lowered).toContain('max-snippet:-1');
    expect(lowered).toContain('max-video-preview:-1');
  });

  test('GET /robots.txt disallows every crawler including the AI denylist', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt');
    expect(response.ok()).toBe(true);
    const body = await response.text();

    // Wildcard rule comes first.
    expect(body).toMatch(/User-Agent:\s*\*\s*\nDisallow:\s*\//i);

    // Every named AI crawler must have its own block — some bots
    // honour their specific UA rule even when they ignore the
    // wildcard rule, which is why we enumerate them.
    for (const ua of AI_CRAWLERS) {
      const pattern = new RegExp(
        `User-Agent:\\s*${ua.replace(/[-]/g, '[-]')}\\s*\\nDisallow:\\s*/`,
        'i',
      );
      expect(body, `robots.txt blocks ${ua}`).toMatch(pattern);
    }
  });

  test('X-Robots-Tag header rides every response (/, /login, /robots.txt)', async ({
    request,
  }) => {
    // The HTTP header is the catch-all layer: it ships on every
    // response from the Next.js process, including non-HTML routes
    // and clients that ignore meta tags. Use playwright's `request`
    // fixture (not `page.goto`) to read headers from the very first
    // response without client-side redirects collapsing the chain.
    for (const path of ['/', '/login', '/robots.txt']) {
      const response = await request.get(path, { maxRedirects: 0 });
      assertXRobotsTagHeader(response.headers()['x-robots-tag'], path);
    }
  });
});
