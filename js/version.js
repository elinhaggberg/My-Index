// Bump APP_VERSION and add a CHANGELOG entry with every user-visible
// release — whatsNew.js compares this against what a returning visitor
// last saw and shows the "What's new" sheet for anything newer. Keep the
// version string in YYYY.MM.DD form (zero-padded) so plain string
// comparison sorts the same as chronological order.
export const APP_VERSION = "2026.07.27";

export const CHANGELOG = [
  {
    version: "2026.07.27",
    date: "July 27, 2026",
    changes: ["My Index launches: save people and themes you're curious about, tag them, and cross-reference them from either direction."],
  },
];
