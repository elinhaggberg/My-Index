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
- **New-content badges** *(optional add-on)*: a lightweight backend can poll each Channel's RSS feed on a schedule and show a "new items" count on its Profile, cleared on visit — see `supabase/SETUP.md`. The app works fully without it.

## Architecture

No build step — plain HTML/CSS/JS modules, same approach as the other Make It Local apps. Profiles, Tags, and Snippets live in **IndexedDB** (this register is meant to keep growing, unlike a fixed-size collection, so it skips past `localStorage`'s ~5MB cap from the start); small preferences (theme, home title, onboarding state) stay in `localStorage`.

The only server-side piece is `api/unfurl.js`, a stateless Vercel serverless function that fetches a pasted URL server-side (the browser can't read cross-origin HTML itself) and extracts Open Graph metadata to build the snippet. It stores nothing — no database, no accounts.

## Deploying

Deploy straight from this repo on [Vercel](https://vercel.com) — no configuration needed. It auto-detects the static site plus the `api/` serverless function.

## License

[GNU AGPL-3.0](LICENSE). Free to use, copy, and modify — but any version you distribute or run as a hosted service has to stay open source too.
