// Unit test for the Puppeteer launch-options builder.
//
// Why this test exists: the renderer must use the system Chromium
// path on dev (Apple Silicon Mac → aarch64 container) but fall back
// to Puppeteer's bundled Chrome on x86-64 production hosts that don't
// set `PUPPETEER_EXECUTABLE_PATH`. The pure builder isolates that
// branch from the cluster bootstrap, which is otherwise unreachable
// without a real Chromium binary.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildPuppeteerLaunchOptions } from './print-renderer.service';

describe('buildPuppeteerLaunchOptions', () => {
  const originalValue = process.env['PUPPETEER_EXECUTABLE_PATH'];

  beforeEach(() => {
    delete process.env['PUPPETEER_EXECUTABLE_PATH'];
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env['PUPPETEER_EXECUTABLE_PATH'];
    } else {
      process.env['PUPPETEER_EXECUTABLE_PATH'] = originalValue;
    }
  });

  it('omits executablePath when PUPPETEER_EXECUTABLE_PATH is not set (production fallback)', () => {
    const opts = buildPuppeteerLaunchOptions();
    expect(opts).not.toHaveProperty('executablePath');
    expect(opts.headless).toBe(true);
    expect(opts.args).toContain('--no-sandbox');
  });

  it('includes executablePath when PUPPETEER_EXECUTABLE_PATH is set (dev container path)', () => {
    process.env['PUPPETEER_EXECUTABLE_PATH'] = '/usr/bin/chromium';
    const opts = buildPuppeteerLaunchOptions();
    expect(opts).toHaveProperty('executablePath', '/usr/bin/chromium');
    expect(opts.headless).toBe(true);
  });

  it('treats an empty string as unset (no executablePath in the result)', () => {
    process.env['PUPPETEER_EXECUTABLE_PATH'] = '';
    const opts = buildPuppeteerLaunchOptions();
    expect(opts).not.toHaveProperty('executablePath');
  });
});
