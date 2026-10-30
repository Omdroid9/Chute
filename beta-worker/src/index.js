// Receives the beta form on usechute.com. Each new signup is saved to KV,
// emailed to us (Reply-To: the visitor) and answered with "You're on the
// list". Emails go out through Resend as usechute.com.

import { confirmationEmail, notificationEmail, platformOf } from "./emails.js";

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
    const known = origin !== null && allowed.includes(origin);
    const cors = known ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    const reply = (status, body) => respond(request, env, cors, status, body);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (request.method !== "POST") return reply(405, { ok: false, error: "Use POST" });
    if (!known) return reply(403, { ok: false, error: "Unknown origin" });

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (env.SIGNUP_LIMIT) {
      const { success } = await env.SIGNUP_LIMIT.limit({ key: ip });
      if (!success) return reply(429, { ok: false, error: "Too many tries. Wait a minute and send again." });
    }

    let fields;
    try {
      fields = (request.headers.get("Content-Type") ?? "").includes("application/json")
        ? await request.json()
        : Object.fromEntries(await request.formData());
    } catch {
      return reply(400, { ok: false, error: "Could not read the form" });
    }
    // Honeypot: people never see this field, bots fill it. Pretend it worked.
    if (fields._gotcha) return reply(200, { ok: true });

    const email = String(fields.email ?? "").trim();
    if (email.length > 254 || !EMAIL_OK.test(email)) {
      return reply(422, { ok: false, error: "That doesn't look like an email address" });
    }

    // One signup per address: a repeat gets a friendly answer and no emails,
    // so the form can't be used to flood someone's inbox.
    const key = `signup:${email.toLowerCase()}`;
    if (await env.SIGNUPS.get(key)) return reply(200, { ok: true, already: true });

    const ua = request.headers.get("User-Agent") ?? "";
    const signup = {
      email,
      number: Number((await env.SIGNUPS.get("count")) ?? 0) + 1,
      at: new Date().toISOString(),
      // The installer they picked on the form, and the device they used.
      wants: { mac: "Mac", windows: "Windows" }[String(fields.platform ?? "").toLowerCase()] ?? null,
      platform: platformOf(ua),
      city: request.cf?.city ?? null,
      country: request.cf?.country ?? null,
      page: request.headers.get("Referer"),
    };

    // Our notification must go out before the signup counts: if it can't,
    // the visitor sees an error and can try again or write to us.
    try {
      await send(env, notificationEmail(signup, env));
    } catch (err) {
      console.error("notification failed", err);
      return reply(502, { ok: false, error: "Could not send right now" });
    }
    await env.SIGNUPS.put(key, JSON.stringify({ ...signup, ua }));
    await env.SIGNUPS.put("count", String(signup.number));
    ctx.waitUntil(
      send(env, confirmationEmail(signup, env)).catch((err) => console.error("confirmation failed", err)),
    );
    return reply(200, { ok: true });
  },
};

async function send(env, message) {
  if (env.DRY_RUN === "1") {
    console.log(`[dry run] "${message.subject}" → ${message.to.join(", ")}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// The site posts with fetch and reads JSON. Without JS the browser posts the
// form itself, so send that visitor back to the site instead of raw JSON.
function respond(request, env, cors, status, body) {
  const wantsJson = (request.headers.get("Accept") ?? "").includes("application/json");
  if (request.method === "POST" && !wantsJson) {
    const back = new URL("/", env.SITE_URL);
    back.searchParams.set("beta", body.ok ? "thanks" : "error");
    back.hash = "download";
    return Response.redirect(back.toString(), 303);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
