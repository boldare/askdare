# Security policy

chatdock exposes a public, anonymous chat endpoint that spends money on your OpenAI account. We take vulnerabilities in it seriously.

## Supported versions

During 0.x only the latest minor release receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue.** Report vulnerabilities privately through GitHub's private vulnerability reporting: open the **Security** tab of this repository, then **Report a vulnerability**.

Please include:
- the affected version and configuration;
- steps to reproduce, or a proof of concept;
- the impact you expect (for example, cost abuse, data exposure, XSS).

We aim to acknowledge reports within 3 working days and to agree on a disclosure timeline with you.

## Scope

In scope:
- authentication and session tokens;
- conversation ownership;
- rate limits and spend budgets;
- the embed handshake (`postMessage`, `frame-ancestors`);
- rendering of model output (XSS);
- upload validation;
- leakage of server configuration to the client.

Prompt injection that causes **only** off-topic answers is a known limitation of LLMs and is out of scope. Prompt injection that triggers tool misuse, data exposure or cost amplification is in scope.

## Hardening your deployment

The threat model and the checklist to complete before any public deployment are in [ADR-0004](docs/adr/0004-threat-model.md).
