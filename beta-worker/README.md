# chute-beta

Cloudflare Worker behind the beta form on usechute.com. For each new signup it:

1. emails a notification to `NOTIFY_TO`, with the visitor as Reply-To, so answering with the installer is a plain reply;
2. saves the signup in the `SIGNUPS` KV namespace (`signup:<email>`, plus a running `count`);
3. sends the visitor a "You're on the list" email from `FROM_CONFIRM`.

Emails go out through [Resend](https://resend.com) as usechute.com. A repeat address gets `{ ok: true, already: true }` and no emails, each IP gets five tries a minute, and a hidden `_gotcha` field catches bots.

## Commands

```bash
npm test                    # unit tests (node:test, no network)
npm run preview -- out-dir  # write both emails as HTML, with sample data
npx wrangler deploy         # publish (after `npx wrangler login`)
```

## One-time setup

1. **Resend:** add the domain `usechute.com` and put the DNS records it lists into GoDaddy. They live on `send.usechute.com` and `resend._domainkey`, so the Zoho mail records stay untouched. Then create an API key with sending access.
2. **Cloudflare:** `npx wrangler login`, then `npx wrangler deploy`. The first deploy creates the KV namespace.
3. **Secret:** `npx wrangler secret put RESEND_API_KEY`, then paste the key when prompted.
4. Point the site's form `action` at the Worker's URL.

Settings that aren't secret (addresses, allowed origins, time zone) are in `wrangler.toml`. For local `wrangler dev`, `.dev.vars` sets `DRY_RUN=1` so emails are logged instead of sent.
