import { expect, test } from '@playwright/test';

// Klinika handles PHI and must never appear in search engines or
// AI training datasets — see CLAUDE.md §1 and the SEO blocking
// stack in app/layout.tsx + app/robots.ts. The third layer
// (X-Robots-Tag HTTP header in next.config.mjs) lands in a
// follow-up commit alongside the slice 18a Docker work that also
// touches next.config.mjs; once it ships, add a response-header
// assertion here.

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
});
