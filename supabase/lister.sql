-- SubSell AUTOLISTER — cloud side (lister/PLAN.md section 5.3). Run once in the Supabase
-- SQL editor (project tcqunihripihroseswgy). Safe to re-run. Namespaced subsell_*: it
-- creates its own four tables, one bucket and one cron job, and touches nothing else —
-- not subsell_configs (the teaching row), not subsell_messages, not subsell-videos.
--
-- What it holds:
--   subsell_listings         one row per listing (the Listing JSON of PLAN section 4 in `data`,
--                            plus the columns the engine filters on, plus the claim lease)
--   subsell_lister_actions   the ACCOUNT's ledger: every create / relist / delete / renew, from any
--                            computer, so the pace is judged the way Facebook judges it (per account);
--                            also an hourly heartbeat per computer with the lister on
--   subsell_copy_library     the owner's headlines and descriptions, per category and language
--   subsell_lister_settings  the account's lister settings (enabled, pace, tag sets, the hold)
--   bucket subsell-photos    the listing photos; public read; each login writes only inside its own
--                            folder <user_id>/… (the demo-video bucket lets any login write anywhere)
--   cron subsell-lister-retention  hourly: action rows > 14 days; listing ROWS the owner closed > 60 days
--                            ago whose photos are already gone. Files are NOT deleted here (a SQL
--                            delete of storage.objects leaves the bytes orphaned): the dashboard
--                            removes them through the Storage API, then the row qualifies.

-- 1) Listings ---------------------------------------------------------------------------
create table if not exists public.subsell_listings (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status        text not null default 'draft',   -- draft|queued|posting|live|relist_queued|relisting|needs_review|error|paused|sold|deleted
  machine       text,                            -- the install id (PC-xxxxx) that posts or posted it; 'any' = first free computer
  fb_listing_id text,                            -- Facebook's id once live
  category      text,
  title         text,
  price         numeric,
  data          jsonb not null default '{}'::jsonb,   -- the whole Listing (PLAN section 4)
  closed_by     text,                            -- null | 'owner' | 'engine' (retention purges only the owner's)
  claimed_at    timestamptz,                     -- the claim lease (PLAN 5.3): a dead claimer's job resumes elsewhere
  lease_until   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.subsell_listings add column if not exists closed_by text;
alter table public.subsell_listings add column if not exists claimed_at timestamptz;
alter table public.subsell_listings add column if not exists lease_until timestamptz;
create index if not exists subsell_listings_user_status on public.subsell_listings (user_id, status);
create index if not exists subsell_listings_user_updated on public.subsell_listings (user_id, updated_at desc);
create index if not exists subsell_listings_fb on public.subsell_listings (user_id, fb_listing_id);

alter table public.subsell_listings enable row level security;
drop policy if exists "owner owns listings" on public.subsell_listings;
create policy "owner owns listings"
  on public.subsell_listings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) The account's action ledger --------------------------------------------------------
create table if not exists public.subsell_lister_actions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at            timestamptz not null default now(),
  kind          text not null,                   -- create|relist|delete|renew|heartbeat|hold
  machine       text,                            -- PC-xxxxx
  fb_listing_id text,
  listing_id    uuid,
  phase         text                             -- e.g. 'pressing' | 'done' | 'failed'
);
create index if not exists subsell_lister_actions_user_at on public.subsell_lister_actions (user_id, at desc);

alter table public.subsell_lister_actions enable row level security;
drop policy if exists "owner owns lister actions" on public.subsell_lister_actions;
create policy "owner owns lister actions"
  on public.subsell_lister_actions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3) Headlines and descriptions ----------------------------------------------------------
create table if not exists public.subsell_copy_library (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category     text not null,                    -- iphone|samsung|phone|ipad|tablet|macbook|laptop|desktop|console|watch|accessory|other
  kind         text not null,                    -- headline|description
  lang         text not null default 'bi',       -- fr|en|bi
  text         text not null,
  uses         integer not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists subsell_copy_library_user_cat on public.subsell_copy_library (user_id, category, kind);

alter table public.subsell_copy_library enable row level security;
drop policy if exists "owner owns copy library" on public.subsell_copy_library;
create policy "owner owns copy library"
  on public.subsell_copy_library for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4) The account's lister settings (never inside subsell_configs) -----------------------
create table if not exists public.subsell_lister_settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,   -- PLAN section 5.3; missing keys = the core's defaults
  updated_at timestamptz not null default now()
);

alter table public.subsell_lister_settings enable row level security;
drop policy if exists "owner owns lister settings" on public.subsell_lister_settings;
create policy "owner owns lister settings"
  on public.subsell_lister_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- keep updated_at fresh (reuses the function schema.sql created)
drop trigger if exists subsell_listings_touch on public.subsell_listings;
create trigger subsell_listings_touch
  before update on public.subsell_listings
  for each row execute function public.subsell_touch_updated_at();
drop trigger if exists subsell_lister_settings_touch on public.subsell_lister_settings;
create trigger subsell_lister_settings_touch
  before update on public.subsell_lister_settings
  for each row execute function public.subsell_touch_updated_at();

-- 5) Photos: a public bucket; a login writes only inside its own folder ------------------
insert into storage.buckets (id, name, public)
  values ('subsell-photos', 'subsell-photos', true)
  on conflict (id) do update set public = true;

drop policy if exists "subsell photos public read" on storage.objects;
drop policy if exists "subsell photos auth upload" on storage.objects;
drop policy if exists "subsell photos auth update" on storage.objects;
drop policy if exists "subsell photos auth delete" on storage.objects;

create policy "subsell photos public read"
  on storage.objects for select
  using (bucket_id = 'subsell-photos');
create policy "subsell photos auth upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'subsell-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "subsell photos auth update"
  on storage.objects for update to authenticated
  using (bucket_id = 'subsell-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "subsell photos auth delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'subsell-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 6) Retention: rows only (same mechanics as retention.sql: pg_cron, bounded batches) -----
create extension if not exists pg_cron;
grant usage on schema cron to postgres;

create or replace function public.subsell_purge_lister(batch integer default 500)
returns table (what text, deleted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with doomed as (
    select id from public.subsell_lister_actions
    where at < now() - interval '14 days'
    order by at
    limit batch
  )
  delete from public.subsell_lister_actions a using doomed where a.id = doomed.id;
  get diagnostics n = row_count;
  what := 'action rows > 14 days'; deleted := n; return next;

  -- listing rows the OWNER closed more than 60 days ago, once the dashboard has removed their
  -- photos through the Storage API (photos[] empty). Never a status the engine inferred.
  with doomed as (
    select l.id from public.subsell_listings l
    where l.status in ('sold', 'deleted')
      and l.closed_by = 'owner'
      and l.updated_at < now() - interval '60 days'
      and jsonb_array_length(coalesce(l.data->'photos', '[]'::jsonb)) = 0
    order by l.updated_at
    limit batch
  )
  delete from public.subsell_listings l using doomed where l.id = doomed.id;
  get diagnostics n = row_count;
  what := 'listing rows closed by the owner > 60 days, photos already removed'; deleted := n; return next;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'subsell-lister-retention';
select cron.schedule('subsell-lister-retention', '23 * * * *', $$select public.subsell_purge_lister(500)$$);

-- 7) Check (optional, read-only): the tables exist and your login sees only its rows
-- select count(*) from public.subsell_listings;
-- select count(*) from public.subsell_lister_actions;
-- select count(*) from public.subsell_copy_library;
-- select * from public.subsell_lister_settings;
