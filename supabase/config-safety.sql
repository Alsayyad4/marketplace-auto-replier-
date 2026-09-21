-- SubSell — config safety net (v0.21.61). Run once in the Supabase SQL editor.
-- Safe to re-run. Touches only subsell_* objects.
--
-- WHY THIS EXISTS
-- The settings row is overwritten in place by whoever saves last, and it had no
-- history. A single blank form — saved from any machine, or from the dashboard —
-- replaced the API key and the teaching with empty strings, and there was nothing
-- left anywhere to put back. Every bot on every computer went quiet, and the
-- Settings page looked like a fresh, logged-out install, which is why it felt as
-- though the login had been lost.
--
-- The extension now refuses to publish or to accept such a write, but the fleet
-- updates on its own schedule and the dashboard is a separate client. This does
-- it in the database, where it holds for every client at once, immediately:
--   1. every write keeps a copy of what it replaced (20 deep), so a bad save is
--      always undoable;
--   2. a blank never overwrites a real value in the four fields that stop every
--      bot dead: apiKey, model, businessInfo, instructions.
-- Anything else — listings, videos, coaching — is left alone, because emptying
-- those is a thing an operator legitimately does. History covers them instead.

-- 1) What each write replaced.
create table if not exists public.subsell_config_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  config      jsonb not null,
  replaced_at timestamptz not null default now()
);
create index if not exists subsell_config_history_user
  on public.subsell_config_history (user_id, replaced_at desc);

alter table public.subsell_config_history enable row level security;
drop policy if exists "owner reads own config history" on public.subsell_config_history;
create policy "owner reads own config history"
  on public.subsell_config_history for select
  using (auth.uid() = user_id);

-- 2) Snapshot the old row, then refuse to blank out what keeps the bots alive.
create or replace function public.subsell_guard_config()
returns trigger language plpgsql as $$
declare
  k      text;
  oldv   text;
  newv   text;
  keys   text[] := array['apiKey', 'model', 'businessInfo', 'instructions'];
  oldcfg jsonb  := case when jsonb_typeof(old.config) = 'object' then old.config else '{}'::jsonb end;
  worth  boolean := false;
begin
  if jsonb_typeof(new.config) is distinct from 'object' then
    -- Not an object at all (null, a string, an array): never a real save. Keep
    -- what is there rather than destroying it.
    new.config := oldcfg;
    return new;
  end if;

  -- Was the row being replaced worth keeping a copy of?
  foreach k in array keys loop
    if coalesce(btrim(oldcfg ->> k), '') <> '' then worth := true; end if;
  end loop;

  if worth and oldcfg is distinct from new.config then
    insert into public.subsell_config_history (user_id, config) values (old.user_id, oldcfg);
    delete from public.subsell_config_history
     where user_id = old.user_id
       and id not in (
         select id from public.subsell_config_history
          where user_id = old.user_id
          order by replaced_at desc
          limit 20
       );
  end if;

  -- A blank may not replace a real value in these four. Every one of them, left
  -- empty, silences every bot on the account.
  foreach k in array keys loop
    oldv := coalesce(btrim(oldcfg ->> k), '');
    newv := coalesce(btrim(new.config ->> k), '');
    if newv = '' and oldv <> '' then
      new.config := jsonb_set(new.config, array[k], to_jsonb(oldcfg ->> k), true);
    end if;
  end loop;

  return new;
end;
$$;

-- Fires before subsell_configs_touch (BEFORE triggers run in name order), so
-- updated_at still reflects the write that actually landed.
drop trigger if exists subsell_configs_guard on public.subsell_configs;
create trigger subsell_configs_guard
  before update on public.subsell_configs
  for each row execute function public.subsell_guard_config();

-- 3) Recovery, by hand, if it is ever needed:
--
--   -- what the account looked like before each of the last writes
--   select id, replaced_at, left(config->>'apiKey', 12) as key, jsonb_array_length(coalesce(config->'listings','[]'::jsonb)) as listings
--     from public.subsell_config_history
--    where user_id = auth.uid()
--    order by replaced_at desc;
--
--   -- put one of them back (use the id from above)
--   update public.subsell_configs c
--      set config = h.config
--     from public.subsell_config_history h
--    where h.id = <id> and h.user_id = c.user_id and c.user_id = auth.uid();
