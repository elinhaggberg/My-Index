-- Run this once in the Supabase SQL editor, AFTER schema.sql and AFTER
-- deploying the check-feeds Edge Function WITH "Enforce JWT Verification"
-- turned OFF for that function (see supabase/SETUP.md for why -- the
-- new-format Secret key isn't JWT-shaped, so the gateway's JWT check
-- rejects pg_cron's call before the function code ever runs).
--
-- This file is safe to commit as-is (the placeholder below isn't a real
-- secret) but you must substitute it with your own value before running it
-- -- do that only in the SQL editor, never commit the filled-in version.
--
-- Safe to run even on a completely fresh setup. cron.unschedule(text) looks
-- the job up by name internally and RAISES ("could not find valid entry for
-- job") if it doesn't exist yet, rather than returning false the way the
-- bigint-id overload does -- easy to miss since the two overloads behave
-- differently, but a fresh project (no job scheduled yet) hits this every
-- time. Swallow that one specific case so this is genuinely idempotent.
do $$
begin
  perform cron.unschedule('check-feeds-hourly');
exception when others then
  null;
end $$;

-- 1) Store a shared secret in Supabase's Vault, so the cron job can prove to
--    the Edge Function it's really pg_cron calling (not a stranger on the
--    internet) without any raw secret ever appearing in this repo. Use the
--    exact same value you set as the CRON_SECRET Edge Function secret.
--
-- vault.create_secret() always INSERTs, so running this a second time (e.g.
-- re-running install) hits a duplicate-key error on the name -- same
-- fresh-vs-repeat mismatch as cron.unschedule() above, just a different
-- shape. Update in place by id if a secret with this name already exists.
do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'my_index_cron_shared_secret';
  if v_id is not null then
    perform vault.update_secret(v_id, '<PASTE_YOUR_CRON_SECRET_HERE>');
  else
    perform vault.create_secret('<PASTE_YOUR_CRON_SECRET_HERE>', 'my_index_cron_shared_secret');
  end if;
end $$;

-- 2) Schedule the feed check. Replace <YOUR_PROJECT_REF> with your own
--    Supabase project ref (from your project's URL) -- unlike Medical
--    Tracker, this is a separate project, so there's no ref to fill in
--    ahead of time.
select cron.schedule(
  'check-feeds-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/check-feeds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'my_index_cron_shared_secret')
    ),
    body := '{}'::jsonb,
    -- pg_net's default is 5000ms, which check-feeds can easily exceed once
    -- there's more than a couple of tracked feeds (each fetched with up to
    -- an 8s timeout of its own) -- with the default, net._http_response
    -- shows every single hourly run as a client-side timeout, forever,
    -- regardless of whether check-feeds itself ever finishes. This is only
    -- how long pg_net waits to *hear back*; check-feeds keeps running
    -- either way, so raising it just lets the caller actually see the result.
    timeout_milliseconds := 60000
  );
  $$
);

-- To check it's registered: select * from cron.job;
-- To unschedule later: select cron.unschedule('check-feeds-hourly');
