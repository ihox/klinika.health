/** Minimal HTML wrapper shared across Albanian transactional emails.
 *
 * Inline-safe styles; degrades to plain text in clients that strip
 * CSS (Outlook desktop, some mobile clients). No images, no buttons,
 * no clinical letterhead — per the prototype's §2 decision. The
 * brand mark and footer are the only chrome.
 */
export function emailFrame(innerHtml: string, preheader: string): string {
  const escapedPre = escape(preheader);
  return `<!doctype html>
<html lang="sq">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Klinika</title>
</head>
<body style="margin:0;padding:0;background:#FAFAF9;font-family:Inter,Arial,sans-serif;color:#1C1917;">
<span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapedPre}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAFAF9;">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;background:#FFFFFF;border:1px solid #E7E5E4;border-radius:12px;">
      <tr><td style="padding:32px 36px;">
        ${innerHtml}
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #F0EFEC;font-size:12.5px;color:#A8A29E;line-height:1.6;">
          <div style="font-weight:600;color:#57534E;">Klinika</div>
          <div>klinika.health · email automatik, mos përgjigjuni</div>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
