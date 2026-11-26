import type { SchemaPart } from '../schema/migration';

/** One row per turn, keyed by its conversation and time, so a repeated write is a no-op. */
export const TURNS_TABLE = 'askdare_admin_turns';
/** One row per rated answer; a later rating of it replaces the row. */
export const RATINGS_TABLE = 'askdare_admin_ratings';
/** One row per turn's text, written only with `admin.transcripts: true`. */
export const TRANSCRIPTS_TABLE = 'askdare_admin_transcripts';
/**
 * One row per conversation with records, summed from them by every write, delete and sweep that
 * changes them, so the conversation list reads one table.
 */
export const SUMMARIES_TABLE = 'askdare_admin_conversations';
/** Daily turn counters per bot, model and source. No conversation or visitor. */
export const TURN_DAYS_TABLE = 'askdare_admin_turn_days';
/** Daily counters per bot and source: conversations, ratings, leads and handoffs. */
export const BOT_DAYS_TABLE = 'askdare_admin_bot_days';

/**
 * The admin store's schema (ADR-0032). Text columns that queries sort or page on use the `C`
 * collation, so every database orders them alike, by code point, whatever its default collation.
 * Times are epoch milliseconds (`bigint`), as the port has them; days are UTC `date`s.
 *
 * No message content outside the transcripts table, and no lead values or handoff details anywhere
 * (ADR-0032, decision 6). Released migrations are never edited.
 */
export const ADMIN_PART: SchemaPart = {
  name: 'admin',
  migrations: [
    {
      version: 1,
      name: 'create the admin store',
      sql: `
create table ${TURNS_TABLE} (
  conversation_id     text collate "C" not null,
  at                  bigint not null,
  bot                 text collate "C" not null,
  visitor             text not null,
  source              text not null check (source in ('chat', 'console')),
  model               text collate "C" not null,
  input_tokens        bigint not null,
  cached_input_tokens bigint not null,
  cache_write_tokens  bigint not null,
  output_tokens       bigint not null,
  reasoning_tokens    bigint not null,
  -- The rest of the record: counters, names and outcomes, never content.
  detail              jsonb not null,
  primary key (conversation_id, at)
);
-- Retention sweeps the oldest records first.
create index ${TURNS_TABLE}_at on ${TURNS_TABLE} (at);

create table ${RATINGS_TABLE} (
  conversation_id  text collate "C" not null,
  item_id          text collate "C" not null,
  at               bigint not null,
  bot              text collate "C" not null,
  visitor          text not null,
  source           text not null check (source in ('chat', 'console')),
  rating           text not null check (rating in ('up', 'down')),
  comment          text,
  primary key (conversation_id, item_id)
);
-- The ratings list (newest first in a day range) and retention.
create index ${RATINGS_TABLE}_at on ${RATINGS_TABLE} (at);

create table ${TRANSCRIPTS_TABLE} (
  conversation_id  text collate "C" not null,
  at               bigint not null,
  -- '' for a turn without an item ID, so it can be part of the key.
  item_id          text collate "C" not null,
  bot              text collate "C" not null,
  visitor          text not null,
  source           text not null check (source in ('chat', 'console')),
  input            text not null,
  attachments      integer not null,
  answer           text,
  citations        jsonb not null,
  "check"          text,
  reason           text not null,
  primary key (conversation_id, at, item_id)
);
create index ${TRANSCRIPTS_TABLE}_at on ${TRANSCRIPTS_TABLE} (at);

create table ${SUMMARIES_TABLE} (
  conversation_id     text collate "C" primary key,
  -- The first record's: a conversation belongs to the bot, visitor, source and day it started on.
  bot                 text collate "C" not null,
  visitor             text not null,
  source              text not null check (source in ('chat', 'console')),
  first_at            bigint not null,
  last_at             bigint not null,
  turns               bigint not null,
  input_tokens        bigint not null,
  cached_input_tokens bigint not null,
  cache_write_tokens  bigint not null,
  output_tokens       bigint not null,
  reasoning_tokens    bigint not null,
  tokens              bigint generated always as (input_tokens + output_tokens) stored,
  up                  bigint not null,
  down                bigint not null,
  transcripts         bigint not null
);
-- The conversation list: the conversations started in a day range.
create index ${SUMMARIES_TABLE}_first_at on ${SUMMARIES_TABLE} (first_at);
-- Retention drops summaries whose records are all gone.
create index ${SUMMARIES_TABLE}_last_at on ${SUMMARIES_TABLE} (last_at);

create table ${TURN_DAYS_TABLE} (
  day                 date not null,
  bot                 text collate "C" not null,
  model               text collate "C" not null,
  source              text not null check (source in ('chat', 'console')),
  turns               bigint not null default 0,
  failed              bigint not null default 0,
  unanswered          bigint not null default 0,
  input_tokens        bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  cache_write_tokens  bigint not null default 0,
  output_tokens       bigint not null default 0,
  reasoning_tokens    bigint not null default 0,
  primary key (day, bot, model, source)
);

create table ${BOT_DAYS_TABLE} (
  day                  date not null,
  bot                  text collate "C" not null,
  source               text not null check (source in ('chat', 'console')),
  conversations        bigint not null default 0,
  up                   bigint not null default 0,
  down                 bigint not null default 0,
  leads                bigint not null default 0,
  handoffs_sent        bigint not null default 0,
  handoffs_saved       bigint not null default 0,
  handoffs_unavailable bigint not null default 0,
  handoffs_failed      bigint not null default 0,
  handoffs_limited     bigint not null default 0,
  primary key (day, bot, source)
)`,
    },
  ],
};
