import { UAParser } from 'ua-parser-js';

/**
 * Render a short Albanian-friendly device label from a User-Agent
 * string. Used for the "trusted devices" list and the new-device
 * alert email.
 *
 * Examples:
 *   - "Chrome · macOS"
 *   - "Safari · iPad"
 *   - "Firefox · Windows"
 *   - "Klient i panjohur" (when parser produces nothing)
 */
export function labelFromUserAgent(userAgent: string): string {
  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser().name;
  const os = parser.getOS().name;
  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;
  return 'Klient i panjohur';
}

/** Mask an email so the user can confirm it's the right address
 * without exposing the full string in the URL/UI ("t…t@donetamed.com").
 * Matches the prototype's §1.1 horizontal-ellipsis style.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) {
    return `${local[0] ?? ''}…${domain}`;
  }
  return `${local[0]}…${local[local.length - 1]}${domain}`;
}
