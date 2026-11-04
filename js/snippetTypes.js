import { ICON_LINK, ICON_QUOTE, ICON_NOTE, ICON_POEM, ICON_BOOK, ICON_PODCAST, ICON_VIDEO, ICON_IMAGE, ICON_OTHER } from "./icons.js";

// excerpt: a passage taken from somewhere (a quote, a note on something
// read, a poem) -- can point to the snippet it came from, with a page.
// source: something excerpts can come from (an article, a book, an episode).
// imageUpload: offers Camera/Library for its own picture (an Image, a
// book's cover) rather than only a fetched link preview.
// Both are ordinary snippets; see js/sources.js for how they're connected.
export const SNIPPET_TYPES = [
  { id: "link", label: "Link", icon: ICON_LINK, contentPlaceholder: "Headline or title (optional — fetch fills this in)", long: false, source: true },
  { id: "quote", label: "Quote", icon: ICON_QUOTE, contentPlaceholder: "The quote itself…", long: true, hasAuthor: true, excerpt: true },
  { id: "note", label: "Note", icon: ICON_NOTE, contentPlaceholder: "Your note…", long: true, excerpt: true },
  { id: "poem", label: "Poem", icon: ICON_POEM, contentPlaceholder: "The poem…", long: true, hasTitle: true, hasAuthor: true, excerpt: true },
  { id: "book", label: "Book", icon: ICON_BOOK, contentPlaceholder: "Title", long: false, hasAuthor: true, source: true, imageUpload: true },
  { id: "podcast", label: "Podcast episode", icon: ICON_PODCAST, contentPlaceholder: "Episode title", long: false, source: true },
  { id: "video", label: "Video", icon: ICON_VIDEO, contentPlaceholder: "Title (optional — fetch fills this in)", long: false, source: true },
  { id: "image", label: "Image", icon: ICON_IMAGE, contentPlaceholder: "Caption (optional)", long: false, imageUpload: true },
  { id: "other", label: "Other", icon: ICON_OTHER, contentPlaceholder: "Title or description", long: false, source: true },
];

export function typeFor(id) {
  return SNIPPET_TYPES.find((t) => t.id === id) || SNIPPET_TYPES[0];
}
