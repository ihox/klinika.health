import { describe, expect, it } from 'vitest';

import { maskIp, newDeviceEmail } from './templates/new-device';
import { mfaCodeEmail } from './templates/mfa-code';
import { passwordResetEmail } from './templates/password-reset';

describe('email templates', () => {
  it('mfa code email contains the formatted code and Albanian copy', () => {
    const out = mfaCodeEmail({ firstName: 'Taulant', code: '482613', ttlMinutes: 15 });
    expect(out.subject).toBe('Kodi i verifikimit · Klinika');
    expect(out.text).toContain('Përshëndetje Taulant,');
    expect(out.text).toContain('482 613');
    expect(out.text).toContain('Vlen për 15 minuta');
    expect(out.html).toContain('482 613');
    expect(out.html).toContain('Përshëndetje Taulant');
  });

  it('new device email shows the device label and masked IP', () => {
    const out = newDeviceEmail({
      firstName: 'Taulant',
      deviceLabel: 'Chrome · macOS',
      ipAddressMasked: '94.140.•.•',
      whenFormatted: '14.05.2026 · 09:23',
    });
    expect(out.subject).toBe('Pajisje e re u lidh me llogarinë · Klinika');
    expect(out.text).toContain('Chrome · macOS');
    expect(out.text).toContain('94.140.•.•');
    expect(out.html).toContain('Chrome · macOS');
  });

  it('password reset email contains the reset link and TTL', () => {
    const out = passwordResetEmail({
      firstName: 'Era',
      resetUrl: 'https://donetamed.klinika.health/reset-password?t=abc',
      ttlMinutes: 60,
    });
    expect(out.subject).toBe('Rivendosja e fjalëkalimit · Klinika');
    expect(out.text).toContain('https://donetamed.klinika.health/reset-password?t=abc');
    expect(out.text).toContain('60 minuta');
    expect(out.html).toContain('Rivendos fjalëkalimin');
  });

  it('escapes HTML in firstName to prevent template injection', () => {
    const out = mfaCodeEmail({ firstName: 'Bobby<script>', code: '482613', ttlMinutes: 15 });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('Bobby&lt;script&gt;');
    // Plain-text version intentionally keeps the original — it's not interpreted.
    expect(out.text).toContain('Bobby<script>');
  });
});

describe('maskIp', () => {
  it('keeps the first two IPv4 octets', () => {
    expect(maskIp('94.140.123.45')).toBe('94.140.•.•');
  });
  it('keeps the first two IPv6 segments', () => {
    expect(maskIp('2001:db8::1234')).toBe('2001:db8:•:•');
  });
  it('produces a placeholder for an unparseable input', () => {
    expect(maskIp('garbage')).toBe('•');
  });
});
