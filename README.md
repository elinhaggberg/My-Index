# My Index

A personal, local-first register of people and themes you're curious about — a digital commonplace book, not a social feed. You manually discover people and ideas "old school," outside algorithmic platforms, save them here, and later browse back through your own collection instead of being served content.

Part of the **Make It Local** app suite: free, PWA, local-first, no accounts, open source.

## Why

Discovery already happens elsewhere — a blog post, a recommendation, a podcast. What's missing is a place to keep track of who and what you're curious about, on your own terms: no feed, no algorithm, no social layer, nothing served back to you.

## Core objects

- **Profile** — a person you're curious about: a name, an optional note, one or more Channels (blog, podcast, newsletter, social, other), and one or more Tags.
- **Tag** (Theme) — shared between Profiles and Snippets, with an optional pinned note. The built-in **Uncategorized** tag automatically holds any untagged Snippet so nothing gets lost.
- **Snippet** — a captured link, quote, note, book, or podcast episode, with your own comment, zero or more Tags, and optional links to one or more Profiles.

A Tag's page is auto-generated: its pinned note at the top, followed by every Profile and Snippet that references it — this is how people and ideas cross-reference each other.

## Features

- **Home**: a horizontal row of Profile tiles (most recently added first), a masonry grid of Snippets below, tag-based filtering, and a floating add button for manual capture.
- **Capture flow**: paste a link (fetches title/image automatically) or just write a quote/note, tag it, and optionally link it to one or more Profiles — no in-app browser, no required tagging at save time.
- **Profile & Tag pages**: full detail views, cross-referenced by shared tags.
- **Backup & sharing**: export a single profile, a single snippet, or a full backup as a JSON file; import always merges, never replaces.
- **Feed reader**: a blog, newsletter, or website channel with an RSS/Atom feed opens in a built-in reader: the latest posts with an unread dot for anything new since your last visit (kept locally), each post's text cleaned up and shown in-app, and "Save quote" / "Save as snippet" straight from a post. Images are decided once per feed: the first post with images says which site they'd load from and offers "Show images" or "Always for" that feed (reviewable in Customize, which also has a show-everywhere switch); embeds become plain links, and tracking pixels are always dropped. Works without any optional add-on, through the stateless `api/read-feed.js`.
- **New-post counts**: when the app is opened (and when it comes back into view, at most every half hour) it checks the feeds of every channel through `api/read-feed.js` and shows how many new posts each profile has. No account, nothing running in the background. See `js/feedCheck.js`.
- **Import a profile from a link**: paste someone's website in *New profile → Import from a link*. The page's representative h-card (parsed with the official microformats parser, loaded from a CDN on first use) fills in name, photo, bio and channels, and each feed found gets a "Follow feed" choice. Built so published Oltra profiles can slot in ahead of h-card later. See `js/profileImport/`.
- **Cloud sync add-on** *(optional)*: the iOS Shortcut capture flow (and, previously, the server-side new-content badges, now replaced by the on-open check above) — see `supabase/SETUP.md`.
- **Cloud Backup** *(optional add-on)*: connect your own free Supabase project (via OAuth, no manual setup) for a full, passphrase-protected cloud backup and sync of every Profile/Tag/Snippet, photos included — see `supabase/CLOUD_BACKUP_SETUP.md`. Off by default; the app works fully without it, and multiple Make It Local apps can share one Supabase project instead of needing one each.

## Architecture

No build step — plain HTML/CSS/JS modules, same approach as the other Make It Local apps. Profiles, Tags, and Snippets live in **IndexedDB** (this register is meant to keep growing, unlike a fixed-size collection, so it skips past `localStorage`'s ~5MB cap from the start); small preferences (theme, home title, onboarding state) stay in `localStorage`.

Two kinds of server-side pieces, both stateless and both optional except the first:

- `api/unfurl.js` — always active, a stateless Vercel serverless function that fetches a pasted URL server-side (the browser can't read cross-origin HTML itself) and extracts Open Graph metadata to build the snippet. Stores nothing — no database, no accounts.
- `api/read-feed.js` — always active, the same kind of stateless function for the feed reader: fetches a channel's feed and passes the XML back for the browser to parse. Only ever returns something that is actually a feed.
- `api/profile-source.js` — always active, stateless: fetches a pasted page's HTML (for h-card import) and a profile photo once, so it can be stored on the device without the photo's host seeing the reader.
- `api/_lib/safeFetch.js` — not an endpoint: the shared fetch used by the three functions above whenever they fetch a URL someone supplied. It refuses private, internal and cloud-metadata addresses (checked after DNS resolution, at connection time, and again on every redirect), non-web protocols and ports, and caps time and size.
- `api/oauth-*.js` and `api/cloud-sync-*.js` — inert unless Cloud Backup or RSS sync is turned on; thin proxies to Supabase's OAuth and Management API so the browser never needs Supabase's own API credentials directly. See `supabase/CLOUD_BACKUP_SETUP.md` if you're forking this repo and want Cloud Backup working on your own deployment — it needs a one-time OAuth application registration that can't be automated.

## Deploying

Deploy straight from this repo on [Vercel](https://vercel.com) — no configuration needed. It auto-detects the static site plus the `api/` serverless functions.

## License

[GNU AGPL-3.0](LICENSE). Free to use, copy, and modify — but any version you distribute or run as a hosted service has to stay open source too.
