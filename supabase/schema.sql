-- SubSell — Supabase schema for the config web app + public endpoint.
-- Run once in the Supabase SQL editor. Safe to re-run, and SAFE TO RUN IN A
-- PROJECT SHARED WITH OTHER APPS: everything is namespaced subsell_* so it only
-- ever creates/touches its own table, function, and triggers — it will NOT drop
-- or replace another app's `configs` table or `on_auth_user_created` trigger.

-- 1) One settings row per user. `config` is the JSON the extension consumes;
--    `config_key` is the secret used in the public config URL.
create table if not exists public.subsell_configs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  config_key text unique not null default encode(gen_random_bytes(16), 'hex'),
  updated_at timestamptz not null default now()
);

-- If an earlier version of this table existed without config_key, add it.
alter table public.subsell_configs
  add column if not exists config_key text unique not null default encode(gen_random_bytes(16), 'hex');

-- 2) RLS: a logged-in user can read/write ONLY their own row (used by the web UI).
--    The public /config endpoint uses the service role + config_key, bypassing RLS.
alter table public.subsell_configs enable row level security;

drop policy if exists "owner can read/write own row" on public.subsell_configs;
drop policy if exists "read own config"   on public.subsell_configs;
drop policy if exists "insert own config" on public.subsell_configs;
drop policy if exists "update own config" on public.subsell_configs;
create policy "owner can read/write own row"
  on public.subsell_configs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3) Auto-create a row (with a config_key) when a user signs up. Namespaced so it
--    can't clash with another app's handle_new_user / on_auth_user_created.
create or replace function public.subsell_handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.subsell_configs (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists subsell_on_auth_user_created on auth.users;
create trigger subsell_on_auth_user_created
  after insert on auth.users
  for each row execute function public.subsell_handle_new_user();

-- 4) Backfill: make sure users that already exist (e.g. you) get a row + config_key.
insert into public.subsell_configs (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;

-- 5) Keep updated_at fresh on writes (harmless convenience).
create or replace function public.subsell_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists subsell_configs_touch on public.subsell_configs;
create trigger subsell_configs_touch
  before update on public.subsell_configs
  for each row execute function public.subsell_touch_updated_at();

-- 6) ACTIVITY LOG: every message each extension sends (reply / video / follow-up)
--    is mirrored here so the web dashboard shows one combined feed + totals across
--    all your computers/accounts. Namespaced subsell_*; inserts come from the
--    subsell-log Edge Function (service role + config_key); the dashboard reads its
--    own rows via RLS.
create table if not exists public.subsell_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  machine     text,
  thread_id   text,
  thread_name text,
  kind        text not null default 'text',   -- 'text' | 'video' | 'followup' | 'human'
  buyer_text  text,
  bot_text    text
);
create index if not exists subsell_messages_user_created
  on public.subsell_messages (user_id, created_at desc);

alter table public.subsell_messages enable row level security;
drop policy if exists "owner reads own messages" on public.subsell_messages;
create policy "owner reads own messages"
  on public.subsell_messages for select
  using (auth.uid() = user_id);
-- No public INSERT policy: the subsell-log Edge Function inserts with the service
-- role (bypasses RLS) after resolving the user from config_key.
