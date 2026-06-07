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
