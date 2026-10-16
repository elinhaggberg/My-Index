// Shared by the Profile editor (the <select> per channel) and the Profile
// page (read-only channel list label), so the two never drift out of sync.
export const CHANNEL_TYPES = ["blog", "website", "youtube", "podcast", "newsletter", "social", "other"];

export const CHANNEL_TYPE_LABELS = {
  blog: "Blog",
  website: "Website",
  youtube: "YouTube",
  podcast: "Podcast",
  newsletter: "Newsletter",
  social: "Social",
  other: "Other",
};

// Channels whose feed opens in the in-app reader (js/views/feed.js) rather
// than the browser, when they have an RSS feed at all. Text-first for now:
// YouTube, podcast and social feeds are mostly media or very short posts,
// so they keep opening the channel itself.
export const READER_CHANNEL_TYPES = ["blog", "website", "newsletter", "other"];

export function opensInReader(channel) {
  return !!channel?.rssUrl && READER_CHANNEL_TYPES.includes(channel.type || "other");
}
