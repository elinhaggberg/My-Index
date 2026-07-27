import { ICON_LINK, ICON_QUOTE, ICON_NOTE, ICON_BOOK, ICON_PODCAST, ICON_VIDEO, ICON_OTHER } from "./icons.js";

export const SNIPPET_TYPES = [
  { id: "link", label: "Link", icon: ICON_LINK, contentPlaceholder: "Headline or title (optional — fetch fills this in)", long: false },
  { id: "quote", label: "Quote", icon: ICON_QUOTE, contentPlaceholder: "The quote itself…", long: true },
  { id: "note", label: "Note", icon: ICON_NOTE, contentPlaceholder: "Your note…", long: true },
  { id: "book", label: "Book", icon: ICON_BOOK, contentPlaceholder: "Title", long: false },
  { id: "podcast", label: "Podcast episode", icon: ICON_PODCAST, contentPlaceholder: "Episode title", long: false },
  { id: "video", label: "Video", icon: ICON_VIDEO, contentPlaceholder: "Title (optional — fetch fills this in)", long: false },
  { id: "other", label: "Other", icon: ICON_OTHER, contentPlaceholder: "Title or description", long: false },
];

export function typeFor(id) {
  return SNIPPET_TYPES.find((t) => t.id === id) || SNIPPET_TYPES[0];
}
