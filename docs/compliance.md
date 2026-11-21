# Compliance

This page lists what the law asks of a chatbot on a public website, what askdare does about each point, and which decisions stay with you. It names the laws and cites them, but **it isn't legal advice**. Whether a rule applies to you, and whether askdare's defaults are enough, depends on your role, your site and your users. Check with your legal advisers.

Legal texts and OpenAI's terms were checked on 2026-11-21 against the sources at the [end of this page](#sources). Both change: check the sources again before you rely on a date or a limit.

## At a glance

| Topic | What askdare does | What you decide |
| --- | --- | --- |
| [Telling visitors they talk to an AI](#1-telling-visitors-they-talk-to-an-ai) (AI Act, art. 50(1)) | A note under the message field, on by default | Keep it, word it, or turn it off when your page already says so |
| [Personal data](#2-personal-data-gdpr) (GDPR) | Stores nothing on your server but rate-limit counters; sends a pseudonym, not an identity, to OpenAI; lets visitors delete their conversation | Your privacy notice, the DPA with OpenAI, a retention policy for conversations |
| [Data residency](#3-data-residency) | Uses OpenAI's global endpoints | Whether OpenAI's regional options are enough, or you wait for own storage (0.6) |
| [The conversation handle in the browser](#4-the-conversation-handle-in-the-browser) | Keeps it in the widget's iframe | Whether to show the chat inside your own pages |
| [Accessibility](#5-accessibility) (European Accessibility Act) | Targets WCAG 2.2 AA | Your site's own conformance |
| [Moderation and guardrails](#6-moderation-and-guardrails) | Opt-in OpenAI moderation, hooks to block or redact messages and answers, untrusted tool results | Which of them your bot needs, and what blocked visitors see |
| [Bot protection](#7-bot-protection) | Coming in 0.5 | |
| [Hosting](#8-hosting-outside-vercel-and-heroku) | Supports the Node.js runtime only | Where it runs, and that host's logs |

## 1. Telling visitors they talk to an AI

**The rule.** Under Article 50(1) of the AI Act, AI systems that interact directly with people must be designed so that those people are informed they are interacting with an AI system, unless that is obvious to a reasonably well-informed person in the context. Article 50(5) says the information must be clear and distinguishable, given at the latest at the first interaction, and accessible. Article 50 applies from 2 August 2026 (Article 113). The Digital Omnibus on AI, Regulation (EU) 2026/1744, moved the high-risk rules to 2 December 2027 and 2 August 2028; it didn't change Article 50(1) or its date.

The duty in Article 50(1) is the provider's: whoever develops the system, or has it developed, and puts it into service under its own name. When you put a bot on your site with your instructions, your legal advisers will tell you whether that is you.

**What askdare does.** By default, the chat shows "You’re chatting with an AI assistant. It can make mistakes." under the message field, before the visitor writes anything.

```ts
defineBot({
  // …
  widget: {
    disclosure: { privacyUrl: '/privacy' }, // adds a "Privacy policy" link
  },
});
```

- You can change the wording with `widget.texts` (`disclosure.text`, `disclosure.privacy`). See [Styling](styling.md#1-configuration) and [Texts](texts.md).
- `disclosure: false` hides it. Do that only when your page already tells visitors they are talking to an AI.
- **If you build your own markup** with the primitives of `@boldare/askdare/react` ([React](react.md#your-own-markup)), or show your own page in the widget's iframe ([Embedding](embedding.md#your-own-page-in-the-iframe)), the note is yours to render. In 0.5, a `Disclosure` primitive, a warning in development when it is missing and a `doctor` warning for `disclosure: false` make sure it isn't dropped by accident.

**Marking of generated content.** Article 50(2) asks providers of systems that generate synthetic text, images, audio or video to mark the outputs in a machine-readable format. askdare doesn't add such marks to answers. Systems on the market before 2 August 2026 have until 2 December 2026 (Article 111(4), added by the Digital Omnibus). Whether Article 50(2) covers a chat's answers, and who carries it, is a question for your legal advisers; the codes of practice under Article 50(7) are where the practice is being worked out.

## 2. Personal data (GDPR)

[Privacy](privacy.md) lists every piece of data the chat handles, where it goes and how long it stays. This section covers the decisions it leaves to you.

### Roles and the DPA

- For the chat on your site, you decide why and how visitors' data is processed, so you are usually the controller. OpenAI processes it on your behalf, as a processor (GDPR, Article 28).
- OpenAI's [Data Processing Addendum](https://openai.com/policies/data-processing-addendum/) covers API customers. For customers in the EEA or Switzerland the contracting party is OpenAI Ireland Ltd. Transfers out of the EEA rely on the EU standard contractual clauses or an adequacy decision (Articles 45 and 46). Make sure it applies to the OpenAI organization whose key the app uses.
- Upstash, if you use `@boldare/askdare-upstash`, and your hosting provider process data too. See [Subprocessors](privacy.md#subprocessors).

### Retention and deletion

Storage limitation (Article 5(1)(e)) means keeping data no longer than you need it. Here is what lasts how long:

| What | Kept | How it ends |
| --- | --- | --- |
| Conversations (messages, answers, page context, tool calls and results) | Until deleted | The visitor's "Start a new conversation", which deletes it at OpenAI. Nothing else deletes it |
| Stored model responses | 30 days by default, according to OpenAI | OpenAI deletes them |
| Abuse-monitoring logs at OpenAI | Up to 30 days, longer where the law requires it | OpenAI deletes them |
| Uploaded images and PDFs | 30 days | They expire, or are deleted with their conversation |
| Rate-limit counters with IP addresses | Up to 2 days | They expire |

- **Conversations outlive the browser's handle.** When the handle expires after 30 days, or the visitor clears the browser, the conversation stays in your OpenAI project. askdare keeps no list of conversations, and OpenAI's API can't list them, so askdare has no tool to find or delete one person's conversation later (right to erasure, Article 17). Decide how you will answer such a request, and say in your notice how visitors delete a conversation themselves.
- **Zero Data Retention isn't available.** OpenAI lists the Conversations API as not eligible, and askdare needs it ([ADR-0003](adr/0003-conversation-state.md)).
- Own storage, planned for 0.6, will let you keep conversations in your database and set their retention yourself.

### `safety_identifier`

Every model request carries a `safety_identifier`, which OpenAI uses to trace abuse to one end user instead of your whole project. It is an HMAC of the random visitor ID, or of your user ID for a [signed-in visitor](identity.md), keyed with a secret derived from `CHAT_SECRET`. It holds no name, email or IP address. It is still a pseudonym, not anonymous data: with the secret, it can be linked back. See [Privacy](privacy.md#safety_identifier).

### Your privacy notice

Visitors must be told who processes their data, for what, and for how long (Article 13). Work through [the checklist in Privacy](privacy.md#for-your-privacy-notice), and link the notice from the AI note with `widget.disclosure.privacyUrl`.

### Storage in the visitor's browser

The chat writes one `localStorage` entry after the visitor's first message, and a second one when they rate an answer. It sets no cookies. Whether these need consent under Article 5(3) of the ePrivacy Directive, which exempts storage strictly necessary for a service the user asked for, is your call: [Consent banners](privacy.md#consent-banners) lists the facts that matter.

## 3. Data residency

OpenAI offers [data residency](https://developers.openai.com/api/docs/guides/data-residency) per project, in several regions, Europe (EEA and Switzerland) among them:

- It is available to eligible organizations after contacting OpenAI's sales team. A project's region is chosen when the project is created and can't be changed later.
- Requests go to a regional domain, such as `eu.api.openai.com`.
- Models released on or after 5 March 2026 cost 10% more on data residency endpoints.
- It covers Customer Content at rest for the endpoints OpenAI lists, and processing where the region supports it. System data, such as account and usage data, may still be stored and processed elsewhere.

**What that means for askdare.** askdare stores conversations with OpenAI's Conversations API (`/v1/conversations`), and OpenAI's list of endpoints eligible for data residency doesn't include it. A residency project therefore doesn't keep askdare's conversations in your region. askdare also uses OpenAI's global endpoint and isn't tested against regional ones.

If you need conversations stored in a given region, wait for own storage in 0.6: conversations kept in your own database, with only model requests going to OpenAI. The [roadmap](https://github.com/boldare/askdare/blob/main/ROADMAP.md) has the details.

## 4. The conversation handle in the browser

To show a conversation again after a reload, the chat keeps a resume token in `localStorage`. It is encrypted, the browser can't read what's inside, and it works for 30 days after the last answer. Whoever holds it can continue that conversation and see its history. A signed-in visitor's conversation also needs that user's identity token.

Where it sits decides who can read it:

| How the chat is shown | Where the token sits | Who else can read it |
| --- | --- | --- |
| The script-tag widget, and your own page in its iframe | The iframe's storage, on your askdare app's origin | No script of the host site: the browser keeps origins apart, and the iframe's strict Content Security Policy keeps foreign scripts out of the chat |
| The chat inside your page (`Root`, `DefaultChat` from `@boldare/askdare/react`) | Your page's own storage, next to your other entries | Every script on that page, including an XSS on your app, tag managers and third-party tags. It can also read the conversation on screen and, for signed-in visitors, the identity token in the page |

An attacker who copies the token can continue the conversation from anywhere and read it, until the token expires or the visitor starts a new conversation. This is the trade-off of a chat inside your page: no iframe between your page's scripts and the chat. It is in the [threat model](https://github.com/boldare/askdare/blob/main/THREAT_MODEL.md) as T3 and T23.

- On pages that run scripts you don't fully trust (ads, tag managers with third-party tags), use the widget.
- Give pages with the chat inside them a strict Content Security Policy ([React](react.md#content-security-policy)).
- If you suspect a leak, rotate `CHAT_SECRET` without `CHAT_SECRET_PREVIOUS`: every resume token stops working at once, and visitors start new conversations ([Rotating secrets](privacy.md#rotating-secrets)).
- Mention the entry in your privacy notice either way.

## 5. Accessibility

The [European Accessibility Act](https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng) (Directive (EU) 2019/882) applies from 28 June 2025. Among other services, it covers e-commerce services offered to consumers; microenterprises that provide services are exempt (Article 4(5)). The harmonised standard, ETSI EN 301 549, moved to WCAG 2.2 in version V4.1.1 (2026-09).

askdare's widget and default skin target WCAG 2.2 AA, and every release runs axe in Chromium, Firefox and WebKit ([Support](support.md)). A dated conformance statement, with its scope, method and known limitations, is coming in 0.5 as `docs/accessibility.md`. If you build your own markup or restyle the chat, its accessibility is yours to check.

## 6. Moderation and guardrails

OpenAI's own safety systems apply to every bot. On top of them, askdare offers three server-side controls, all off by default ([ADR-0019](adr/0019-compliance-and-guardrails.md)):
- **`moderation`:** OpenAI moderation of visitors' messages, of answers, or both, with the categories that block and the text visitors see as options.
- **`onInput` and `onOutput`:** your own rules, which allow, block or redact a message before the model sees it, or an answer before the visitor does. While answers are checked, they are held back until complete, so a blocked one never reaches the browser.
- **`toolResults: 'untrusted'`:** tool results reach the model marked as third-party data, which hardens tools that return text from outside your control against prompt injection.

A blocked turn ends with the `content_blocked` error, and nothing blocked or redacted is logged as content. Which controls a bot needs, and how strict they are, is your decision: see [Guardrails](guardrails.md).

## 7. Bot protection

Coming in 0.5: an optional human check with Cloudflare Turnstile when a chat session starts ([ADR-0019](adr/0019-compliance-and-guardrails.md)). Until then, the rate limits and daily token budgets bound what an abuser can spend ([Going public](going-public.md#3-bot-configuration), [Costs](costs.md)).

## 8. Hosting outside Vercel and Heroku

askdare is tested on Vercel and Heroku. Other hosts that run a Next.js app on Node.js should work, but aren't tested ([Support](support.md)). Whatever the host, it receives every request, with the visitor's IP address, and keeps logs by its own settings: name it in your privacy notice.

**What the host has to provide:**

- **The Node.js runtime,** Node.js 22 or 24.
- **Streaming without buffering.** Answers arrive as `text/event-stream`; a proxy that buffers them delivers each answer at once at the end. askdare sends `X-Accel-Buffering: no` for nginx.
- **Long requests.** An answer can take up to the bot's `limits.turnTimeoutMs`, 120 seconds by default. The host and every proxy in front of it must keep the connection open that long. askdare sends a byte every 15 seconds, so idle timeouts above that are enough.
- **A proxy that sets `X-Forwarded-For`.** Never expose `next start` directly to the internet: clients could then choose their own IP and per-IP limits stop working. Set `limits.trustProxy` to the number of proxies in front of the app ([Deployment](deployment.md#behind-another-proxy-or-cdn)).
- **A shared store for limits** when more than one instance serves traffic ([Going public](going-public.md#4-rate-limits-across-instances)).

**Docker or a VM with `next start`.** Run `next build` and `next start` (or the standalone output) behind nginx, Caddy or a load balancer that sets `X-Forwarded-For` and doesn't buffer the stream. One container works with the default in-memory limits; with several, use a shared store.

**OpenNext.** On AWS Lambda, the function must run on Node.js with response streaming on, and with a timeout longer than `turnTimeoutMs`, at every layer in front of it as well. Every concurrent Lambda instance has its own memory, so use a shared store. The Cloudflare adapter runs the app on Workers, which isn't Node.js: it isn't supported.

**Edge runtimes won't work.** askdare supports only the Node.js runtime. Don't set `export const runtime = 'edge'` on the chat route, and don't deploy it to a platform that runs only edge or worker functions.

## Sources

- AI Act: [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng), Articles 3(3), 50, 111 and 113; [consolidated text of 27 July 2026](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727).
- Digital Omnibus on AI: [Regulation (EU) 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng), in force since 27 July 2026.
- GDPR: [Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), Articles 5, 13, 17, 28, 45 and 46.
- ePrivacy Directive: [Directive 2002/58/EC](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02002L0058-20091219), Article 5(3), as amended by Directive 2009/136/EC.
- European Accessibility Act: [Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng), Articles 2, 4(5) and 31.
- [ETSI EN 301 549 V4.1.1 (2026-09)](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf), Accessibility requirements for ICT products and services.
- OpenAI: [Data Processing Addendum](https://openai.com/policies/data-processing-addendum/), [Data controls](https://developers.openai.com/api/docs/guides/your-data), [Data residency](https://developers.openai.com/api/docs/guides/data-residency), [Safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices#implement-safety-identifiers).
