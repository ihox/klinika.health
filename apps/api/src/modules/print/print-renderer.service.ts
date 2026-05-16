import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { Cluster } from 'puppeteer-cluster';
import puppeteer, { type Browser, type Page } from 'puppeteer';

/**
 * Injection token for the HTML → PDF renderer. The default
 * implementation ({@link PuppeteerRenderer}) drives a `puppeteer-cluster`
 * pool with up to 4 concurrent page contexts. Tests can override
 * this with a stub that returns a fixed PDF byte sequence so they
 * don't need a Chromium binary.
 */
export const PRINT_RENDERER = 'PRINT_RENDERER';

export interface PrintRenderer {
  /**
   * Render a complete HTML document to a PDF buffer.
   *
   * @param html  the full HTML (including <head>, <body>, embedded CSS)
   * @param hint  identifier used for logging — never PHI (e.g. visit id)
   */
  renderPdf(html: string, hint: string): Promise<Buffer>;
}

const DEFAULT_CONCURRENCY = 4;

interface PuppeteerJob {
  html: string;
  hint: string;
}

/**
 * Long-lived Puppeteer browser shared via {@link Cluster}.
 *
 * Process model:
 *   * One Chromium binary per API process — `puppeteer.launch()` is
 *     called once at module init via the cluster.
 *   * Up to {@link DEFAULT_CONCURRENCY} page contexts at a time.
 *     Cluster queues additional jobs.
 *   * No network: Chromium is launched with `--disable-extensions
 *     --no-sandbox` and the page intercepts every request, only
 *     allowing `data:` URLs through (everything else 401s).
 *     Combined with Docker egress firewall (ADR-007), the render
 *     surface cannot exfiltrate clinical text.
 */
@Injectable()
export class PuppeteerRenderer implements PrintRenderer, OnModuleDestroy {
  private readonly logger = new Logger(PuppeteerRenderer.name);
  private clusterPromise: Promise<Cluster<PuppeteerJob, Buffer>> | null = null;

  async renderPdf(html: string, hint: string): Promise<Buffer> {
    const cluster = await this.getCluster();
    const started = Date.now();
    try {
      const pdf = await cluster.execute({ html, hint });
      const ms = Date.now() - started;
      // No PHI in logs — hint is the resource id (UUID).
      this.logger.debug(`Rendered PDF (${pdf.byteLength} bytes) in ${ms}ms for ${hint}`);
      return pdf;
    } catch (err: unknown) {
      this.logger.error(
        `PDF render failed for ${hint}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.clusterPromise) return;
    try {
      const cluster = await this.clusterPromise;
      await cluster.idle();
      await cluster.close();
    } catch (err: unknown) {
      this.logger.warn(
        `Cluster shutdown error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private getCluster(): Promise<Cluster<PuppeteerJob, Buffer>> {
    if (!this.clusterPromise) {
      this.clusterPromise = this.launchCluster();
    }
    return this.clusterPromise;
  }

  private async launchCluster(): Promise<Cluster<PuppeteerJob, Buffer>> {
    const cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: DEFAULT_CONCURRENCY,
      puppeteer,
      puppeteerOptions: buildPuppeteerLaunchOptions(),
      timeout: 30_000,
    });
    cluster.task(async ({ page, data }: { page: Page; data: PuppeteerJob }) => {
      // Defense in depth: block every outbound request from the
      // print page. The template embeds CSS + SVG inline; nothing
      // legitimate needs to leave the page.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('about:')) {
          req.continue();
          return;
        }
        req.abort();
      });
      await page.setContent(data.html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A5',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    });
    cluster.on('taskerror', (err: unknown, data: PuppeteerJob) => {
      this.logger.error(
        `Cluster task error for ${data?.hint ?? 'unknown'}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return cluster;
  }
}

/**
 * Adapter wrapper around the renderer token so consumers depend on
 * the interface, not the concrete service. Lets the integration
 * tests swap in a stub via `.overrideProvider(PRINT_RENDERER)`.
 */
@Injectable()
export class PrintRendererProxy {
  constructor(@Inject(PRINT_RENDERER) private readonly impl: PrintRenderer) {}
  render(html: string, hint: string): Promise<Buffer> {
    return this.impl.renderPdf(html, hint);
  }
}

// Ensure `Browser` is treated as used — TypeScript would otherwise
// flag the type import as unused under noUnusedLocals.
export type _PuppeteerBrowser = Browser;

/**
 * Build the Puppeteer launch options. Honors `PUPPETEER_EXECUTABLE_PATH`
 * when set (Dockerfile.api sets it to `/usr/bin/chromium` so the
 * apt-installed binary matches the container arch). When unset, the
 * launch options omit `executablePath`, leaving Puppeteer free to
 * fall back to its bundled Chrome — which is the production path on
 * x86-64 Linux servers.
 *
 * Exported for the unit test; the renderer is the only runtime caller.
 */
export function buildPuppeteerLaunchOptions() {
  const executablePath = process.env['PUPPETEER_EXECUTABLE_PATH'];
  return {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-gpu',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };
}
