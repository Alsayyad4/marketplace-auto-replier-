-- SubSell — Activity-log retention (v0.21.80, Oct 8 2026; owner: "don't keep all the old
-- convos in history from the Activity tab, 5 days history and then delete automatically,
-- so it doesn't accumulate and crash").
--
-- Run once in the Supabase SQL editor (or through the Management API). Safe to re-run.
-- Namespaced subsell_*: it touches only the subsell_messages table and one cron job.
--
-- WHAT IT KEEPS (the extension reads these rows back as the chat memory, so the
-- windows are the memory's windows, not the dashboard's):
--   text / human / followup / claim / video-status / gap   5 days   (the feed; the
--        "already answered" check looks back 30 min, the "our own echo" 24 h, claims 10 min)
--   teach / usage                                         35 days   (the dashboard's fleet
--        line and the 30-day cost meter read these)
--   video                                                 60 days   (a demo video sent to a
--        buyer must not be sent again when that buyer writes back weeks later)
--
-- HOW: pg_cron runs the purge every hour in bounded batches (5,000 rows per kind per
-- run), so a Micro instance never spends more than a moment on it. The first run after
-- a long backlog is done by hand in batches (see deploy/supabase-heal.mjs --purge).

create extension if not exists pg_cron;
grant usage on schema cron to postgres;

-- The purge's own index: the only other index starts with user_id.
create index if not exists subsell_messages_created on public.subsell_messages (created_at);

create or replace function public.subsell_purge_activity(batch integer default 5000)
returns table (kind_group text, deleted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with doomed as (
    select id from public.subsell_messages
    where created_at < now() - interval '5 days'
      and kind not in ('video', 'teach', 'usage')
    order by created_at
    limit batch
  )
  delete from public.subsell_messages m using doomed where m.id = doomed.id;
  get diagnostics n = row_count;
  kind_group := 'feed (5 days)'; deleted := n; return next;

  with doomed as (
    select id from public.subsell_messages
    where created_at < now() - interval '35 days'
      and kind in ('teach', 'usage')
    order by created_at
    limit batch
  )
  delete from public.subsell_messages m using doomed where m.id = doomed.id;
  get diagnostics n = row_count;
  kind_group := 'teach+usage (35 days)'; deleted := n; return next;

  with doomed as (
    select id from public.subsell_messages
    where created_at < now() - interval '60 days'
      and kind = 'video'
    order by created_at
    limit batch
  )
  delete from public.subsell_messages m using doomed where m.id = doomed.id;
  get diagnostics n = row_count;
  kind_group := 'video (60 days)'; deleted := n; return next;
end;
$$;

-- One job, hourly at minute 7; re-running this file replaces it (same name).
select cron.unschedule(jobid) from cron.job where jobname = 'subsell-activity-retention';
select cron.schedule('subsell-activity-retention', '7 * * * *', $$select public.subsell_purge_activity(5000)$$);
