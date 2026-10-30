// Writes both emails, filled with sample data, as HTML files to look at.
// Usage: node scripts/preview.js <out-dir> [site-url]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { confirmationEmail, notificationEmail } from "../src/emails.js";

const [out = "email-preview", site = "https://usechute.com"] = process.argv.slice(2);
const env = {
  SITE_URL: site,
  TIMEZONE: "America/Los_Angeles",
  NOTIFY_TO: "hello@usechute.com",
  FROM_CONFIRM: "Omkar at Chute <hello@usechute.com>",
  FROM_NOTIFY: "Chute beta <beta@usechute.com>",
};
const signup = {
  email: "jane.cooper@gmail.com",
  number: 12,
  wants: "Mac",
  at: new Date().toISOString(),
  platform: "Mac",
  city: "San Francisco",
  country: "US",
  page: "https://usechute.com/",
};

// Inline the logo so the previews open anywhere, before the site is deployed.
const logo = readFileSync(new URL("../../website/public/email/chute-sphere.png", import.meta.url)).toString("base64");
const inline = (html) => html.replaceAll(`${site}/email/chute-sphere.png`, `data:image/png;base64,${logo}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "confirmation.html"), inline(confirmationEmail(signup, env).html));
writeFileSync(join(out, "notification.html"), inline(notificationEmail(signup, env).html));
console.log(`Wrote ${join(out, "confirmation.html")} and ${join(out, "notification.html")}`);
