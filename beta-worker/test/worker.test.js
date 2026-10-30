import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const SITE = "https://usechute.com";
let env, sent, pending, realFetch, resendStatus;

beforeEach(() => {
  const kv = new Map();
  env = {
    SITE_URL: SITE,
    ALLOWED_ORIGINS: `${SITE}, http://localhost:5183`,
    NOTIFY_TO: "hello@usechute.com",
    FROM_CONFIRM: "Omkar at Chute <hello@usechute.com>",
    FROM_NOTIFY: "Chute beta <beta@usechute.com>",
    TIMEZONE: "America/Los_Angeles",
    RESEND_API_KEY: "test-key",
    SIGNUPS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), _map: kv },
    SIGNUP_LIMIT: { limit: async () => ({ success: true }) },
  };
  sent = [];
  pending = [];
  resendStatus = 200;
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    sent.push(JSON.parse(init.body));
    return new Response(resendStatus === 200 ? '{"id":"x"}' : '{"message":"nope"}', { status: resendStatus });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const ctx = { waitUntil: (p) => pending.push(p) };

function post(fields, { origin = SITE, accept = "application/json", ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const headers = { Accept: accept, "User-Agent": ua, Referer: `${SITE}/` };
  if (origin) headers.Origin = origin;
  const req = new Request("https://chute-beta.example.workers.dev/", { method: "POST", headers, body });
  Object.defineProperty(req, "cf", { value: { city: "Stockton", country: "US" } });
  return worker.fetch(req, env, ctx).then(async (res) => {
    await Promise.all(pending);
    return res;
  });
}

test("answers the CORS preflight for the site only", async () => {
  const ok = await worker.fetch(new Request("https://w/", { method: "OPTIONS", headers: { Origin: SITE } }), env, ctx);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), SITE);
  const other = await worker.fetch(new Request("https://w/", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env, ctx);
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), null);
});

test("refuses posts from other sites", async () => {
  const res = await post({ email: "a@b.co" }, { origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
});

test("a new signup notifies us, confirms to them, and is saved", async () => {
  const res = await post({ email: "  Jane@Example.com ", subject: "Chute beta: count me in", _gotcha: "" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const [notify, confirm] = sent;
  assert.deepEqual(notify.to, ["hello@usechute.com"]);
  assert.equal(notify.reply_to, "Jane@Example.com");
  assert.equal(notify.subject, "Beta request #1: Jane@Example.com");
  assert.match(notify.html, /Send the Mac installer/);
  assert.match(notify.html, /Stockton, United States/);
  assert.deepEqual(confirm.to, ["Jane@Example.com"]);
  assert.equal(confirm.subject, "You're on the Chute beta list");
  assert.match(confirm.text, /Mac or Windows\?/);

  const saved = JSON.parse(env.SIGNUPS._map.get("signup:jane@example.com"));
  assert.equal(saved.number, 1);
  assert.equal(saved.platform, "Mac");
  assert.equal(env.SIGNUPS._map.get("count"), "1");
});

test("a repeat signup gets a friendly answer and no emails", async () => {
  await post({ email: "jane@example.com" });
  sent.length = 0;
  const res = await post({ email: "JANE@example.com" });
  assert.deepEqual(await res.json(), { ok: true, already: true });
  assert.equal(sent.length, 0);
});

test("the honeypot pretends to succeed and does nothing", async () => {
  const res = await post({ email: "bot@spam.co", _gotcha: "http://spam" });
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 0);
  assert.equal(env.SIGNUPS._map.size, 0);
});

test("rejects something that isn't an email", async () => {
  const res = await post({ email: "nope" });
  assert.equal(res.status, 422);
  assert.equal(sent.length, 0);
});

test("if our notification can't go out, the signup isn't counted", async () => {
  resendStatus = 500;
  const res = await post({ email: "jane@example.com" });
  assert.equal(res.status, 502);
  assert.equal(env.SIGNUPS._map.size, 0);
});

test("rate limited visitors are told to wait", async () => {
  env.SIGNUP_LIMIT.limit = async () => ({ success: false });
  const res = await post({ email: "jane@example.com" });
  assert.equal(res.status, 429);
});

test("escapes what visitors type", async () => {
  await post({ email: "<b>x</b>@evil.co" });
  assert.doesNotMatch(sent[0].html, /<b>x<\/b>/);
  assert.match(sent[0].html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("without JS the browser is sent back to the site", async () => {
  const res = await post({ email: "jane@example.com" }, { accept: "text/html" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), `${SITE}/?beta=thanks#download`);
});

test("phone signups ask which computer they use", async () => {
  await post({ email: "p@example.com" }, { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
  assert.match(sent[0].html, /They signed up on iPhone/);
});
