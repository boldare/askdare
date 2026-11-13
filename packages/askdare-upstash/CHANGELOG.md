# @boldare/askdare-upstash

## 0.1.2-rc.0

### Patch Changes

- Updated dependencies [9cb8282]
- Updated dependencies [bca8d48]
- Updated dependencies [9fed4d3]
- Updated dependencies [35ee326]
- Updated dependencies [7357c6f]
  - @boldare/askdare@0.3.0-rc.0

## 0.1.1

### Patch Changes

- Updated dependencies [1a1659f]
- Updated dependencies [ac878e6]
- Updated dependencies [7c9fb36]
- Updated dependencies [66da550]
- Updated dependencies [c0c1a7f]
- Updated dependencies [9bd1b16]
- Updated dependencies [05076dc]
- Updated dependencies [d789913]
- Updated dependencies [45ef7de]
- Updated dependencies [48ddabf]
- Updated dependencies [9540d46]
- Updated dependencies [1c45e8a]
- Updated dependencies [8608d69]
- Updated dependencies [94a1e30]
- Updated dependencies [8d81c46]
- Updated dependencies [eb7b7aa]
  - @boldare/askdare@0.2.0

## 0.1.1-rc.0

### Patch Changes

- Updated dependencies [1a1659f]
- Updated dependencies [7c9fb36]
- Updated dependencies [9bd1b16]
- Updated dependencies [05076dc]
- Updated dependencies [45ef7de]
- Updated dependencies [48ddabf]
- Updated dependencies [94a1e30]
  - @boldare/askdare@0.2.0-rc.0

## 0.1.0

### Minor Changes

- da333a2: First release: rate limits and budgets for `@boldare/askdare` shared across server instances, in Upstash Redis. Use it on Vercel or with several dynos: `limits: { store: upstashStore() }` in `createChatHandler`. It reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN` from the Vercel Marketplace, and takes a key prefix to share one database between apps.

### Patch Changes

- f25bb19: Docs: a database from the Vercel Marketplace (Upstash for Redis) sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and one from the Upstash console has the `UPSTASH_REDIS_REST_*` names. The store reads both, as before.
- 68d94e6: The npm pages link to the website, https://askdare.vercel.app, with the docs and a live demo of every theme.
- Updated dependencies [da333a2]
- Updated dependencies [3bf0dd0]
- Updated dependencies [ef92f7a]
- Updated dependencies [13259d4]
- Updated dependencies [4b7512b]
- Updated dependencies [342a931]
- Updated dependencies [9d4a548]
- Updated dependencies [f25bb19]
- Updated dependencies [68d94e6]
- Updated dependencies [4b9cfed]
  - @boldare/askdare@0.1.0

## 0.1.0-rc.1

### Patch Changes

- f25bb19: Docs: a database from the Vercel Marketplace (Upstash for Redis) sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and one from the Upstash console has the `UPSTASH_REDIS_REST_*` names. The store reads both, as before.
- 68d94e6: The npm pages link to the website, https://askdare.vercel.app, with the docs and a live demo of every theme.
- Updated dependencies [f25bb19]
- Updated dependencies [68d94e6]
  - @boldare/askdare@0.1.0-rc.2

## 0.1.0-rc.0

### Minor Changes

- da333a2: First release: rate limits and budgets for `@boldare/askdare` shared across server instances, in Upstash Redis. Use it on Vercel or with several dynos: `limits: { store: upstashStore() }` in `createChatHandler`. It reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN` from the Vercel Marketplace, and takes a key prefix to share one database between apps.

### Patch Changes

- Updated dependencies [da333a2]
- Updated dependencies [ef92f7a]
  - @boldare/askdare@0.1.0-rc.0
