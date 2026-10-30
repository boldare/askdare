# @boldare/askdare-upstash

## 0.1.0-rc.0

### Minor Changes

- da333a2: First release: rate limits and budgets for `@boldare/askdare` shared across server instances, in Upstash Redis. Use it on Vercel or with several dynos: `limits: { store: upstashStore() }` in `createChatHandler`. It reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN` from the Vercel Marketplace, and takes a key prefix to share one database between apps.

### Patch Changes

- Updated dependencies [da333a2]
- Updated dependencies [ef92f7a]
  - @boldare/askdare@0.1.0-rc.0
