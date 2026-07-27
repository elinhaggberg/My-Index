// Bump APP_VERSION and add a CHANGELOG entry with every user-visible
// release — whatsNew.js compares this against what a returning visitor
// last saw and shows the "What's new" sheet for anything newer. Keep the
// version string in YYYY.MM.DD form (zero-padded) so plain string
// comparison sorts the same as chronological order.
export const APP_VERSION = "2026.07.29";

export const CHANGELOG = [
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
