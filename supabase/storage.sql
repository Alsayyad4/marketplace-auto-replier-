-- SubSell — Supabase Storage for central demo videos. Run once in the SQL editor.
-- Creates a public bucket 'subsell-videos' and policies scoped ONLY to it, so it
-- is safe in a project shared with other apps (it won't touch their buckets).
--
-- Why public read: the video is sent to buyers anyway, and the extension fetches
-- it with no login. Uploads still require a logged-in dashboard user.

insert into storage.buckets (id, name, public)
  values ('subsell-videos', 'subsell-videos', true)
  on conflict (id) do update set public = true;

drop policy if exists "subsell videos public read"  on storage.objects;
drop policy if exists "subsell videos auth upload"   on storage.objects;
drop policy if exists "subsell videos auth update"   on storage.objects;
drop policy if exists "subsell videos auth delete"   on storage.objects;

create policy "subsell videos public read"
  on storage.objects for select
  using (bucket_id = 'subsell-videos');

create policy "subsell videos auth upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'subsell-videos');

create policy "subsell videos auth update"
  on storage.objects for update to authenticated
  using (bucket_id = 'subsell-videos');

create policy "subsell videos auth delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'subsell-videos');
