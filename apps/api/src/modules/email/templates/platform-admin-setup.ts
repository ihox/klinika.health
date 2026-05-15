import { emailFrame, escape } from './shared';

export interface PlatformAdminSetupEmailVars {
  firstName: string;
  loginUrl: string;
  temporaryPassword: string;
}

/**
 * Initial-setup email sent to a newly-provisioned platform admin.
 * Mirrors the shape of {@link tenantSetupEmail} but omits any
 * subdomain/clinic reference: platform admins log in at the apex
 * domain only (see ADR-005), so there is no "Adresa: …" line.
 */
export function platformAdminSetupEmail(vars: PlatformAdminSetupEmailVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Mirë se erdhe te Klinika · Administrator i platformës';

  const text = [
    `Përshëndetje ${vars.firstName},`,
    '',
    'Llogaria juaj si administrator i platformës Klinika është krijuar.',
    '',
    `Fjalëkalimi:    ${vars.temporaryPassword}`,
    '',
    `Hapni lidhjen për të hyrë: ${vars.loginUrl}`,
    '',
    'Ndryshojeni fjalëkalimin menjëherë pas hyrjes së parë. Fjalëkalimi i mësipërm',
    'është i përkohshëm dhe duhet të zëvendësohet sa më shpejt.',
    '',
    '— Klinika',
    'klinika.health · email automatik, mos përgjigjuni',
  ].join('\n');

  const html = emailFrame(
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Përshëndetje ${escape(vars.firstName)},</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      Llogaria juaj si <strong>administrator i platformës Klinika</strong> është krijuar.
    </p>
    <div style="margin:16px 0;padding:16px 18px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;font-size:13.5px;color:#115E59;">
      <div><span style="color:#57534E;">Fjalëkalimi i përkohshëm:</span> <span style="font-family:'JetBrains Mono',Menlo,monospace;font-weight:600;">${escape(vars.temporaryPassword)}</span></div>
    </div>
    <div style="margin:18px 0 12px;text-align:center;">
      <a href="${escape(vars.loginUrl)}" style="display:inline-block;padding:12px 22px;background:#0D9488;color:#FFFFFF;font-weight:500;text-decoration:none;border-radius:8px;font-size:14px;">Hyni në panelin e administratorit</a>
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
    `,
    'Llogaria juaj e administratorit u krijua në Klinika',
  );

  return { subject, text, html };
}
