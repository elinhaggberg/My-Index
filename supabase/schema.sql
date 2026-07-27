-- Run this once in the Supabase SQL editor (Database > SQL Editor) to set
-- up the optional "new content" add-on described in supabase/SETUP.md.
-- Safe to commit: contains no secrets. The app works fully as a static
-- local-storage/IndexedDB register without any of this.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One row per Channel (on a Profile) that has an RSS feed and that this
-- device wants tracked for new-item counts. Keyed by the app's own
-- client-side channel id, not a server-generated one, so the client can
-- update/delete a row without a round trip to look one up first. No
-- article content is ever stored here — just enough to detect "something
-- new arrived since last check" and count it.
create table if not exists channel_feeds (
  channel_id text primary key,
  device_id text not null,
  profile_id text not null,
  rss_url text not null,
  last_seen_guid text,
  new_count integer not null default 0,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists channel_feeds_device_id_idx on channel_feeds (device_id);

-- One row per link shared into the app via the iOS Shortcut capture flow,
-- waiting to be picked up the next time the app is opened. Deliberately
-- just a URL and a device id -- the Shortcut can't tag or comment on
-- anything, that happens later in the app itself, same as pasting the link
-- in by hand. Deleted once the client has imported it.
create table if not exists pending_captures (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  url text not null,
  created_at timestamptz not null default now()
);
create index if not exists pending_captures_device_id_idx on pending_captures (device_id);

-- Atomically bumps a channel's new_count rather than a read-then-write from
-- the Edge Function, so two overlapping cron runs can't clobber each other's
-- count.
create or replace function increment_channel_new_count(p_channel_id text, p_amount integer, p_last_seen_guid text)
returns void
language sql
as $$
  update channel_feeds
  set new_count = new_count + p_amount,
      last_seen_guid = p_last_seen_guid,
      last_checked_at = now()
  where channel_id = p_channel_id;
$$;

alter table channel_feeds enable row level security;
alter table pending_captures enable row level security;

-- No policies are defined on purpose. The anon/publishable key used by the
-- browser can never read or write these tables directly, even if the key or
-- project URL leaks -- there's simply no path in for it. All access goes
-- through the sync-index Edge Function (client-facing) and check-feeds
-- (cron-only), which use the service role key (injected automatically into
-- every Edge Function, never stored in this repo) to reach the tables from
-- the server side only.
