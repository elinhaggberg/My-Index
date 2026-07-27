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
-- Safe to run even on a completely fresh setup -- it just returns false
-- with nothing to remove.
select cron.unschedule('check-feeds-hourly');

-- 1) Store a shared secret in Supabase's Vault, so the cron job can prove to
--    the Edge Function it's really pg_cron calling (not a stranger on the
--    internet) without any raw secret ever appearing in this repo. Use the
--    exact same value you set as the CRON_SECRET Edge Function secret.
select vault.create_secret('<PASTE_YOUR_CRON_SECRET_HERE>', 'my_index_cron_shared_secret');

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
    body := '{}'::jsonb
  );
  $$
);

-- To check it's registered: select * from cron.job;
-- To unschedule later: select cron.unschedule('check-feeds-hourly');
