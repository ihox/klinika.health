import { describe, expect, it } from 'vitest';

import { sanitizeSvg, sanitizeSvgBuffer, SvgRejectedError } from './svg-sanitizer';

const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 0 L64 64 L0 64 Z" fill="#0D9488"/></svg>';

describe('sanitizeSvg', () => {
  it('returns valid SVG unchanged', () => {
    expect(sanitizeSvg(VALID_SVG)).toBe(VALID_SVG);
  });

  it('rejects a <script> tag', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path/></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
    try {
      sanitizeSvg(malicious);
    } catch (err) {
      expect(err).toBeInstanceOf(SvgRejectedError);
      expect((err as SvgRejectedError).reason).toBe('forbidden_element');
    }
  });

  it('rejects onload handlers', () => {
    const malicious = '<svg xmlns="..." onload="alert(1)"><path/></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
  });

  it('rejects javascript: URLs', () => {
    const malicious =
      '<svg xmlns="..."><a href="javascript:alert(1)"><path/></a></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
  });

  it('rejects DOCTYPE / ENTITY (XXE surface)', () => {
    const malicious =
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="..."><text>&x;</text></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
  });

  it('rejects <foreignObject>', () => {
    const malicious =
      '<svg xmlns="..."><foreignObject><body><script/></body></foreignObject></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
  });

  it('rejects <use xlink:href="javascript:..."> (use element banned outright)', () => {
    const malicious = '<svg xmlns="..."><use xlink:href="javascript:alert(1)"/></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
  });

  it('rejects <style> blocks (CSS expression surface)', () => {
    const malicious =
      '<svg xmlns="..."><style>* { behavior:url("xss.htc"); }</style><path/></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
  });

  it('rejects non-SVG input', () => {
    expect(() => sanitizeSvg('<html><body>hello</body></html>')).toThrow(SvgRejectedError);
  });

  it('rejects oversized input', () => {
    const big = '<svg xmlns="...">' + 'a'.repeat(2_000_000) + '</svg>';
    expect(() => sanitizeSvg(big)).toThrow(SvgRejectedError);
  });

  it('rejects case-variants of <Script>', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><Script>alert(1)</Script></svg>';
    expect(() => sanitizeSvg(malicious)).toThrow(SvgRejectedError);
  });

  it('sanitizeSvgBuffer round-trips bytes', () => {
    const out = sanitizeSvgBuffer(Buffer.from(VALID_SVG, 'utf8'));
    expect(out.toString('utf8')).toBe(VALID_SVG);
  });
});
