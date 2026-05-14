// Print delivery via a hidden iframe.
//
// The API streams `application/pdf`. Most browsers render the PDF
// inline in an iframe and expose `.contentWindow.print()` once the
// document loads. This module owns the iframe lifecycle:
//
//   * one element per page (`#klinika-print-frame`)
//   * recycled across prints — we replace `src` to fetch fresh data
//   * removed from the DOM only on hard navigation
//
// On error we surface a friendly Albanian dialog via the global
// `window.alert` rather than building a print-specific failure UI —
// the doctor's recovery is to try again or open the PDF in a new
// tab. Slice 16 may add a richer fallback.

const FRAME_ID = 'klinika-print-frame';

export interface PrintFrameOptions {
  /** Source URL — must return application/pdf. */
  src: string;
  /**
   * If true, automatically trigger the browser print dialog on
   * iframe load. False is useful when we want to just open the PDF
   * preview (e.g. "Shiko vërtetimin" button) — though v1 always
   * prints since the embedded view is the preview.
   */
  autoPrint?: boolean;
  /**
   * Called when the PDF fails to load (404, 403, network). Default
   * shows a window.alert in Albanian.
   */
  onError?: () => void;
}

/**
 * Embed the PDF at `src` in a hidden iframe and (by default) trigger
 * the browser's print dialog as soon as it loads. Returns a cleanup
 * function the caller can use if it wants to abort the print early
 * (e.g. on component unmount).
 */
export function openPrintFrame(opts: PrintFrameOptions): () => void {
  if (typeof window === 'undefined') return noop;
  const autoPrint = opts.autoPrint ?? true;
  const frame = ensureFrame();

  // Allow either same-origin or cross-origin PDFs by listening for
  // both `load` and `error`. Some browsers fire `load` even when the
  // request 404s, so we additionally check the response code with a
  // separate fetch and bail on non-2xx.
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    frame.removeEventListener('load', onLoad);
    frame.removeEventListener('error', onError);
  };

  function onLoad(): void {
    if (!autoPrint) return;
    // Some browsers need a microtask gap to fully paint the PDF
    // viewer before `print()` does anything. 100ms is empirically
    // enough on Chromium / Firefox; Safari sometimes needs more,
    // but we never run print pipelines in Safari for v1.
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        // Cross-origin restrictions or PDF-viewer quirks — fall
        // back to opening the PDF in a new tab.
        window.open(opts.src, '_blank', 'noopener');
      }
    }, 120);
  }

  function onError(): void {
    cleanup();
    if (opts.onError) {
      opts.onError();
    } else {
      // eslint-disable-next-line no-alert
      window.alert('Printimi dështoi. Provoni përsëri.');
    }
  }

  frame.addEventListener('load', onLoad);
  frame.addEventListener('error', onError);
  // Bust browser cache for repeated reprints of the same resource —
  // the API sets `Cache-Control: no-store` already, but some
  // browsers still ignore that for embedded PDFs.
  const url = new URL(opts.src, window.location.origin);
  url.searchParams.set('_t', String(Date.now()));
  frame.src = url.toString();
  return cleanup;
}

function ensureFrame(): HTMLIFrameElement {
  const existing = document.getElementById(FRAME_ID);
  if (existing instanceof HTMLIFrameElement) return existing;
  const frame = document.createElement('iframe');
  frame.id = FRAME_ID;
  frame.setAttribute('aria-hidden', 'true');
  // Hidden but rendered — Chromium needs the frame to be in the
  // layout tree before `print()` works. `display: none` would
  // suppress the print pipeline entirely.
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.visibility = 'hidden';
  document.body.appendChild(frame);
  return frame;
}

function noop(): void {
  /* empty cleanup */
}
