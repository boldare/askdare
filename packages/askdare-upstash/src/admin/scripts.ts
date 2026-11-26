/**
 * The admin store's Lua scripts. Each write, delete, sweep and read is one `EVAL`, so it is atomic
 * and one round trip. Every script starts with ARGV[1] = key prefix, ARGV[2] = now (epoch ms) and
 * ARGV[3] = the records' time to live in ms.
 *
 * Keys, under the prefix (`<p>`), with `<h>` the SHA-1 of a conversation ID, `<n>` a UTC day number
 * (days since 1970-01-01), `<src>` `chat` or `console` and `<bk>` the URI-encoded bot name. No key
 * name holds a conversation ID, a visitor or any content:
 * - `<p>c:<h>`: the conversation's summary (hash), kept at write time.
 * - `<p>c:<h>:t`: its turns, `at` → `input cachedInput cacheWrite output reasoning` (counters only).
 * - `<p>c:<h>:r`: its ratings, item ID → `at␟rating␟bk␟src␟row␟json`.
 * - `<p>c:<h>:x`: its transcripts, `at␟itemId` → JSON.
 * - `<p>rec`: conversations by their oldest record's time, for `sweep`.
 * - `<p>i:<src>:<n>:<t|l|d>[:<bk>]`: conversations by the day they started on, scored by tokens
 *   (`t`, negated), by latest activity (`l`, negated), or with a 👎 (`d`).
 * - `<p>q:<src>:<n>:<all|up|down>[:<bk>]`: ratings by day, scored by time (negated).
 * - `<p>d:<n>`: the day's daily rows (hash of counters, no conversation or visitor).
 * - `<p>days`: the days that have daily rows, for `sweep`.
 *
 * Conversation keys expire `ttl` after the conversation's latest record, and indexes no earlier
 * than their entries; daily rows 400 days after their day. Reads skip, and remove, index entries
 * whose conversation expired. `sweep` is the precise retention; the TTLs are the backstop.
 *
 * Strings in replies start with `~`, so a client that parses JSON in replies (`@upstash/redis` by
 * default) hands them back unchanged; numbers are integer replies.
 */

const PRELUDE = `
local P, NOW, TTL = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3])
local DAY = 86400000
local SEP = '\\31'
local MAXLAST = 9999999999999

local function dayOf(at) return tostring(math.floor(at / DAY)) end

-- The first n - 1 fields of s split at SEP, and the rest as the last one.
local function split(s, n)
  local parts, pos = {}, 1
  for _ = 1, n - 1 do
    local i = string.find(s, SEP, pos, true)
    if not i then return nil end
    parts[#parts + 1] = string.sub(s, pos, i - 1)
    pos = i + 1
  end
  parts[#parts + 1] = string.sub(s, pos)
  return parts
end

-- Moves a key's expiry to target, never earlier.
local function extend(key, target)
  local cur = redis.call('PTTL', key)
  if cur == -2 then return end
  if cur == -1 or NOW + cur < target then redis.call('PEXPIREAT', key, tostring(target)) end
end

local function convKeys(src, day, bk, o)
  local base = P .. 'i:' .. src .. ':' .. day .. ':' .. o
  return { base, base .. ':' .. bk }
end

local function ratingKeys(src, day, bk, rating)
  local base = P .. 'q:' .. src .. ':' .. day .. ':'
  return { base .. 'all', base .. 'all:' .. bk, base .. rating, base .. rating .. ':' .. bk }
end

local function unindexConversation(S)
  local meta = redis.call('HMGET', S, 'bk', 'src', 'm', 'd')
  if not meta[3] then return end
  for _, o in ipairs({ 't', 'l', 'd' }) do
    for _, k in ipairs(convKeys(meta[2], meta[4], meta[1], o)) do redis.call('ZREM', k, meta[3]) end
  end
  redis.call('HDEL', S, 'm', 'd')
end

local function unindexRating(h, item, p)
  for _, k in ipairs(ratingKeys(p[4], dayOf(tonumber(p[1])), p[3], p[2])) do
    redis.call('ZREM', k, h .. '|' .. item)
  end
end

local function drop(h)
  local S = P .. 'c:' .. h
  unindexConversation(S)
  local rv = redis.call('HGETALL', S .. ':r')
  for i = 1, #rv, 2 do
    local p = split(rv[i + 1], 6)
    if p then unindexRating(h, rv[i], p) end
  end
  redis.call('DEL', S, S .. ':t', S .. ':r', S .. ':x')
  redis.call('ZREM', P .. 'rec', h)
end

-- Recomputes the conversation's summary and index entries from its records.
local function refresh(h)
  local S = P .. 'c:' .. h
  local T, R, X = S .. ':t', S .. ':r', S .. ':x'
  local first, last, n = nil, nil, 0
  local function seen(at)
    n = n + 1
    if not first or at < first then first = at end
    if not last or at > last then last = at end
  end
  local turns, u = 0, { 0, 0, 0, 0, 0 }
  local tv = redis.call('HGETALL', T)
  for i = 1, #tv, 2 do
    seen(tonumber(tv[i]))
    turns = turns + 1
    local j = 1
    for x in string.gmatch(tv[i + 1], '%S+') do
      u[j] = u[j] + tonumber(x)
      j = j + 1
    end
  end
  local up, down, ratings = 0, 0, {}
  local rv = redis.call('HVALS', R)
  for i = 1, #rv do
    local p = split(rv[i], 6)
    if p then
      seen(tonumber(p[1]))
      if p[2] == 'up' then up = up + 1 else down = down + 1 end
      ratings[#ratings + 1] = p
    end
  end
  local tx = 0
  local xk = redis.call('HKEYS', X)
  for i = 1, #xk do
    local p = split(xk[i], 2)
    if p then
      seen(tonumber(p[1]))
      tx = tx + 1
    end
  end
  local target = n > 0 and last + TTL or 0
  if n == 0 or target <= NOW then
    drop(h)
    return
  end
  unindexConversation(S)
  local meta = redis.call('HMGET', S, 'bk', 'src')
  local bk, src = meta[1], meta[2]
  local ls = tostring(MAXLAST - last)
  local m = string.rep('0', 13 - #ls) .. ls .. '|' .. h
  local d = dayOf(first)
  redis.call('HSET', S, 'first', tostring(first), 'last', tostring(last), 'turns', turns,
    'i', u[1], 'ci', u[2], 'cw', u[3], 'o', u[4], 'r', u[5], 'up', up, 'down', down, 'tx', tx,
    'm', m, 'd', d)
  local function put(o, score)
    for _, k in ipairs(convKeys(src, d, bk, o)) do
      redis.call('ZADD', k, score, m)
      extend(k, target)
    end
  end
  put('t', -(u[1] + u[4]))
  put('l', -last)
  if down > 0 then put('d', 0) end
  for _, p in ipairs(ratings) do
    for _, k in ipairs(ratingKeys(p[4], dayOf(tonumber(p[1])), p[3], p[2])) do extend(k, target) end
  end
  redis.call('ZADD', P .. 'rec', tostring(first), h)
  for _, k in ipairs({ S, T, R, X }) do redis.call('PEXPIREAT', k, tostring(target)) end
end

-- The conversation's fixed fields, set by its first record.
local function init(S, id, bot, bk, visitor, src)
  redis.call('HSETNX', S, 'id', id)
  redis.call('HSETNX', S, 'bot', bot)
  redis.call('HSETNX', S, 'bk', bk)
  redis.call('HSETNX', S, 'vis', visitor)
  redis.call('HSETNX', S, 'src', src)
end

-- Adds to the day's rows: field and increment pairs from ARGV[from] on.
local function daily(day, target, from)
  local D = P .. 'd:' .. day
  if tonumber(target) <= NOW then return end
  for i = from, #ARGV, 2 do redis.call('HINCRBY', D, ARGV[i], ARGV[i + 1]) end
  redis.call('ZADD', P .. 'days', day, day)
  redis.call('PEXPIREAT', D, target)
end
`;

/** ARGV: h, id, bot, bk, visitor, src, at, usage, day, day expiry, then field/increment pairs. */
export const TURN_SCRIPT: string = `${PRELUDE}
local h = ARGV[4]
local S = P .. 'c:' .. h
if redis.call('HEXISTS', S .. ':t', ARGV[10]) == 1 then return 0 end
init(S, ARGV[5], ARGV[6], ARGV[7], ARGV[8], ARGV[9])
redis.call('HSET', S .. ':t', ARGV[10], ARGV[11])
daily(ARGV[12], ARGV[13], 14)
refresh(h)
return 1
`;

/**
 * ARGV: h, id, bot, bk, visitor, src, item ID, at, rating (empty to remove), stored value, day, day
 * expiry, the bot row's field prefix.
 */
export const RATING_SCRIPT: string = `${PRELUDE}
local h, item = ARGV[4], ARGV[10]
local S = P .. 'c:' .. h
local R = S .. ':r'
local old = redis.call('HGET', R, item)
if old then
  local p = split(old, 6)
  if p then
    local D = P .. 'd:' .. dayOf(tonumber(p[1]))
    if redis.call('EXISTS', D) == 1 then redis.call('HINCRBY', D, p[5] .. SEP .. p[2], -1) end
    unindexRating(h, item, p)
  end
  redis.call('HDEL', R, item)
end
local rating = ARGV[12]
if rating ~= '' then
  init(S, ARGV[5], ARGV[6], ARGV[7], ARGV[8], ARGV[9])
  redis.call('HSET', R, item, ARGV[13])
  local D = P .. 'd:' .. ARGV[14]
  if tonumber(ARGV[15]) > NOW then
    redis.call('HINCRBY', D, ARGV[16] .. SEP .. rating, 1)
    redis.call('ZADD', P .. 'days', ARGV[14], ARGV[14])
    redis.call('PEXPIREAT', D, ARGV[15])
  end
  for _, k in ipairs(ratingKeys(ARGV[9], ARGV[14], ARGV[7], rating)) do
    redis.call('ZADD', k, -tonumber(ARGV[11]), h .. '|' .. item)
  end
end
refresh(h)
return 1
`;

/** ARGV: h, id, bot, bk, visitor, src, field (`at␟itemId`), JSON. */
export const TRANSCRIPT_SCRIPT: string = `${PRELUDE}
local h = ARGV[4]
local S = P .. 'c:' .. h
init(S, ARGV[5], ARGV[6], ARGV[7], ARGV[8], ARGV[9])
redis.call('HSET', S .. ':x', ARGV[10], ARGV[11])
refresh(h)
return 1
`;

/** ARGV: day, day expiry, field. */
export const COUNT_SCRIPT: string = `${PRELUDE}
daily(ARGV[4], ARGV[5], 6)
return 1
`;

/** ARGV: h. The transcript values, unsorted. */
export const TRANSCRIPT_READ_SCRIPT: string = `${PRELUDE}
local values = redis.call('HVALS', P .. 'c:' .. ARGV[4] .. ':x')
local out = {}
for i = 1, #values do out[i] = '~' .. values[i] end
return out
`;

/** ARGV: h. */
export const DELETE_SCRIPT: string = `${PRELUDE}
drop(ARGV[4])
return 1
`;

/** ARGV: records before (ms), days before (day number), limit. Resolves to how many it deleted. */
export const SWEEP_SCRIPT: string = `${PRELUDE}
local before, limit = tonumber(ARGV[4]), tonumber(ARGV[6])
local deleted = 0

-- Deletes up to n of the conversation's records written before \`before\`.
local function purge(h, n)
  local S = P .. 'c:' .. h
  local T, R, X = S .. ':t', S .. ':r', S .. ':x'
  local del = 0
  local tk = redis.call('HKEYS', T)
  for i = 1, #tk do
    if del < n and tonumber(tk[i]) < before then
      redis.call('HDEL', T, tk[i])
      del = del + 1
    end
  end
  local rv = redis.call('HGETALL', R)
  for i = 1, #rv, 2 do
    local p = split(rv[i + 1], 6)
    if del < n and p and tonumber(p[1]) < before then
      unindexRating(h, rv[i], p)
      redis.call('HDEL', R, rv[i])
      del = del + 1
    end
  end
  local xk = redis.call('HKEYS', X)
  for i = 1, #xk do
    local p = split(xk[i], 2)
    if del < n and p and tonumber(p[1]) < before then
      redis.call('HDEL', X, xk[i])
      del = del + 1
    end
  end
  refresh(h)
  return del
end

for _ = 1, 1000 do
  if deleted >= limit then break end
  local nextH = redis.call('ZRANGEBYSCORE', P .. 'rec', '-inf', '(' .. ARGV[4], 'LIMIT', 0, 1)
  if #nextH == 0 then break end
  local got = purge(nextH[1], limit - deleted)
  if got == 0 then
    -- An entry whose conversation expired: removing it is the deletion.
    redis.call('ZREM', P .. 'rec', nextH[1])
    got = 1
  end
  deleted = deleted + got
end
if deleted < limit then
  local days = redis.call('ZRANGEBYSCORE', P .. 'days', '-inf', '(' .. ARGV[5], 'LIMIT', 0, limit - deleted)
  for i = 1, #days do
    redis.call('DEL', P .. 'd:' .. days[i])
    redis.call('ZREM', P .. 'days', days[i])
    deleted = deleted + 1
  end
end
return deleted
`;

/** ARGV: day numbers. For each day that has rows: the day, then its fields and counters. */
export const DAYS_SCRIPT: string = `${PRELUDE}
local out = {}
for i = 4, #ARGV do
  local fields = redis.call('HGETALL', P .. 'd:' .. ARGV[i])
  if #fields > 0 then
    local row = { tonumber(ARGV[i]) }
    for j = 1, #fields, 2 do
      row[#row + 1] = '~' .. fields[j]
      row[#row + 1] = tonumber(fields[j + 1])
    end
    out[#out + 1] = row
  end
end
return out
`;

/**
 * A page of conversations (mode `c`) or ratings (mode `r`) from the union of the index keys, keyset
 * paged by (score, member). ARGV: mode, temporary key, number of union keys, number of 👎 keys,
 * limit, cursor score, cursor member (empty for the first page), then the keys. Resolves to
 * `[more, last score, last member, ...items]`.
 */
export const LIST_SCRIPT: string = `${PRELUDE}
local mode, tmp = ARGV[4], ARGV[5]
local nu, nd, limit = tonumber(ARGV[6]), tonumber(ARGV[7]), tonumber(ARGV[8])
local union, downs = {}, {}
for i = 1, nu do union[i] = ARGV[10 + i] end
for i = 1, nd do downs[i] = ARGV[10 + nu + i] end
redis.call('ZUNIONSTORE', tmp, nu, unpack(union))
if nd > 0 then
  local tmpd = tmp .. ':d'
  redis.call('ZUNIONSTORE', tmpd, nd, unpack(downs))
  redis.call('ZINTERSTORE', tmp, 2, tmp, tmpd, 'WEIGHTS', 1, 0)
  redis.call('DEL', tmpd)
end

local function resolve(member)
  local h = string.sub(member, 15)
  if mode == 'r' then
    h = string.sub(member, 1, 40)
    local value = redis.call('HGET', P .. 'c:' .. h .. ':r', string.sub(member, 42))
    if not value then return nil end
    local p = split(value, 6)
    if not p then return nil end
    return '~' .. p[6]
  end
  local s = redis.call('HMGET', P .. 'c:' .. h, 'id', 'bot', 'vis', 'first', 'last', 'turns',
    'i', 'ci', 'cw', 'o', 'r', 'up', 'down', 'tx')
  if not s[1] or not s[4] then return nil end
  local item = { '~' .. s[1], '~' .. s[2], '~' .. s[3] }
  for i = 4, 14 do item[i] = tonumber(s[i]) end
  return item
end

local start = 0
if ARGV[10] ~= '' then
  local had = redis.call('ZSCORE', tmp, ARGV[10])
  redis.call('ZADD', tmp, ARGV[9], ARGV[10])
  local rank = redis.call('ZRANK', tmp, ARGV[10])
  if had then
    redis.call('ZADD', tmp, had, ARGV[10])
    start = rank + 1
  else
    redis.call('ZREM', tmp, ARGV[10])
    start = rank
  end
end

local items, lastScore, lastMember, more = {}, '', '', 0
local idx = start
while more == 0 do
  local batch = redis.call('ZRANGE', tmp, idx, idx + limit, 'WITHSCORES')
  if #batch == 0 then break end
  for i = 1, #batch, 2 do
    local item = resolve(batch[i])
    if item then
      if #items == limit then
        more = 1
        break
      end
      items[#items + 1] = item
      lastMember, lastScore = batch[i], batch[i + 1]
    else
      -- Its conversation expired: drop the stale entry.
      for _, k in ipairs(union) do redis.call('ZREM', k, batch[i]) end
      for _, k in ipairs(downs) do redis.call('ZREM', k, batch[i]) end
    end
  end
  idx = idx + #batch / 2
end
redis.call('DEL', tmp)
local out = { more, '~' .. lastScore, '~' .. lastMember }
for i = 1, #items do out[#out + 1] = items[i] end
return out
`;

/** The oldest record's time, or -1 without records. */
export const OLDEST_SCRIPT: string = `${PRELUDE}
local first = redis.call('ZRANGE', P .. 'rec', 0, 0, 'WITHSCORES')
if #first == 0 then return -1 end
return tonumber(first[2])
`;
