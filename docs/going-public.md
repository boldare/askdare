# Going public: deployment checklist

Complete every step before the chat is reachable from the internet, demos included. The reasoning is in [THREAT_MODEL.md](../THREAT_MODEL.md).

## 1. OpenAI project

1. Create a **dedicated project** for this deployment in the OpenAI dashboard. Don't reuse a project that other apps use.
2. Create a **restricted API key** with only the permissions askdare needs: Responses API (write), conversations (write) and List models (read); add Vector Stores (read) for a knowledge base, Files (write) for attachments and Model capabilities (request) for voice input. `npx @boldare/askdare doctor` tells you which one is missing.
3. Set an **allowlist of models** to the one your bot uses.
4. Set a **monthly budget with "Enforce a hard limit"** and email alerts at 50% and 80%. Send a test alert.

## 2. Secrets and environment

```bash
openssl rand -base64 32   # use the output as CHAT_SECRET
```

| Variable | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes | The restricted key from step 1 |
| `CHAT_SECRET` | yes | At least 32 random characters. Never commit it. |
| `CHAT_SECRET_PREVIOUS` | during rotation | Comma-separated former secrets |
| `IDENTITY_SECRET` | for signed-in visitors | Shared with your site's backend only; never in a page or in git |
| `ASKDARE_DISABLED` | no | Set `true` to switch every bot off immediately |

**To rotate the secret:**
1. Move the current secret to `CHAT_SECRET_PREVIOUS` and set a new `CHAT_SECRET`.
2. After 30 days, when the last resume tokens expire, remove the old secret.

## 3. Bot configuration

- **`security.allowedOrigins`:** the exact sites allowed to embed the widget, such as `https://www.example.com`. No paths and no wildcards. The app's own origin is always allowed.
- **`limits`:** start with the defaults and tune `dailyTokens` (per bot) and `dailyTokensPerIp` to your budget. Add `limits: { globalDailyTokens }` to `createChatHandler` to cap all bots together. These budgets are the main cost control; the OpenAI hard limit is the backstop.
- **Instructions:** they must contain **no secrets**. Assume visitors can make the model reveal them.

## 4. Rate limits across instances

The default counters live in memory and work per instance. If more than one instance serves traffic (Vercel, several Heroku dynos, autoscaling), use a shared store:

```ts
import { upstashStore } from '@boldare/askdare-upstash';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  limits: { store: upstashStore() }, // UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
});
```

**Client IP:**
- The client IP comes from proxy headers. The default `trustProxy: 'auto'` detects Vercel and assumes one proxy otherwise, which matches Heroku.
- Behind additional proxies (a CDN in front of Heroku, for example), set `trustProxy` to the number of proxies.
- **Never expose `next start` directly to the internet.** Without a proxy that sets `X-Forwarded-For`, clients choose their own IP and per-IP limits stop working.

## 5. Hosting

- **Vercel:** keep `export const maxDuration = 300` in the route file, and keep each bot's `limits.turnTimeoutMs` below it.
- **Heroku:**
  - Use `web: next start --port $PORT --keepAliveTimeout 95000` in the `Procfile`.
  - Streaming already sends a first byte immediately and heartbeats every 15 s, which satisfies Heroku's 30 s and 55 s router rules.
- **Behind nginx or another proxy:** don't buffer `text/event-stream` responses. askdare sends `X-Accel-Buffering: no`.

## 6. Privacy and transparency

- **Retention:**
  - Conversations are stored by OpenAI until they are deleted (ADR-0003).
  - Decide on and document a retention policy.
  - Clients with data-residency or zero-retention requirements need the planned own-storage add-on.
- **Disclosures:**
  - Publish a privacy notice that names OpenAI (and Upstash, if used) as processors.
  - Tell visitors they are talking to an AI. The chat says so under the message field by default; add `widget.disclosure.privacyUrl` to link your privacy notice ([Styling](styling.md#1-configuration)).

## 7. Final check

- [ ] Restricted key, model allowlist and a hard spend limit, with a tested alert.
- [ ] `CHAT_SECRET` is random, at least 32 characters, and not in git.
- [ ] `allowedOrigins` lists only your sites.
- [ ] Shared store configured if you run more than one instance.
- [ ] Instructions contain no secrets.
- [ ] Privacy notice, retention decision and AI disclosure are in place.
- [ ] You know how to flip `ASKDARE_DISABLED=true`.
- [ ] `npx @boldare/askdare doctor --url <your app> --env-file <production env>` reports no problems ([Deployment](deployment.md)).
