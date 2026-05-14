/**
 * Minimal SVG sanitizer for clinic logos. Logos are user-uploaded
 * markup served back to other clinic users, so anything that could
 * execute (script tags, event handlers, javascript: URLs, external
 * references) must be stripped before storage.
 *
 * This intentionally rejects rather than rewrites — a logo that
 * contains forbidden constructs is invalid input, not something we
 * silently fix. The caller gets a typed error reason it can map to an
 * Albanian UI message.
 *
 * Not a general-purpose HTML/XML parser: it's narrow on purpose. The
 * forbidden patterns target the documented attack surface (XSS via
 * SVG) and the allowed shapes match what design tools export for a
 * pediatric-clinic logo (paths, polygons, text, basic gradients).
 */

const FORBIDDEN_ELEMENTS = [
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'style', // inline CSS can carry `behavior:` / `expression()` in old IE; ban for safety
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'use', // external references via xlink:href
  'image', // can <image href="javascript:..."> in some parsers
] as const;

// Any attribute starting with `on` (onload, onclick, onmouseover, ...)
// is treated as an event handler and rejected outright.
const EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=/i;

// Dangerous URL schemes inside href/xlink:href/style url(...).
const DANGEROUS_URL_PATTERN =
  /(?:href|xlink:href|src)\s*=\s*['"]?\s*(?:javascript|data|vbscript|file)\s*:/i;

const CSS_EXPRESSION_PATTERN = /expression\s*\(/i;
const CSS_BEHAVIOR_PATTERN = /behavior\s*:\s*url/i;

export type SvgRejectionReason =
  | 'not_svg'
  | 'forbidden_element'
  | 'event_handler'
  | 'dangerous_url'
  | 'css_expression'
  | 'doctype'
  | 'too_large';

export class SvgRejectedError extends Error {
  constructor(public readonly reason: SvgRejectionReason, message: string) {
    super(message);
    this.name = 'SvgRejectedError';
  }
}

const MAX_SIZE_BYTES = 2_000_000; // 2 MB ceiling.

/**
 * Returns the original SVG text verbatim if it passes every check;
 * otherwise throws {@link SvgRejectedError}. The caller stores the
 * returned bytes — sanitization rejects, it does not rewrite.
 */
export function sanitizeSvg(input: string): string {
  if (input.length > MAX_SIZE_BYTES) {
    throw new SvgRejectedError('too_large', 'SVG është më i madh se 2MB.');
  }
  const lower = input.toLowerCase();

  // Quick top-level shape check. Whitespace + XML decl + optional
  // DOCTYPE + <svg ...>. We forbid DOCTYPE outright because external
  // entities can pull arbitrary URLs at parse time (XXE on some
  // downstream renderers / browsers).
  if (lower.includes('<!doctype') || lower.includes('<!entity')) {
    throw new SvgRejectedError('doctype', 'DOCTYPE / ENTITY nuk lejohet në SVG.');
  }
  if (!lower.includes('<svg')) {
    throw new SvgRejectedError('not_svg', 'Skedari nuk është SVG i vlefshëm.');
  }

  for (const tag of FORBIDDEN_ELEMENTS) {
    // Match `<tag` followed by a non-letter so `<scripted>` (hypothetical)
    // doesn't false-positive `script`.
    const pattern = new RegExp(`<\\s*${tag}[\\s/>]`, 'i');
    if (pattern.test(input)) {
      throw new SvgRejectedError(
        'forbidden_element',
        `Elementi <${tag}> nuk lejohet në logo.`,
      );
    }
  }

  if (EVENT_HANDLER_PATTERN.test(input)) {
    throw new SvgRejectedError('event_handler', 'Atributet onXXX nuk lejohen.');
  }

  if (DANGEROUS_URL_PATTERN.test(input)) {
    throw new SvgRejectedError(
      'dangerous_url',
      'URL me skemë javascript:/data:/file: nuk lejohet.',
    );
  }

  if (CSS_EXPRESSION_PATTERN.test(input) || CSS_BEHAVIOR_PATTERN.test(input)) {
    throw new SvgRejectedError('css_expression', 'CSS expression / behavior nuk lejohet.');
  }

  return input;
}

/**
 * Convenience for the byte path used by the upload controller: bytes
 * come in as a Buffer, decoded as UTF-8, sanitized, and returned as a
 * Buffer ready to write to disk.
 */
export function sanitizeSvgBuffer(input: Buffer): Buffer {
  const text = input.toString('utf8');
  const cleaned = sanitizeSvg(text);
  return Buffer.from(cleaned, 'utf8');
}
