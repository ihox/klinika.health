import { emailFrame, escape } from './shared';

export interface PasswordResetEmailVars {
  firstName: string;
  resetUrl: string;
  ttlMinutes: number;
}

/** Password reset email — Albanian. */
export function passwordResetEmail(vars: PasswordResetEmailVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Rivendosja e fjalëkalimit · Klinika';

  const text = [
    `Përshëndetje ${vars.firstName},`,
    '',
    'Kërkuat të rivendosni fjalëkalimin tuaj në Klinika.',
    'Hapni lidhjen më poshtë për të vendosur një fjalëkalim të ri:',
    '',
    `  ${vars.resetUrl}`,
    '',
    `Lidhja vlen për ${vars.ttlMinutes} minuta dhe mund të përdoret vetëm një herë.`,
    '',
    'Nëse nuk e keni kërkuar këtë, injoroni këtë email. Fjalëkalimi juaj nuk ndryshon.',
    '',
    '— Klinika',
    'klinika.health · email automatik, mos përgjigjuni',
  ].join('\n');

  const html = emailFrame(
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Përshëndetje ${escape(vars.firstName)},</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      Kërkuat të rivendosni fjalëkalimin tuaj në Klinika. Klikoni butonin më poshtë për të
      vendosur një fjalëkalim të ri:
    </p>
    <div style="margin:20px 0 12px;text-align:center;">
      <a href="${escape(vars.resetUrl)}" style="display:inline-block;padding:12px 22px;background:#0D9488;color:#FFFFFF;font-weight:500;text-decoration:none;border-radius:8px;font-size:14px;">Rivendos fjalëkalimin</a>
    </div>
    <p style="margin:0 0 4px;font-size:12.5px;color:#57534E;line-height:1.6;">
      Ose kopjoni këtë lidhje në shfletues:
    </p>
    <p style="margin:0 0 18px;font-size:12.5px;color:#57534E;line-height:1.6;word-break:break-all;">
      <a href="${escape(vars.resetUrl)}" style="color:#0D9488;text-decoration:underline;">${escape(vars.resetUrl)}</a>
    </p>
    <p style="margin:0 0 12px;font-size:12.5px;color:#57534E;line-height:1.6;">
      Lidhja vlen për ${vars.ttlMinutes} minuta dhe mund të përdoret vetëm një herë.
    </p>
    <p style="margin:0;font-size:12.5px;color:#A8A29E;line-height:1.6;">
      Nëse nuk e keni kërkuar këtë, injoroni këtë email. Fjalëkalimi juaj nuk ndryshon.
    </p>
    `,
    'Rivendosja e fjalëkalimit në Klinika',
  );

  return { subject, text, html };
}
