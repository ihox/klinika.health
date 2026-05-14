import { emailFrame, escape } from './shared';

export interface UserInviteEmailVars {
  firstName: string;
  clinicName: string;
  inviterName: string;
  loginUrl: string;
  temporaryPassword: string;
  role: 'doctor' | 'receptionist' | 'clinic_admin';
}

/**
 * Email sent when a clinic admin invites a new staff member from the
 * "Përdoruesit" tab of clinic settings. Mirrors the tone of
 * `tenant-setup.ts` but framed as an invitation rather than a
 * brand-new tenant. The temporary password is included; the recipient
 * is expected to rotate it on first login.
 */
export function userInviteEmail(vars: UserInviteEmailVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `${vars.clinicName} ju ftoi në Klinika`;
  const roleLabel = roleLabelAl(vars.role);

  const text = [
    `Përshëndetje ${vars.firstName},`,
    '',
    `${vars.inviterName} ju ka shtuar si ${roleLabel} në klinikën ${vars.clinicName}.`,
    '',
    `Fjalëkalimi i përkohshëm: ${vars.temporaryPassword}`,
    `Linku për hyrje:         ${vars.loginUrl}`,
    '',
    'Hyni dhe ndryshojeni fjalëkalimin menjëherë pas hyrjes së parë.',
    '',
    '— Klinika',
    'klinika.health · email automatik, mos përgjigjuni',
  ].join('\n');

  const html = emailFrame(
    `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Përshëndetje ${escape(vars.firstName)},</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
      <strong>${escape(vars.inviterName)}</strong> ju ka shtuar si <strong>${escape(roleLabel)}</strong>
      në klinikën <strong>${escape(vars.clinicName)}</strong>.
    </p>
    <div style="margin:16px 0;padding:16px 18px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:8px;font-size:13.5px;color:#115E59;">
      <div><span style="color:#57534E;">Fjalëkalimi i përkohshëm:</span> <span style="font-family:'JetBrains Mono',Menlo,monospace;font-weight:600;">${escape(vars.temporaryPassword)}</span></div>
    </div>
    <div style="margin:18px 0 12px;text-align:center;">
      <a href="${escape(vars.loginUrl)}" style="display:inline-block;padding:12px 22px;background:#0D9488;color:#FFFFFF;font-weight:500;text-decoration:none;border-radius:8px;font-size:14px;">Hyni në klinikë</a>
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
    `${vars.clinicName} ju ftoi në Klinika`,
  );

  return { subject, text, html };
}

function roleLabelAl(role: UserInviteEmailVars['role']): string {
  switch (role) {
    case 'doctor':
      return 'mjek';
    case 'receptionist':
      return 'infermier/e';
    case 'clinic_admin':
      return 'administrator i klinikës';
  }
}
