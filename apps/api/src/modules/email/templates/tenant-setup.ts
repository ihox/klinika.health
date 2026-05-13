import { emailFrame, escape } from './shared';

export interface TenantSetupEmailVars {
  firstName: string;
  clinicName: string;
  subdomain: string;
  loginUrl: string;
  temporaryPassword: string;
}

/**
 * Initial-setup email sent to a brand-new clinic admin after a
 * platform admin provisions their tenant. Carries the clinic URL and
 * a one-time temporary password the recipient is expected to rotate
 * on first login.
 *
 * The password is included in plain text because the recipient is the
 * *only* party who can act on it (delivery is to their inbox, with
 * TLS in transit). Email is not a safe long-term store — the copy
 * urges the recipient to change it immediately.
 */
export function tenantSetupEmail(vars: TenantSetupEmailVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Mirë se erdhe te ${vars.clinicName} · Klinika`;

  const text = [
    `Përshëndetje ${vars.firstName},`,
    '',
    `Klinika juaj është krijuar në platformën Klinika.`,
    '',
    `Klinika:        ${vars.clinicName}`,
    `Adresa:         ${vars.subdomain}.klinika.health`,
    `Email-i juaj:   (po shfaqet në adresën e marrësit)`,
    `Fjalëkalimi:    ${vars.temporaryPassword}`,
    '',
    `Hapni lidhjen për të hyrë: ${vars.loginUrl}`,
    '',
    'Ndryshojeni fjalëkalimin menjëherë pas hyrjes së parë. Fjalëkalimi i mësipërm',
    'është i përkohshëm dhe duhet të zëvendësohet sa më shpejt.',
    '',
    'Pasi të hyni, mund të shtoni mjekë dhe recepsion nga seksioni "Përdorues".',
    '',
    '— Klinika',
    'klinika.health · email automatik, mos përgjigjuni',
  ].join('\n');

  const html = emailFrame(
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Përshëndetje ${escape(vars.firstName)},</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      Klinika juaj <strong>${escape(vars.clinicName)}</strong> është krijuar në platformën Klinika.
    </p>
    <div style="margin:16px 0;padding:16px 18px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;font-size:13.5px;color:#115E59;">
      <div style="margin-bottom:6px;"><span style="color:#57534E;">Adresa:</span> <span style="font-family:'JetBrains Mono',Menlo,monospace;">${escape(vars.subdomain)}.klinika.health</span></div>
      <div><span style="color:#57534E;">Fjalëkalimi i përkohshëm:</span> <span style="font-family:'JetBrains Mono',Menlo,monospace;font-weight:600;">${escape(vars.temporaryPassword)}</span></div>
    </div>
    <div style="margin:18px 0 12px;text-align:center;">
      <a href="${escape(vars.loginUrl)}" style="display:inline-block;padding:12px 22px;background:#0D9488;color:#FFFFFF;font-weight:500;text-decoration:none;border-radius:8px;font-size:14px;">Hyni në klinikën tuaj</a>
    </div>
    <p style="margin:14px 0 4px;font-size:12.5px;color:#57534E;line-height:1.6;">
      Ose kopjoni këtë lidhje në shfletues:
    </p>
    <p style="margin:0 0 18px;font-size:12.5px;color:#57534E;line-height:1.6;word-break:break-all;">
      <a href="${escape(vars.loginUrl)}" style="color:#0D9488;text-decoration:underline;">${escape(vars.loginUrl)}</a>
    </p>
    <p style="margin:0 0 8px;font-size:12.5px;color:#B45309;line-height:1.6;">
      <strong>I rëndësishëm:</strong> ndryshojeni fjalëkalimin menjëherë pas hyrjes së parë.
    </p>
    <p style="margin:0;font-size:12.5px;color:#57534E;line-height:1.6;">
      Pasi të hyni, mund të shtoni mjekë dhe recepsion nga seksioni "Përdorues".
    </p>
    `,
    `Klinika juaj ${vars.clinicName} u krijua në Klinika`,
  );

  return { subject, text, html };
}
