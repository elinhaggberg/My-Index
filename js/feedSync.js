// Client side of the optional "new content" add-on (see supabase/SETUP.md,
// or the automated Cloud Sync flow in js/cloudSyncInstall.js). Project
// URL + publishable key come from getApiConfig() -- unset until someone
// connects and installs Cloud Sync, which makes every export here a silent
// no-op until then, per the spec's "must work fully as a static
// local-storage register without it."
import { getApiConfig } from "./supabaseOAuth.js";

const DEVICE_ID_KEY = "mi_device_id_v1";

function isConfigured() {
  const config = getApiConfig();
  return Boolean(config?.url && config?.anonKey);
}

export function isFeedSyncConfigured() {
  return isConfigured();
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function callSync(action, payload) {
  const config = getApiConfig();
  if (!config?.url || !config?.anonKey) return null;
  try {
    // apikey only, deliberately no Authorization header -- the new-format
    // publishable key (sb_publishable_...) isn't a JWT, and sending it as a
    // Bearer token makes Supabase's gateway try to parse it as one and
    // reject the request as "Invalid JWT."
    const res = await fetch(`${config.url}/functions/v1/sync-index`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.anonKey },
      body: JSON.stringify({ action, deviceId: getDeviceId(), ...payload }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Offline, misconfigured, or the endpoint isn't deployed yet -- this
    // whole feature is best-effort, so failures here are never surfaced to
    // the user or allowed to block anything.
    return null;
  }
}

export async function subscribeChannel(profileId, channel) {
  if (!channel.rssUrl) return;
  await callSync("subscribe-channel", { channelId: channel.id, profileId, rssUrl: channel.rssUrl });
}

export async function unsubscribeChannel(channelId) {
  await callSync("unsubscribe-channel", { channelId });
}

// Re-syncs a profile's channel feed subscriptions to match what was just
// saved -- subscribes anything with an RSS URL, unsubscribes anything that
// used to have one and no longer does (or was removed entirely).
export async function syncProfileChannels(profileId, previousChannels, newChannels) {
  if (!isConfigured()) return;
  const newIds = new Set(newChannels.map((c) => c.id));
  for (const channel of previousChannels) {
    if (!newIds.has(channel.id) && channel.rssUrl) await unsubscribeChannel(channel.id);
  }
  for (const channel of newChannels) {
    if (channel.rssUrl) await subscribeChannel(profileId, channel);
    else await unsubscribeChannel(channel.id);
  }
}

// Merges server-tracked counts into local profile/channel records. Returns
// true if anything changed, so a caller can decide whether to re-render.
export async function fetchAndMergeCounts(getProfiles, saveProfile) {
  if (!isConfigured()) return false;
  const result = await callSync("get-counts", {});
  if (!result || !Array.isArray(result.counts) || result.counts.length === 0) return false;

  const byChannelId = new Map(result.counts.map((row) => [row.channel_id, row.new_count]));
  let changed = false;
  const profiles = await getProfiles();
  for (const profile of profiles) {
    let profileChanged = false;
    const channels = (profile.channels || []).map((c) => {
      const serverCount = byChannelId.get(c.id);
      if (serverCount != null && serverCount !== c.newCount) {
        profileChanged = true;
        return { ...c, newCount: serverCount };
      }
      return c;
    });
    if (profileChanged) {
      const newTotal = channels.reduce((sum, c) => sum + (c.newCount || 0), 0);
      await saveProfile({ ...profile, channels, newCount: newTotal });
      changed = true;
    }
  }
  return changed;
}

// One-off manual utility for Settings -- resyncs every channel that already
// has an RSS URL, for someone who added feeds before Cloud Sync was ever
// installed. subscribeChannel silently no-ops while unconfigured (see
// isConfigured() above), so any channel added/saved before install
// completed was never actually registered server-side even though it's
// been sitting in the app the whole time. Same profiles-fetcher-as-argument
// shape as fetchAndMergeCounts, for the same reason. Returns how many
// channels it resynced, so the caller can show a real count back.
export async function resyncAllChannels(getProfiles) {
  if (!isConfigured()) return 0;
  const profiles = await getProfiles();
  let count = 0;
  for (const profile of profiles) {
    for (const channel of profile.channels || []) {
      if (channel.rssUrl) {
        await subscribeChannel(profile.id, channel);
        count++;
      }
    }
  }
  return count;
}

// "Mark as read" for a whole profile at once.
export async function clearServerCounts(profileId) {
  await callSync("clear-counts", { profileId });
}

// Tapping through to one channel's actual feed link is what clears just
// that channel's badge -- see clearChannelNewCount in storage.js for the
// local-side counterpart.
export async function clearChannelServerCount(channelId) {
  await callSync("clear-channel-count", { channelId });
}

// Pulls in anything shared via the iOS Shortcut capture flow since this
// device last checked, one plain URL per queued item -- the caller turns
// each into an untagged Snippet.
export async function consumeQueuedCaptures() {
  if (!isConfigured()) return [];
  const result = await callSync("consume-captures", {});
  return result && Array.isArray(result.captures) ? result.captures.map((c) => c.url) : [];
}
