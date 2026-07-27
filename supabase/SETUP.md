# Optional add-on: new-content badges + Shortcut capture

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

## 4. Turn off JWT verification for check-feeds, then schedule the cron job

**Important:** `check-feeds` is called by `pg_cron`, not by a logged-in user,
so it can't present a real user JWT. Supabase's Edge Function gateway
enforces JWT verification by default, and the new-format Secret key
(`sb_secret_...`) isn't JWT-shaped — so with verification left on, every cron
call gets rejected at the gateway with a `401 UNAUTHORIZED_INVALID_JWT_FORMAT`
before the function's own code ever runs (you'll see this in the function's
Invocations/Logs tab if it happens).

Find **Enforce JWT Verification** in `check-feeds`' function settings
(dashboard → Edge Functions → check-feeds → Settings) and turn it **off**.
Leave it **on** for `sync-index` — that one's fine, since it's called with
the Publishable key from the app itself, which the client already sends as a
normal Bearer token that passes gateway checks correctly.

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

## Done

Everything above is additive and reversible — disable the cron job
(`select cron.unschedule('check-feeds-hourly');`) or leave `feedSync.js`'s
config blank at any time to fall back to a purely local-storage app.
