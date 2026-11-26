import type { SchemaPart } from '../schema/migration';

/** One row per conversation; `version` is the sequence number of its last item. */
export const CONVERSATIONS_TABLE = 'askdare_conversations';

/** One row per item, numbered 1, 2, 3… within its conversation. */
export const ITEMS_TABLE = 'askdare_conversation_items';

/** The partial index that finds a conversation's latest compaction item (migration 2). */
export const COMPACTION_INDEX: string = `${ITEMS_TABLE}_compaction`;

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
    {
      version: 2,
      name: 'index compaction items',
      // Every `context()` looks for the conversation's latest compaction item of the model
      // (ADR-0029). Without this index it reads every item of a conversation with none.
      //
      // A plain `create index`, since migrations run in a transaction: it blocks appends while it
      // builds. On a large table an operator can build it first with `create index concurrently`
      // and the same definition (docs/custom-store.md); `if not exists` then keeps it. A failed
      // concurrent build leaves an invalid index of that name, which is dropped and rebuilt here.
      sql: `
do $$
begin
  if exists (
    select 1 from pg_index
    where indexrelid = to_regclass('${COMPACTION_INDEX}') and not indisvalid
  ) then
    drop index ${COMPACTION_INDEX};
  end if;
end
$$;

create index if not exists ${COMPACTION_INDEX}
  on ${ITEMS_TABLE} (conversation_id, (item->>'provider'), (item->>'family'), seq)
  where type = 'native' and item->>'kind' = 'compaction'`,
    },
  ],
};
