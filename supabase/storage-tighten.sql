-- (v0.21.94, Nov 10 2026) TIGHTEN THE DEMO-CLIP BUCKET. Run once in the SQL editor of the
-- project (tcqunihripihroseswgy) — or through the Management API with the owner's token.
--
-- Why: storage.sql (v0.21.x) let ANY signed-in user upload, replace or delete objects in
-- the public bucket 'subsell-videos'. The project is shared with the SubSell website, whose
-- sign-ups are open (auth/v1/settings: disable_signup=false, re-checked Nov 10 2026), so a
-- stranger who creates an account there could replace or delete the clip the bot sends to
-- buyers. From now on a signed-in user may write only inside their OWN folder
-- (<user id>/<file>), which is exactly where the dashboard uploads (docs/app.js:
-- path = session.user.id + "/" + Date.now() + "-" + name). Public READ stays: the bot
-- fetches the clip with no login, and the clip is sent to buyers anyway.
--
-- Nothing else in the project is touched: every policy below names the bucket.

drop policy if exists "subsell videos public read"  on storage.objects;
drop policy if exists "subsell videos auth upload"   on storage.objects;
drop policy if exists "subsell videos auth update"   on storage.objects;
drop policy if exists "subsell videos auth delete"   on storage.objects;

create policy "subsell videos public read"
  on storage.objects for select
  using (bucket_id = 'subsell-videos');

create policy "subsell videos auth upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'subsell-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "subsell videos auth update"
  on storage.objects for update to authenticated
  using (bucket_id = 'subsell-videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "subsell videos auth delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'subsell-videos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Verify (expect 4 rows, the three write policies carrying "foldername"):
-- select policyname, cmd, qual, with_check from pg_policies
--   where tablename = 'objects' and policyname like 'subsell videos%';
