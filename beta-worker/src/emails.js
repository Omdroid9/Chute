// The two emails a beta signup sends: "You're on the list" to the visitor,
// and a signup notification to us. Table layout with inline styles, since
// that's what survives Gmail, Outlook and Apple Mail alike. Web fonts load
// in Apple Mail and fall back to system fonts everywhere else.
//
// Light first, with a dark version for mail apps that follow the reader's
// setting (Apple Mail, iOS Mail, Outlook for Mac). Apps that force their own
// dark mode (Zoho, Gmail's app) invert colours instead, and that only comes
// out clean from a light design: a dark one flips to light with black borders.

const LIGHT = {
  bg: "#f4f4f6",
  card: "#ffffff",
  panel: "#f7f7f9",
  field: "#ffffff",
  border: "#e7e7ec",
  panelBorder: "#dfdfe6",
  strong: "#0b0b0f",
  body: "#4a4a55",
  dim: "#767682",
  faint: "#9a9aa4",
  accent: "#3d6dd0",
  green: "#1f9d55",
  button: "#0b0b0f",
  buttonText: "#ffffff",
};

const DARK = {
  bg: "#07070a",
  card: "#0d0d11",
  panel: "#15151a",
  field: "#1c1c22",
  border: "#1d1d24",
  panelBorder: "#26262e",
  strong: "#fafafd",
  body: "#b4b4be",
  dim: "#7c7c88",
  faint: "#5c5c66",
  accent: "#7aa9ee",
  green: "#4ade80",
  button: "#fafafd",
  buttonText: "#07070a",
};

const C = LIGHT;

const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const DISPLAY = "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Inter:wght@400;500;600&family=Instrument+Serif:ital@1&family=Geist+Mono:wght@500&display=swap";

// Each themed element carries one of these classes; the dark block swaps
// its inline light colour for the dark one.
const DARK_CSS = `
    body, .bg { background: ${DARK.bg} !important; }
    .card { background: ${DARK.card} !important; border-color: ${DARK.border} !important; }
    .panel { background: ${DARK.panel} !important; border-color: ${DARK.panelBorder} !important; }
    .field { background: ${DARK.field} !important; border-color: ${DARK.panelBorder} !important; }
    .bd { border-color: ${DARK.border} !important; }
    .t-strong { color: ${DARK.strong} !important; }
    .t-body { color: ${DARK.body} !important; }
    .t-dim { color: ${DARK.dim} !important; }
    .t-faint { color: ${DARK.faint} !important; }
    .t-accent { color: ${DARK.accent} !important; }
    .t-ok { color: ${DARK.green} !important; }
    .btn { background: ${DARK.button} !important; }
    .btn-t { color: ${DARK.buttonText} !important; }`;

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// Mail apps turn anything shaped like an address into a blue link; a
// zero-width space after the @ keeps the one we display as plain text.
const unlinked = (email) => esc(email).replace("@", "@&#8203;");

export function platformOf(ua = "") {
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function placeOf({ city, country }) {
  let region = country;
  try {
    if (country) region = new Intl.DisplayNames(["en"], { type: "region" }).of(country);
  } catch {
    // Unknown code: keep it as is.
  }
  return [city, region].filter(Boolean).join(", ") || null;
}

const whenOf = (iso, timeZone) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

function pageOf(referer) {
  try {
    const url = new URL(referer);
    return url.host + (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return null;
  }
}

function shell({ title, preheader, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<link href="${FONTS}" rel="stylesheet">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin: 0; padding: 0; background: ${C.bg}; }
  @media (max-width: 620px) {
    .card { padding: 30px 22px 28px !important; }
    .h1 { font-size: 34px !important; }
  }
  @media (prefers-color-scheme: dark) {${DARK_CSS}
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}${"&#8199;&#847;".repeat(40)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:40px 16px 48px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
${body}
</table>
</td></tr>
</table>
</body>
</html>`;
}

const brandRow = (logo, badge = "") => `
<tr><td style="padding:0 4px 18px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="${logo}" width="22" height="22" alt="" style="display:block;border:0;"></td>
        <td class="t-strong" style="vertical-align:middle;padding-left:9px;font-family:${DISPLAY};font-size:16px;line-height:22px;font-weight:600;letter-spacing:-0.2px;color:${C.strong};">Chute</td>
      </tr></table>
    </td>
    ${badge ? `<td align="right" class="t-dim" style="vertical-align:middle;font-family:${MONO};font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:${C.dim};">${badge}</td>` : ""}
  </tr></table>
</td></tr>`;

const card = (inner) => `
<tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:18px;padding:40px 40px 36px;">
${inner}
</td></tr>`;

const footer = (text) => `
<tr><td class="t-faint" style="padding:22px 6px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.faint};">${text}</td></tr>`;

const para = (html, top = 18) =>
  `<p class="t-body" style="margin:${top}px 0 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.body};">${html}</p>`;

// The site's beta form is drawn as a Chute capture window; the email shows
// the same window, filled in and sent.
const captureWindow = (logo, email, status) => `
<table role="presentation" class="panel" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panel}" style="margin:28px 0 30px;background:${C.panel};border:1px solid ${C.panelBorder};border-radius:14px;">
  <tr><td class="bd" style="padding:12px 16px;border-bottom:1px solid ${C.border};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="t-body" style="vertical-align:middle;font-family:${SANS};font-size:12px;font-weight:500;color:${C.body};">
        <img src="${logo}" width="12" height="12" alt="" style="vertical-align:-2px;border:0;">&nbsp; Chute
      </td>
      <td align="right" class="t-faint" style="vertical-align:middle;font-family:${MONO};font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:${C.faint};">beta request</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:14px 16px 0;">
    <table role="presentation" class="field" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.field}" style="background:${C.field};border:1px solid ${C.panelBorder};border-radius:10px;">
      <tr><td class="t-strong" style="padding:11px 14px;font-family:${SANS};font-size:14px;font-weight:500;color:${C.strong};">${email}</td></tr>
    </table>
  </td></tr>
  <tr><td class="t-dim" style="padding:10px 16px 14px;font-family:${SANS};font-size:12px;color:${C.dim};">
    <span class="t-ok" style="color:${C.green};">&#9679;</span>&nbsp; On the list &rarr; ${status}
  </td></tr>
</table>`;

const numbered = (items) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
${items
  .map(
    (item, i) => `  <tr>
    <td width="34" valign="top" class="bd t-accent" style="padding:9px 0;border-top:1px solid ${C.border};font-family:${MONO};font-size:12px;line-height:22px;color:${C.accent};">0${i + 1}</td>
    <td class="bd t-strong" style="padding:9px 0;border-top:1px solid ${C.border};font-family:${SANS};font-size:15px;line-height:22px;color:${C.strong};">${item}</td>
  </tr>`,
  )
  .join("\n")}
</table>`;

export function confirmationEmail(signup, env) {
  const site = env.SITE_URL;
  const logo = `${site}/email/chute-sphere.png`;
  const { wants } = signup;
  const intro = wants
    ? `Thanks for asking to try Chute. It's in closed beta, so every installer goes out by hand. Your ${wants} installer will come from this address.`
    : "Thanks for asking to try Chute. It's in closed beta, so every installer goes out by hand, and yours will come from this address.";
  const status = wants ? `your ${wants} installer comes by email` : "your installer comes by email";
  // The form asks which installer they want; if it didn't reach us, the
  // email asks, since the right download can't go out without it.
  const asks = wants ? null : ["Mac or Windows?", "The first thing you'd capture with it."];
  const question = "One question while you wait: what's the first thing you'd capture with it? Just hit reply. I read every one.";

  const html = shell({
    title: "You're on the list",
    preheader: "Chute is in closed beta. Your installer comes by hand, from this address.",
    body: `${brandRow(logo)}
${card(`
  <h1 class="h1 t-strong" style="margin:0;font-family:${DISPLAY};font-size:40px;line-height:1.08;font-weight:700;letter-spacing:-1.2px;color:${C.strong};">You're on the <span style="font-family:${SERIF};font-style:italic;font-weight:400;letter-spacing:-0.4px;">list.</span></h1>
  ${para(intro)}
  ${captureWindow(logo, unlinked(signup.email), status)}
  ${asks ? `${para("Reply to this email with two things, so I send you the right one:", 0)}
  ${numbered(asks)}` : para(question, 0)}
  <p class="t-strong" style="margin:30px 0 0;font-family:${SANS};font-size:15px;font-weight:600;color:${C.strong};">Omkar</p>
  <p class="t-dim" style="margin:2px 0 0;font-family:${SANS};font-size:13px;color:${C.dim};">Making Chute &middot; <a href="${site}" class="t-dim" style="color:${C.dim};text-decoration:underline;">usechute.com</a></p>
`)}
${footer(`You're getting this because ${unlinked(signup.email)} asked for Chute beta access on usechute.com. If that wasn't you, ignore this email and you won't hear from us again.`)}`,
  });

  const text = [
    "You're on the list.",
    "",
    intro,
    "",
    ...(asks
      ? ["Reply to this email with two things, so I send you the right one:", ...asks.map((a, i) => `${i + 1}. ${a}`)]
      : [question]),
    "",
    "Omkar",
    `Making Chute · ${site}`,
    "",
    `You're getting this because ${signup.email} asked for Chute beta access on usechute.com. If that wasn't you, ignore this email and you won't hear from us again.`,
  ].join("\n");

  return {
    from: env.FROM_CONFIRM,
    to: [signup.email],
    subject: "You're on the Chute beta list",
    html,
    text,
  };
}

export function notificationEmail(signup, env) {
  const logo = `${env.SITE_URL}/email/chute-sphere.png`;
  const { email, wants, platform, number } = signup;
  const place = placeOf(signup);
  const when = whenOf(signup.at, env.TIMEZONE);
  // What they picked on the form wins; the device is a fallback guess.
  const pick = wants ?? (platform === "Mac" || platform === "Windows" ? platform : null);
  const hint = pick
    ? `Send the ${pick} installer (${pick === "Mac" ? ".dmg" : ".exe"}).`
    : platform
      ? `They signed up on ${platform}. Ask whether they use a Mac or Windows.`
      : "Ask whether they use a Mac or Windows.";
  const rows = [
    ["Wants", wants ?? "Not chosen"],
    ["Device", platform ?? "Unknown"],
    ["From", place ?? "Unknown"],
    ["When", when],
    ["Page", pageOf(signup.page) ?? "usechute.com"],
  ];
  const replyLink = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Your Chute beta installer")}`;

  const html = shell({
    title: `Beta request #${number}`,
    preheader: [wants ? `${wants} installer` : platform, place, when].filter(Boolean).join(" · "),
    body: `${brandRow(logo, `Beta request &middot; #${number}`)}
${card(`
  <p class="t-accent" style="margin:0;font-family:${MONO};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${C.accent};">New signup</p>
  <p class="t-strong" style="margin:10px 0 0;font-family:${DISPLAY};font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.6px;color:${C.strong};word-break:break-all;">${unlinked(email)}</p>
  ${para(esc(hint), 8)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;">
${rows
  .map(
    ([label, value]) => `    <tr>
      <td width="76" valign="top" class="bd t-dim" style="padding:12px 0;border-top:1px solid ${C.border};font-family:${MONO};font-size:11px;line-height:20px;letter-spacing:1.2px;text-transform:uppercase;color:${C.dim};">${label}</td>
      <td class="bd t-strong" style="padding:12px 0;border-top:1px solid ${C.border};font-family:${SANS};font-size:14px;line-height:20px;color:${C.strong};">${esc(value)}</td>
    </tr>`,
  )
  .join("\n")}
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr>
    <td class="btn" bgcolor="${C.button}" style="background:${C.button};border-radius:999px;">
      <a href="${replyLink}" class="btn-t" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:14px;font-weight:600;color:${C.buttonText};text-decoration:none;border-radius:999px;">Reply with the installer</a>
    </td>
  </tr></table>
  <p class="t-dim" style="margin:12px 0 0;font-family:${SANS};font-size:13px;color:${C.dim};">Or just hit Reply. It goes straight to them.</p>
`)}
${footer(`Signup #${number} on the beta list. They also get the "You're on the list" email.`)}`,
  });

  const text = [
    `New beta request #${number}: ${email}`,
    hint,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Hit Reply to answer them directly.",
  ].join("\n");

  return {
    from: env.FROM_NOTIFY,
    to: [env.NOTIFY_TO],
    reply_to: email,
    subject: `Beta request #${number}: ${email}`,
    html,
    text,
  };
}
