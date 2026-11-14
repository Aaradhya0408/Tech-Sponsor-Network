export interface TransactionalEmailContent {
  title: string;
  paragraphs: string[];
  buttonLabel: string;
  buttonUrl: string;
  unsubscribeUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function appUrl(path: string): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  const replitDev = process.env.REPLIT_DEV_DOMAIN?.trim();
  const replitProduction = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const vercel = process.env.VERCEL_URL?.trim();
  const domain = explicit || replitDev || replitProduction || vercel;
  const base = domain
    ? domain.includes("://")
      ? domain
      : `https://${domain}`
    : `http://localhost:${process.env.PORT || "8080"}`;
  return new URL(path, base).toString();
}

export function renderTransactionalEmail(
  content: TransactionalEmailContent,
): string {
  const paragraphs = content.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#52615a;font-size:15px;line-height:1.7;white-space:pre-wrap">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  const unsubscribe = content.unsubscribeUrl
    ? `<p style="margin:22px 0 0;color:#76817b;font-size:12px;line-height:1.6">No longer want these alerts? <a href="${escapeHtml(content.unsubscribeUrl)}" style="color:#315848;text-decoration:underline">Turn off alerts</a>.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.title)}</title></head>
  <body style="margin:0;background:#f4f2eb;font-family:Arial,Helvetica,sans-serif;color:#213a32">
    <div style="max-width:600px;margin:0 auto;padding:28px 16px">
      <div style="padding:18px 22px;border-radius:18px 18px 0 0;background:#213a32;color:#f4f0e5;font-size:17px;font-weight:700;letter-spacing:-.4px">Tech Sponsor Network</div>
      <div style="padding:32px 24px;background:#ffffff;border:1px solid #e4e2d9;border-top:0;border-radius:0 0 18px 18px">
        <h1 style="margin:0 0 20px;color:#213a32;font-size:26px;line-height:1.2;letter-spacing:-.6px">${escapeHtml(content.title)}</h1>
        ${paragraphs}
        <p style="margin:26px 0 0"><a href="${escapeHtml(content.buttonUrl)}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#397b65;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(content.buttonLabel)}</a></p>
        ${unsubscribe}
      </div>
      <p style="margin:18px 0 0;text-align:center;color:#76817b;font-size:11px;line-height:1.6">You received this message because of activity in your Tech Sponsor Network account.</p>
    </div>
  </body>
</html>`;
}

export function renderUnsubscribeResult(success: boolean): string {
  const heading = success ? "Campaign alerts turned off" : "This link is invalid or expired";
  const message = success
    ? "You will no longer receive new campaign alerts. You can turn them back on in your profile settings."
    : "We could not update your campaign alert preference. Sign in and change it from your profile settings.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head><body style="margin:0;background:#f4f2eb;font-family:Arial,Helvetica,sans-serif;color:#213a32"><main style="max-width:560px;margin:48px auto;padding:32px 24px;background:#fff;border:1px solid #e4e2d9;border-radius:18px"><p style="margin:0 0 18px;font-weight:700">Tech Sponsor Network</p><h1 style="margin:0 0 14px;font-size:26px">${heading}</h1><p style="color:#52615a;line-height:1.7">${message}</p></main></body></html>`;
}
