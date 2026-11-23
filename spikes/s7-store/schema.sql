-- Spike S7: the Postgres prototype of a ConversationStore. Idempotent.
create table if not exists askdare_conversations (
  id          uuid primary key,
  bot_id      text not null,
  owner       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Sequence number of the last item; appends with an expected version compare against it.
  version     bigint not null default 0
);
-- Retention sweeps find idle conversations by this.
create index if not exists askdare_conversations_updated on askdare_conversations (updated_at);

create table if not exists askdare_items (
  conversation_id uuid not null references askdare_conversations (id) on delete cascade,
  seq             bigint not null,
  item_id         text not null,
  type            text not null,
  item            jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, seq),
  unique (conversation_id, item_id)
);

-- Stream resume (question 6): events of a running turn, kept for minutes.
create unlogged table if not exists askdare_turn_events (
  turn_id     uuid not null,
  seq         integer not null,
  event       jsonb not null,
  expires_at  timestamptz not null,
  primary key (turn_id, seq)
);
create index if not exists askdare_turn_events_expires on askdare_turn_events (expires_at);
