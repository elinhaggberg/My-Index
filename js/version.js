// Bump APP_VERSION and add a CHANGELOG entry with every user-visible
// release — whatsNew.js compares this against what a returning visitor
// last saw and shows the "What's new" sheet for anything newer. Keep the
// version string in YYYY.MM.DD form (zero-padded) so plain string
// comparison sorts the same as chronological order.
export const APP_VERSION = "2026.08.03";

export const CHANGELOG = [
  {
    version: "2026.08.03",
    date: "August 3, 2026",
    changes: [
      "Cloud Sync now finishes the job: once you've connected and picked a project, \"Install RSS sync\" sets up the database tables, deploys the two sync functions, and schedules the hourly feed check automatically via Supabase's own API — no SQL editor or CLI needed. The app wires itself up to actually use it as soon as install finishes.",
      "Fixed several install bugs found during the first real tests against a live project: a scheduling step that failed on every brand-new project, that same step failing again on a second install attempt, and JWT verification silently rejecting every real sync call on projects using Supabase's newer API key format.",
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
