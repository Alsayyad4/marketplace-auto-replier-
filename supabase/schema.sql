-- SubSell — Supabase schema. Run once in the SQL editor.

-- One settings row per user. `config` is the JSON the extension consumes.
create table if not exists public.configs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  config_key text unique not null default encode(gen_random_bytes(16), 'hex'),
  updated_at timestamptz not null default now()
);

-- Row-level security: a logged-in user can only read/write their OWN row
-- (this is what the web-app UI uses). The public /config endpoint uses the
-- service role and is authenticated by `config_key`, so it bypasses RLS.
alter table public.configs enable row level security;

drop policy if exists "owner can read/write own row" on public.configs;
create policy "owner can read/write own row"
  on public.configs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-create a configs row (with a config_key) the moment a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.configs (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
