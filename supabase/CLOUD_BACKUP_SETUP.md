# Optional add-on: Cloud Backup

**As of Cloud Sync in Settings, none of this needs to be done by hand** —
Settings → Cloud sync → Connect Supabase → pick a project → Install Cloud
Backup runs every step below automatically via Supabase's Management API,
through an OAuth connection instead of you pasting keys or running SQL
yourself. This file documents what that automated install actually does,
the one step that genuinely can't be automated (registering the OAuth
application itself, since it needs your own Supabase login), and the
multi-app "shared project" pattern if you're forking more than one Make It
Local app.

**None of this is required** — My Index works fully as a local-only
IndexedDB/localStorage app without it.

## What it does

- Backs up all your Profiles, Tags, and Snippets to a Supabase project you
  own: one Postgres table (`backup_records`) plus two Edge Functions
  (`backup-sync` for the data, `backup-image` for photo bytes), all gated
  behind a passphrase only your own devices know.
- Photo uploads (Profile avatars, Tag covers, Snippet images) go to the
  project's own private Storage bucket instead of being inlined in the
  synced record — a device only downloads a given image the first time it's
  actually displayed (a lazy-loaded card scrolling into view, say), then
  caches it locally so every later open is instant.
- A second device, or a sibling Make It Local app, can join the same
  project instead of setting up its own — see "Sharing one project across
  multiple apps" below.

## One-time setup only you can do: register the OAuth application

My Index (and each other Make It Local app with Cloud Sync) needs its own
registered Supabase OAuth application so "Connect Supabase" can act on your
behalf via the Management API. This step can't be automated — it requires
your own Supabase login — and has to be done once per app you deploy, since
the redirect URI is tied to that app's own domain.

1. Go to your Supabase organization's **OAuth Apps** settings
   (`https://supabase.com/dashboard/org/_/apps` — pick your org first) →
   **Add application**.
2. Name it anything (e.g. "My Index Cloud Sync") and set its redirect URI
   to exactly `https://<your deployed domain>/api/oauth-callback`.
3. **Grant it every available permission/scope the form offers.** Cloud
   Sync's install flow calls a wide range of Management API endpoints —
   listing projects, reading and *revealing* API keys, listing and
   deploying Edge Functions, writing secrets, running SQL (which is also
   what creates the Storage bucket) — and Supabase's dashboard lets you
   scope an OAuth app's permissions narrowly, per resource area. A
   narrower grant here is the single most common way this breaks in
   practice: one missing scope surfaces as a 403 on exactly one step
   (e.g. a `edge_functions_secrets_write` scope missing shows up only when
   setting the backup passphrase secret, or a missing Storage scope only
   when the bucket gets created) while everything else keeps working fine
   — which reads like an intermittent bug but is really just an
   under-scoped app. For a personal, single-user OAuth app like this one,
   granting full access up front avoids this whole category of confusing,
   step-specific failures.
4. Copy the **client_id** and **client_secret** Supabase gives you — the
   secret is normally only shown once, so save it somewhere before leaving
   the page.
5. Put the **client_id** in exactly three places, all of which must match:
   `js/supabaseOAuth.js`, `api/oauth-callback.js`, and `api/oauth-refresh.js`.
6. Set `SUPABASE_OAUTH_CLIENT_SECRET` as an environment variable on your
   deployment (Vercel → this project → Settings → Environment Variables).
   **Never commit the secret to the repo** — it stays server-side only,
   read via `process.env`.

If you ever move the app to a new domain, update the redirect URI in both
places — the OAuth app's own settings in Supabase, and (if it changed) the
CLIENT_ID constants — since they have to keep agreeing.

## Sharing one project across multiple Make It Local apps

Supabase's free tier caps you at a couple of projects, so if you're running
several of these apps, Cloud Sync is built to let them all back up to the
*same* project instead of needing one each:

- `backup_records`' `store` column has no database-level restriction on
  which record types it'll accept — each app only ever reads and writes
  its own record type client-side (see `js/cloudBackup.js`'s
  `SYNCABLE_STORES`), so multiple apps' data coexists safely in the same
  table without any schema conflict.
- The first app you connect a given project to runs the full install
  (schema, passphrase, function deploys). Connecting a **second** app to
  that same project detects this automatically and shows **"Add this
  app"** — a single passphrase field instead of a full install, so it
  never generates a conflicting new secret that would silently break sync
  for whatever's already using that project.
- Get that passphrase from any already-connected app via Settings → Cloud
  sync → **Copy passphrase** (a plain-text copy of just the passphrase —
  distinct from the "pairing code" used for the no-OAuth-login restore path
  below, which bundles three values together for a different scenario).
- Each app you connect still needs its own registered OAuth application
  from the section above (redirect URIs are per-domain), even though they
  end up sharing one Supabase project underneath.

## Restoring on a second device without Supabase login

Settings → Cloud sync → **Restore from Cloud**, using a pairing code
copied from an already-connected device (Settings → Cloud sync → **Show
pairing code**). This bundles the project URL, publishable key, and
passphrase together, for a device that has no access to your Supabase
account at all. If the device *does* have Supabase access, prefer Connect
Supabase + "Add this app" instead — that path also re-applies the schema
(harmless if nothing's changed, and self-healing if it has), which the
pairing-code restore intentionally skips.
