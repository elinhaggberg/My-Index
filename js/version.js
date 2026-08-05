// Bump APP_VERSION and add a CHANGELOG entry with every user-visible
// release — whatsNew.js compares this against what a returning visitor
// last saw and shows the "What's new" sheet for anything newer. Keep the
// version string in YYYY.MM.DD form (zero-padded) so plain string
// comparison sorts the same as chronological order.
export const APP_VERSION = "2026.08.05.3";

export const CHANGELOG = [
  {
    version: "2026.08.05.3",
    date: "August 5, 2026",
    changes: [
      "Cloud Sync now detects when the Supabase project you've picked already has Cloud Backup set up -- by another Make It Local app, or this same app on another device -- and offers to add this app to it with just its passphrase, instead of silently generating a new one and breaking whatever's already using that project. Makes it possible to back up multiple sibling apps to a single free-tier project.",
    ],
  },
  {
    version: "2026.08.05.2",
    date: "August 5, 2026",
    changes: [
      "Cloud Backup now uploads photos to your own connected Supabase project's storage instead of embedding them directly in each synced record -- a second device only downloads a photo once it's actually scrolled into view, instead of every photo downloading up front on every sync. Existing installs pick this up next time Cloud Backup reinstalls itself (Settings → Cloud sync → Manage connection → Install, safe to run again).",
    ],
  },
  {
    version: "2026.08.05",
    date: "August 5, 2026",
    changes: [
      "Snippet grids (Home, a Tag's page, a Profile's page, and Search) now load images as you scroll to them instead of all at once -- keeps things smooth once you've saved a lot of photos, since nothing behind the fold does an IndexedDB lookup until you actually scroll near it.",
      "Home now warns once local storage gets close to full, instead of the first sign of trouble being a failed save.",
    ],
  },
  {
    version: "2026.08.03",
    date: "August 3, 2026",
    changes: [
      "Cloud Sync now offers a second, independent feature: Cloud Backup, which backs up and syncs all your profiles, tags, and snippets (not just RSS badges) to your own connected Supabase project. Protected by a passphrase generated on install — treat it like a password, since it's the only thing gating access to your data once the project itself is public-key-reachable. Syncs automatically every 15 minutes and whenever the app comes back into view, plus an on-demand \"Sync now\" button.",
      "Cloud sync's install flow now shows checkboxes for RSS sync and Cloud Backup so you can turn on either, both, or add the other later — each installs independently and remembers what's already set up per project.",
      "Added \"Restore from Cloud\" for a second device: paste a pairing code from a device where Cloud Backup is already running (shown via \"Show pairing code\" in Cloud sync) to connect and pull your data down, without that second device ever needing its own Supabase login.",
      "Adding a channel to a Profile now looks for its RSS feed automatically as soon as you leave the URL field — a Substack share link, a YouTube channel, a blog's homepage — instead of needing the feed URL by hand. If nothing's found, the RSS feed field appears underneath for manual entry, which is checked the same way as soon as you leave it.",
      "Connecting Supabase now walks through it step by step — create a free account, create a project, then connect — instead of dropping you straight into an OAuth screen with no context if you'd never used Supabase before. Skips straight back to the Connect step next time if you've already been through it once.",
      "The \"back up your data\" reminder every couple weeks no longer shows up once Cloud Backup is turned on, since it's already syncing your data on its own by then.",
      "\"Restore from Cloud\" now has its own headline and button, separated from the account-setup steps above it, instead of being buried inline in a sentence.",
      "Deleting a profile, tag, or snippet now propagates through Cloud Backup — removing something on one device removes it everywhere else too, closing the gap from Cloud Backup's first release where a deletion just quietly never left the device it happened on.",
      "The profile row on Home can now be turned off from Settings → Customize, if you find it distracting — on by default, nothing about your saved Profiles changes either way, just whether the row shows on Home.",
      "Uploaded photos (Profile avatars, Tag covers, Image snippets) now live in their own separate storage instead of being embedded directly in the same record as everything else — keeps ordinary browsing fast as your photo collection grows, since listing/searching no longer has to load image bytes just to read a title. Existing photos migrate over automatically, once, the next time you open the app; nothing needs to be redone by hand.",
      "Export/share for a Profile moved from the edit screen to the profile page itself, next to Edit — no need to open editing just to share someone.",
      "Cloud sync now shows a loading indicator while it fetches your Supabase projects, instead of a blank panel that looked like it wasn't working for the couple seconds that takes.",
      "Cloud sync's panel cleans itself up once something's actually installed — shows a quick \"RSS sync ✓ / Cloud Backup ✓\" summary instead of the full project picker and install checklist every time, with a \"Manage connection\" button to bring those back if you need to switch projects, add the other feature, or disconnect.",
      "Cloud Sync now finishes the job: once you've connected and picked a project, \"Install RSS sync\" sets up the database tables, deploys the two sync functions, and schedules the hourly feed check automatically via Supabase's own API — no SQL editor or CLI needed. The app wires itself up to actually use it as soon as install finishes.",
      "Fixed several install bugs found during the first real tests against a live project: a scheduling step that failed on every brand-new project, that same step failing again on a second install attempt, and JWT verification silently rejecting every real sync call on projects using Supabase's newer API key format.",
      "Added \"Resync all channels\" to Cloud Sync, for anyone who added RSS feeds to profiles before installing — those were never registered while it was off, so this fixes them all at once instead of re-saving every profile by hand.",
      "Install/Resync buttons now show a spinner and gray out while working, instead of looking identical to normal while quietly doing several seconds of work in the background.",
      "Home's top profile row now surfaces profiles with new RSS content first, instead of just sitting in their usual place with a badge — the Profiles tab's own sort is unchanged.",
      "New-content badges are now tinted in your accent color instead of red, so \"something new\" doesn't read as an urgent alert.",
      "Fixed a Profile page channel badge that could never actually show — it now displays what was new for the one visit where you open it, then clears, instead of always reading zero.",
    ],
  },
  {
    version: "2026.08.02",
    date: "August 2, 2026",
    changes: [
      "Early first step of \"bring your own database\" Cloud Sync: a new Cloud sync entry in the gear menu can connect your own Supabase project via OAuth, then pick which of your Supabase projects is My Index's (the connection can see every project in your account, not just one). The actual schema/RSS-sync setup on top of it is still to come, so this is just the plumbing for now.",
    ],
  },
  {
    version: "2026.08.01",
    date: "August 1, 2026",
    changes: [
      "Added an App Library link in the gear menu, pointing to the Make it Local App Library of sibling apps.",
    ],
  },
  {
    version: "2026.07.31",
    date: "July 31, 2026",
    changes: [
      "Saving a snippet can connect it to a Profile again, now via a searchable picker underneath Tags.",
      "Added an Image snippet type — upload a photo from Camera/Library, or fetch one from a link.",
      "Tags and Profiles in the Snippet/Profile editors now open in a search-and-pick sheet instead of listing every option inline, so they stay usable as your lists grow.",
    ],
  },
  {
    version: "2026.07.30",
    date: "July 30, 2026",
    changes: [
      "Profiles now have a \"Recent mentions on Google\" link, searching that person's name restricted to the past month.",
    ],
  },
  {
    version: "2026.07.29",
    date: "July 29, 2026",
    changes: [
      "Added YouTube and Website as Profile channel types.",
      "Added a Video snippet type, and fixed link fetching for YouTube URLs (it now uses YouTube's own oEmbed data instead of scraping the page, which YouTube often blocks).",
      "Other and Quote snippets now have their own distinct icons instead of sharing one with Link.",
      "Profile names in the Home row can wrap to two lines instead of cutting off.",
    ],
  },
  {
    version: "2026.07.28",
    date: "July 28, 2026",
    changes: [
      "New Profiles tab, with sort (recent/alphabetical), tag filtering, and search.",
      "Home's filter now covers several tags at once, a date range, and snippet type, plus a free-text search — the headline now names what's filtered, with a Clear button.",
      "Profiles and Tags can have a photo/cover image now, from Camera or Library.",
      "Snippet cards are more compact when there's no image, since this app isn't a photo library.",
      "Saving a snippet no longer offers to link it to a Profile there — link it from the Profile's own page instead.",
    ],
  },
  {
    version: "2026.07.27",
    date: "July 27, 2026",
    changes: ["My Index launches: save people and themes you're curious about, tag them, and cross-reference them from either direction."],
  },
];
