// Client side of the optional "new content" add-on (see supabase/SETUP.md).
// Left unconfigured (both values blank) by default, which makes every
// export here a silent no-op -- the app works identically without any of
// this, per the spec's "must work fully as a static local-storage register
// without it." Fill these in only after completing supabase/SETUP.md.
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

const DEVICE_ID_KEY = "mi_device_id_v1";

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
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
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-index`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
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

export async function clearServerCounts(profileId) {
  await callSync("clear-counts", { profileId });
}

// Pulls in anything shared via the iOS Shortcut capture flow since this
// device last checked, one plain URL per queued item -- the caller turns
// each into an untagged Snippet.
export async function consumeQueuedCaptures() {
  if (!isConfigured()) return [];
  const result = await callSync("consume-captures", {});
  return result && Array.isArray(result.captures) ? result.captures.map((c) => c.url) : [];
}
