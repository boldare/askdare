## What and why

<!-- What this changes, for whom, and the issue it closes. -->

## Checklist

- [ ] `pnpm check` passes (and `pnpm e2e` for widget, loader or site changes).
- [ ] A changeset (`pnpm changeset`) for any change to a published package.
- [ ] The docs in `docs/` match the change; a new guide is listed in `llms.txt` and the site's sidebar.
- [ ] A change to the public API is intended, explained in the changeset and in `packages/askdare/api/askdare.api.txt` (ADR-0006).
- [ ] An expensive-to-reverse decision has an ADR (`docs/adr/`).
- [ ] No secrets, keys or message contents in code, fixtures, logs or screenshots.
