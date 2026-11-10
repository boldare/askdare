# Release checklist

For maintainers: everything to check before and after a release, in order. Copy it into the release pull request and tick it there. How releases work is in [CONTRIBUTING.md](CONTRIBUTING.md#releasing) and the `release` skill.

## 1. Code

- [ ] Every change is on `main` (or the integration branch, such as `release/0.2`), merged with `--no-ff`. No unmerged branches belong to this release.
- [ ] Every change to a published package has a changeset (`.changeset/*.md`), with the right bump (ADR-0006: minor for features and anything breaking before 1.0, patch for fixes only) and a summary written for users.
- [ ] A changed public API is on purpose: the snapshot (`packages/askdare/api/askdare.api.txt`) is updated, and ADR-0006 lists every new export.
- [ ] Security-relevant work had `/security-review` and `/code-review`, and their findings are fixed or written down.
- [ ] Locally, on the commit that will be released: `pnpm check`, `pnpm e2e`, `pnpm e2e:browsers`, `pnpm test:visual` and `pnpm verify:packs`.
- [ ] CI is green on that commit: both Node versions, end-to-end in three browsers, published types on every TypeScript version, CodeQL and the secret scan.
- [ ] The dry run gives the versions you expect: in a throwaway worktree, `pnpm changeset version`, then read the `version` of each `packages/*/package.json`.

## 2. By hand

From [Support](docs/support.md): what the tests can't cover.

- [ ] The [15-minute test](docs/getting-started.md): a fresh `create-next-app`, `npm install @boldare/askdare@<version> zod`, `npx @boldare/askdare init`, a first answer.
- [ ] The demo at `http://localhost:3000`: the widget (`/`), the chat inside a page (`/inline`), your own markup (`/inline/headless`), both Tailwind resets, ratings with a comment, attachments and dictation.
- [ ] Safari on iOS, and dictation in Safari.
- [ ] VoiceOver (macOS, Safari or Chrome) and NVDA (Windows, Chrome or Firefox): the message field, an answer read once it is complete, 👍/👎 with their pressed state, the question before a new conversation.
- [ ] The look, reviewed by a designer when it changed.

## 3. Documentation

- [ ] `README.md`: the install command fits the release (`@rc` during release candidates, plain once it is `latest`), and the features, documentation list and packages table cover what is new.
- [ ] Each package's `README.md` (`packages/askdare`, `packages/askdare-upstash`, `packages/askdare-otel`).
- [ ] `docs/`: every new feature has a guide or a section, `configuration.md` lists every new option, `cli.md` every command, `styling.md` every new part, `texts.md` every new text key, and `privacy.md` everything new the chat stores or sends.
- [ ] Nothing describes features of a later version as available, and nothing says "to come".
- [ ] `llms.txt` and `skills/askdare/SKILL.md` know the new features.
- [ ] `docs/adr/README.md` lists every ADR with its current status; `THREAT_MODEL.md` covers new threats.
- [ ] `examples/starter` is still exactly what `init` writes.

## 4. Website

- [ ] The home page (`site/app/page.tsx`) shows what is new, and the docs navigation (`site/app/docs/_lib/content.ts`) lists every new guide.
- [ ] Locally, every page renders without console errors, including `/docs` and its search.
- [ ] After the merge into `main`, the deployment (`.github/workflows/deploy-site.yml`) succeeds, and the chat answers on https://askdare.vercel.app.
- [ ] Vercel's environment has what new features need (keep only `OPENAI_API_KEY` and `CHAT_SECRET` as Secret).

## 5. GitHub

- [ ] The repository's description, website and topics still fit.
- [ ] The `main` ruleset requires the checks CI runs now: a renamed or new job must be added there, or merging blocks.
- [ ] The `npm` environment: only `main` may deploy, and it holds `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`.
- [ ] Variables: `NPM_TRUSTED_PUBLISHING=true`, and `NPM_RELEASE_MODE` set to what you intend (`publish` or `stage`).
- [ ] Security: Dependabot alerts and private vulnerability reporting stay on. Secret scanning and push protection are worth turning on (Settings → Code security).
- [ ] The release pull request's description is current, and the issues it resolves are linked.

## 6. npm

- [ ] A package's first release: it doesn't exist on npm yet, so trusted publishing can't create it. Publish its first version by hand with 2FA, then add the trusted publisher (repository `boldare/askdare`, workflow `release.yml`, environment `npm`) with "Allow npm publish".
- [ ] Each existing package's trusted publisher allows `npm publish` when `NPM_RELEASE_MODE=publish`.
- [ ] After "Version packages" merges: each version is on npm with provenance, under the right dist-tag (`rc` for a release candidate, `latest` for a release), and its README shows on the package page.
- [ ] `npm install @boldare/askdare@<version>` works in a fresh app.

## 7. Versions

- [ ] **A release (such as 0.1.0):** a pull request with only `pnpm changeset pre exit`, then the "Version packages" pull request. In the same release, `README.md` drops `@rc` from the install command and the npm badge.
- [ ] **The next release candidates (such as 0.2.0-rc.0):** only after the release before them is out. Merge the integration branch into `main`, then run `pnpm changeset pre enter rc` in a pull request of its own. Without it, Changesets numbers the work as another release candidate of the previous version.
- [ ] `@boldare/openai-assistant` stays deprecated on npm with its pointer to the migration guide (`npm view @boldare/openai-assistant deprecated`).

## 8. After the release

- [ ] The GitHub release exists, with the changelog.
- [ ] The website shows the new version's documentation.
- [ ] Merged branches are deleted, locally and on GitHub, and the integration pull request is closed.
- [ ] The news is shared where users will see it.
