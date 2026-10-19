// Oltra-shaped profile (from any source in resolve.js) → the fields of a
// My Index profile. Follow choices come from the import dialog: a feed the
// user doesn't want to follow keeps its address in availableFeedUrl, so the
// choice can be reversed later without looking the feed up again (the
// Oltra spec, §8.1a).

import { createEmptyChannel } from "../storage.js";
import { classifyChannel } from "./classify.js";

export function toMyIndexChannels(channels, follow) {
  return channels.map((c, i) => {
    const { type, kind } = classifyChannel(c.url, { hasFeed: c.type === "feed", isHome: c.isHome });
    const followed = c.type === "feed" && follow[i] !== false;
    const channel = { ...createEmptyChannel(), type, url: c.url, rssUrl: followed ? c.feed : "" };
    if (kind) channel.kind = kind;
    if (c.type === "feed" && !followed) channel.availableFeedUrl = c.feed;
    return channel;
  });
}

export function toMyIndexFields(found) {
  const { profile, provenance } = found;
  return {
    name: profile.name,
    bio: profile.bio || "",
    pronouns: profile.pronouns || "",
    home: profile.home || "",
    // Where the profile came from, so the profile page can say so -- and so
    // a later re-check knows where to look.
    source: { type: provenance.source, url: provenance.url, fetchedAt: Date.now() },
  };
}
