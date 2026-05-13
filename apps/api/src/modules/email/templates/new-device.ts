import { emailFrame, escape } from './shared';

export interface NewDeviceEmailVars {
  firstName: string;
  deviceLabel: string;
  ipAddressMasked: string;
  whenFormatted: string;
}

/** New-device alert email — Albanian. Mirrors prototype §2.2. */
export function newDeviceEmail(vars: NewDeviceEmailVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Pajisje e re u lidh me llogarinë · Klinika';

  const text = [
    `Përshëndetje ${vars.firstName},`,
    '',
    'Një pajisje e re u lidh me llogarinë tuaj në Klinika:',
    '',
    `  Pajisja:  ${vars.deviceLabel}`,
    `  IP:       ${vars.ipAddressMasked}`,
    `  Koha:     ${vars.whenFormatted}`,
    '',
    "Nëse keni qenë ju, asgjë për t'u bërë.",
    '',
    'Nëse jo, kontaktoni menjëherë admin-in e klinikës dhe ndryshoni',
    'fjalëkalimin nga "Profili im".',
    '',
    '— Klinika',
    'klinika.health · email automatik, mos përgjigjuni',
  ].join('\n');

  const html = emailFrame(
    `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">Përshëndetje ${escape(vars.firstName)},</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Një pajisje e re u lidh me llogarinë tuaj në Klinika:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;background:#F5F5F4;border:1px solid #E7E5E4;border-radius:8px;">
      <tr><td style="padding:14px 18px;font-size:13px;color:#57534E;width:90px;">Pajisja</td><td style="padding:14px 18px;font-size:13px;color:#1C1917;font-weight:500;">${escape(vars.deviceLabel)}</td></tr>
      <tr><td style="padding:0 18px 14px;font-size:13px;color:#57534E;">IP</td><td style="padding:0 18px 14px;font-size:13px;color:#1C1917;font-family:'JetBrains Mono',Menlo,monospace;">${escape(vars.ipAddressMasked)}</td></tr>
      <tr><td style="padding:0 18px 14px;font-size:13px;color:#57534E;">Koha</td><td style="padding:0 18px 14px;font-size:13px;color:#1C1917;">${escape(vars.whenFormatted)}</td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;">Nëse keni qenë ju, asgjë për t'u bërë.</p>
    <p style="margin:0;font-size:12.5px;color:#57534E;line-height:1.6;">
      Nëse jo, kontaktoni menjëherë admin-in e klinikës dhe ndryshoni fjalëkalimin nga <strong style="color:#1C1917;">Profili im</strong>.
    </p>
    `,
    `Pajisje e re u lidh me llogarinë tuaj: ${vars.deviceLabel}`,
  );

  return { subject, text, html };
}

/** Mask an IPv4/IPv6 address: keep the first two octets, redact the rest. */
export function maskIp(ipAddress: string): string {
  if (ipAddress.includes(':')) {
    const segs = ipAddress.split(':');
    return segs.slice(0, 2).join(':') + ':•:•';
  }
  const octets = ipAddress.split('.');
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.•.•`;
  }
  return '•';
}
