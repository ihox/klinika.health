import { emailFrame, escape } from './shared';

export interface MfaCodeEmailVars {
  firstName: string;
  code: string;
  ttlMinutes: number;
}

/** Verification code email — Albanian. Mirrors prototype §2.1. */
export function mfaCodeEmail(vars: MfaCodeEmailVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Kodi i verifikimit · Klinika';
  // Format the code with a half-width space in the middle for visual
  // legibility (`482 613`). The plain-text version uses ASCII space.
  const codeFormatted = `${vars.code.slice(0, 3)} ${vars.code.slice(3)}`;

  const text = [
    `Përshëndetje ${vars.firstName},`,
    '',
    'Kodi juaj i verifikimit për Klinika është:',
    '',
    `    ${codeFormatted}`,
    '',
    `Vlen për ${vars.ttlMinutes} minuta.`,
    '',
    'Nëse nuk po hyni në Klinika, injoroni këtë email dhe kontaktoni admin-in e klinikës.',
    '',
    '— Klinika',
    'klinika.health · email automatik, mos përgjigjuni',
  ].join('\n');

  const html = emailFrame(
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Përshëndetje ${escape(vars.firstName)},</p>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">Kodi juaj i verifikimit për Klinika është:</p>
    <div style="margin:16px 0 8px;padding:18px 20px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;text-align:center;">
      <div style="font-family:'JetBrains Mono',Menlo,monospace;font-size:30px;letter-spacing:6px;color:#115E59;font-weight:600;">${escape(codeFormatted)}</div>
      <div style="font-size:12px;color:#57534E;margin-top:6px;">Vlen për ${vars.ttlMinutes} minuta</div>
    </div>
    <p style="margin:18px 0 0;font-size:12.5px;color:#57534E;line-height:1.6;">
      Nëse nuk po hyni në Klinika, injoroni këtë email dhe kontaktoni admin-in e klinikës.
    </p>
    `,
    `Kodi juaj i verifikimit: ${codeFormatted}`,
  );

  return { subject, text, html };
}
