import type { MetadataRoute } from 'next';

// Klinika is a PHI-handling app. /robots.txt blocks every crawler
// outright, with a comprehensive denylist of known AI training
// bots (some honour user-agent rules even when they ignore
// `User-agent: *`). The policy is unconditional and ships in every
// environment. Pair this with the X-Robots-Tag header
// (next.config.mjs) and the <meta name="robots"> tag (root layout)
// so the policy holds regardless of which signal a given crawler
// happens to honour.
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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', disallow: '/' },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
  };
}
