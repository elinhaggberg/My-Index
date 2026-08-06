# Optional add-on: new-content badges + Shortcut capture

(Looking for Cloud Backup instead — full profile/tag/snippet sync to your
own Supabase project? That's a separate, independent add-on documented in
`supabase/CLOUD_BACKUP_SETUP.md`.)

**As of the Cloud Sync feature in Settings, you shouldn't need any of this
manual walkthrough anymore** — connecting your own Supabase project there
(Settings → Cloud sync → Connect Supabase → pick a project → Install RSS
sync) runs every step below automatically via Supabase's Management API,
using an OAuth connection instead of you pasting keys or running SQL by
hand. This file is kept as a reference for what that automated install
actually does under the hood, and as a manual fallback if the automated
path ever breaks (e.g. Supabase changes something the install calls
depend on) — the two approaches produce the identical end state, so
either one is fine to have run.

Everything in this folder is written; these are the manual steps in the
Supabase dashboard that only you can do (they need your account login).
**None of this is required** — My Index works fully as a static
local-storage/IndexedDB register without it. Do these steps only if you want:

1. A badge showing how many new items have appeared in a Profile's RSS
   channels since you last visited its page, or
2. The iOS Shortcut capture flow (share a link into a Shortcut, it lands in
   the app as an untagged Snippet without opening the app first).

Do them in order, in a Supabase project of your own (this is a separate
project from Medical Tracker's — don't reuse its ref/keys, these tables are
unrelated to that project's).

## 1. Run the schema

Dashboard → SQL Editor → paste the contents of `supabase/schema.sql` → Run.
This creates the tables, the `increment_channel_new_count` helper function,
and enables the extensions. Safe to re-run.

## 2. Set Edge Function secrets

Dashboard → Edge Functions → Manage secrets (or via CLI:
`supabase secrets set NAME=value`), set:

- `CRON_SECRET` = a random string only you and the cron job know (Claude can
  generate one). Used by `check-feeds` to check that a request is really the
  scheduled cron call and not a stranger on the internet — see step 4, this
  same value goes into `cron_setup.sql` too.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` should be auto-injected into
every Edge Function by Supabase — no action needed. **If a function errors
out after deploying** (check its logs in the dashboard), it likely means the
new key system changed that auto-injection: in that case, add
`SUPABASE_SERVICE_ROLE_KEY` as an explicit secret yourself, using your
**Secret key** (Project Settings → API → API Keys → "Secret keys" table —
the one starting `sb_secret_...`). Don't send that value to Claude; set it
directly in the dashboard/CLI.

## 3. Deploy the two Edge Functions

With the Supabase CLI logged into your project:

```
supabase functions deploy sync-index
supabase functions deploy check-feeds
```

(If you'd rather not use the CLI, you can create each function in the
dashboard and paste `index.ts`'s contents into its editor instead.)

## 4. Turn off JWT verification for BOTH functions, then schedule the cron job

**Important:** Supabase's Edge Function gateway enforces JWT verification by
default, but it only understands the *legacy* JWT-shaped anon/service_role
keys — the new-format Publishable (`sb_publishable_...`) and Secret
(`sb_secret_...`) keys aren't JWTs at all. On a project using the new key
system (any project created recently), leaving verification on for *either*
function gets every real call rejected at the gateway with a `401
UNAUTHORIZED_INVALID_JWT_FORMAT`/"Invalid JWT" before the function's own code
ever runs (you'll see this in the function's Invocations/Logs tab if it
happens) — this caught out the automated install's first live test too, see
the git history around js/cloudSyncInstall.js if you want the full story.

Find **Enforce JWT Verification** in each function's settings (dashboard →
Edge Functions → check-feeds / sync-index → Settings) and turn it **off**
for **both**. Neither loses anything security-wise from this — the
anon/publishable key was never a secret access boundary to begin with; what
actually protects the tables is that RLS has no policies granting the anon
key any direct access at all (see schema.sql's comment) — only the two Edge
Functions, using the service role key, can reach them.

If you're on `sync-index`'s client side (`js/feedSync.js`), send the
publishable key on the `apikey` header only, never `Authorization: Bearer` —
the gateway tries to parse whatever's on `Authorization` as a JWT and
rejects it the same way if it isn't one.

With JWT verification off, `check-feeds` would otherwise be callable by
anyone on the internet, so it checks its own shared secret internally instead
(the `CRON_SECRET` from step 2). Open `supabase/cron_setup.sql`, and **in the
SQL editor only** (don't edit and commit this file with real values in it):
replace both placeholders — the `CRON_SECRET` value and your project ref —
then run the whole file.

Check it's registered with `select * from cron.job;` — the `command` column
should reference `X-Cron-Secret`, not `Authorization`.

## 5. Wire up the client

`js/feedSync.js` ships with the Project URL and Publishable key left blank,
which keeps the whole feature inert (every call is a silent no-op) so the
app works identically without any of this. Once the steps above are done,
fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of that file (the
Publishable key from Project Settings → API — safe to commit, same as
Medical Tracker's `supabaseConfig.js`), then:

- Saving a Profile with a channel that has an RSS feed URL registers it with
  `sync-index` (`subscribe-channel`); clearing the URL or deleting the
  channel/profile unregisters it.
- Home fetches counts (`get-counts`) on load and merges them into local
  badges; visiting a Profile's page clears its badge locally **and** calls
  `clear-counts` so the server-side count resets too.
- On open, the app calls `consume-captures` once to pull in anything shared
  via the iOS Shortcut since its last run, adding each as an untagged
  ("Uncategorized") Snippet.

## 6. Set up the iOS Shortcut (optional, only for the Shortcut capture flow)

Create a Shortcut with a "Share Sheet" input that accepts URLs, and add an
"Get Contents of URL" action:

- URL: `https://<your-project-ref>.supabase.co/functions/v1/sync-index`
- Method: POST
- Headers: `Content-Type: application/json`, `apikey: <your publishable key>`,
  `Authorization: Bearer <your publishable key>`
- Request body (JSON): `{"action": "capture", "deviceId": "<your device id>", "url": "[Shared URL]"}`

Your device id is generated the first time the app opens and stored in
`localStorage` as `mi_device_id_v1` — there's no UI surfacing it yet, so
read it from the browser's dev tools once to paste into the Shortcut.

## Troubleshooting: no feeds are updating at all

Check `net._http_response` in the SQL editor:

```sql
select id, status_code, content, timed_out, error_msg, created
from net._http_response
order by created desc
limit 5;
```

If every row shows `timed_out: true`, pg_cron's `net.http_post` call is
giving up before `check-feeds` finishes responding — its default wait is
only 5 seconds, and `check-feeds` fetches every tracked feed (with up to an
8-second timeout each), so it's easy to exceed that once you have more than
one or two feeds. Two things fix this together: `cron_setup.sql`'s
`net.http_post` call now passes `timeout_milliseconds := 60000`, and
`check-feeds` now checks all feeds concurrently instead of one at a time, so
total runtime stays close to a single feed's worst case regardless of how
many are tracked. If you're on an older deploy predating this, re-run
`cron_setup.sql` in the SQL editor (with your real secret/ref substituted in,
same as originally) and redeploy `check-feeds` (step 3 above, or Settings →
Cloud sync → re-run Install).

`cron.job_run_details` only tells you pg_cron successfully *queued* the
request — it says nothing about whether `check-feeds` itself succeeded, so
check `net._http_response` (above), not just `job_run_details`, when
diagnosing this.

## Troubleshooting: one specific feed isn't updating

`check-feeds` (dashboard → Edge Functions → check-feeds → "Invoke") returns a
`results` array, one entry per tracked feed, each either `{ newCount }` on
success or `{ error }` when a feed didn't produce anything — check this (or
the function's Logs tab, which logs the same failures) before assuming
something's broken app-side.

Some publishers (Substack in particular, via Cloudflare) return a non-200 or
a blank challenge page to requests that don't look like a browser or a known
feed reader. `check-feeds` sends a browser-shaped User-Agent and an XML
`Accept` header for exactly this reason — if you're running an older deploy
predating this, redeploy the function (step 3 above, or Settings → Cloud
sync → re-run Install if you're on the automated path) to pick up the fix.

A Substack account that's never set up an actual publication (only ever
posted from its `substack.com/@handle` profile page) has no separate site
and genuinely has no RSS feed to find — the app explains this specific case
when adding the channel rather than just silently falling back to a blank
manual field.

## Troubleshooting: a feed is fetching fine but never shows new posts

Check the row directly:

```sql
select rss_url, new_count, last_seen_guid, last_checked_at
from channel_feeds
where rss_url = '<the feed url>';
```

A recent `last_checked_at` with `new_count` stuck at `0` despite known new
posts points at feed ordering: `check-feeds` used to assume every feed lists
items newest-first (true for the overwhelming majority), and used that
position to detect "new." A feed that lists oldest-first breaks that
silently — the tracked guid is stuck on the *oldest* item, whose position
never changes as real posts get appended at the end, so nothing ever looks
new. `check-feeds` now re-sorts by each item's own `<pubDate>`/`<published>`
date whenever every item in the feed has a parseable one, which is a real
signal independent of document order — only falling back to trusting
document order when dates are missing. If you were tracking a
mis-ordered feed before this fix, expect its next check to badge the whole
backlog of previously-missed posts at once (correct — that backlog was
always there, just never counted).

## Done

Everything above is additive and reversible — disable the cron job
(`select cron.unschedule('check-feeds-hourly');`) or leave `feedSync.js`'s
config blank at any time to fall back to a purely local-storage app.
