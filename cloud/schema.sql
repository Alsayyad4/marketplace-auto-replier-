-- =====================================================================
-- SubSell — Supabase schema for the cloud web-app sync.
-- ---------------------------------------------------------------------
-- One row per account holds the WHOLE settings object as JSON. The web
-- dashboard writes it; every extension reads it. Row-Level Security makes
-- each account able to touch ONLY its own row, so the anon (public) key is
-- safe to ship in the dashboard + extension — the JWT from login is what
-- grants access to a row.
--
-- Everything is namespaced `subsell_*` so this is SAFE to run in a project
-- that already hosts other apps: it only ever creates its own table,
-- function, and trigger and never touches anything else. Run it once:
-- Supabase dashboard → SQL Editor → paste → Run.
-- =====================================================================

create table if not exists public.subsell_configs (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  config     jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock the table down, then grant each user access to their own row only.
alter table public.subsell_configs enable row level security;

drop policy if exists "read own config"   on public.subsell_configs;
drop policy if exists "insert own config" on public.subsell_configs;
drop policy if exists "update own config" on public.subsell_configs;

create policy "read own config"
  on public.subsell_configs for select
  using (auth.uid() = user_id);

create policy "insert own config"
  on public.subsell_configs for insert
  with check (auth.uid() = user_id);

create policy "update own config"
  on public.subsell_configs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Bump updated_at on every write so extensions can cheaply detect "changed".
-- Named subsell_* so it can't clash with another app's updated_at helper.
create or replace function public.subsell_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subsell_configs_touch on public.subsell_configs;
create trigger subsell_configs_touch
  before update on public.subsell_configs
  for each row execute function public.subsell_touch_updated_at();
