import type { SchemaPart } from '../schema/migration';

/** One row per conversation; `version` is the sequence number of its last item. */
export const CONVERSATIONS_TABLE = 'askdare_conversations';

/** One row per item, numbered 1, 2, 3… within its conversation. */
export const ITEMS_TABLE = 'askdare_conversation_items';

/**
 * The conversation store's schema (ADR-0024). Items are `jsonb`; only the columns the store
 * filters on (`type` and the item ID) are taken out of it. Released migrations are never edited.
 */
export const CONVERSATIONS_PART: SchemaPart = {
  name: 'conversations',
  migrations: [
    {
      version: 1,
      name: 'create conversations and items',
      sql: `
create table ${CONVERSATIONS_TABLE} (
  id          uuid primary key,
  bot_id      text not null,
  owner       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     bigint not null default 0 check (version >= 0)
);
-- Retention sweeps look for idle conversations.
create index ${CONVERSATIONS_TABLE}_updated_at on ${CONVERSATIONS_TABLE} (updated_at);

create table ${ITEMS_TABLE} (
  conversation_id  uuid not null references ${CONVERSATIONS_TABLE} (id) on delete cascade,
  seq              bigint not null check (seq > 0),
  item_id          text not null,
  type             text not null,
  item             jsonb not null,
  created_at       timestamptz not null default now(),
  primary key (conversation_id, seq),
  unique (conversation_id, item_id)
)`,
    },
  ],
};
