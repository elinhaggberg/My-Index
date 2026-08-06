// Triggered on a schedule by pg_cron (see supabase/cron_setup.sql), not by
// the client. Walks every tracked channel_feeds row, fetches its RSS/Atom
// feed, and counts how many items are new since the last check (by GUID/id,
// falling back to the link if a feed has neither) -- adds that count to
// new_count rather than replacing it, so counts accumulate between visits
// exactly like unread mail. Never fetches, stores, or returns article
// content beyond the single id used to detect "new".
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// JWT verification is disabled for this function (it's called by pg_cron,
// which can't present a user JWT -- see supabase/SETUP.md), so this shared
// secret header check replaces it, otherwise the endpoint would be wide open.
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const FETCH_TIMEOUT_MS = 8000;
const MAX_FEEDS_PER_RUN = 200;
// Matches api/discover-feed.js's User-Agent (proven to get through
// Substack's Cloudflare bot protection when a channel's feed is first
// discovered) plus an Accept header identifying this as a feed reader --
// the plain "MyIndexApp/1.0 (RSS check)" UA this used before had no
// "Mozilla" token and no Accept header, which is exactly the fingerprint
// Cloudflare's bot-fight mode targets, so a Substack feed's periodic check
// could silently come back blocked (a non-200, or a 200 challenge page
// with no <item>/<entry> tags) while the same URL fetched fine at
// discovery time through discover-feed.js's more browser-like request.
const USER_AGENT = "Mozilla/5.0 (compatible; MyIndexApp/1.0; +https://vercel.com)";
const ACCEPT_HEADER = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";

type FeedItem = { id: string; date: Date | null };

function extractItems(xml: string): FeedItem[] {
  // Minimal, dependency-free RSS 2.0 (<item><guid>/<link>) and Atom
  // (<entry><id>) parsing via regex -- good enough to detect "something
  // new arrived," not meant to be a full feed reader.
  const items: FeedItem[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const block of itemBlocks) {
    const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || block.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || block.match(/<link[^>]+href=["']([^"']*)["']/i);
    const id = (guid ? guid[1] : link ? link[1] : "").trim();
    if (!id) continue;
    const dateMatch =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
      block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) ||
      block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);
    const parsed = dateMatch ? new Date(dateMatch[1].trim()) : null;
    items.push({ id, date: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null });
  }
  return items;
}

// Almost every feed lists newest-first, and this used to just trust that --
// but a feed that doesn't (found via a channel that had known new posts and
// still never badged: its guid never changed because "newest" was actually
// the *oldest* item, whose position never moves as new ones get appended at
// the end) makes that assumption silently wrong. Re-sort by each item's own
// published/updated date when every item in the feed has a parseable one --
// that's a real signal independent of document order. If any item is
// missing a date, there's no reliable way to compare, so fall back to
// trusting document order, same as before.
function orderNewestFirst(items: FeedItem[]): FeedItem[] {
  if (items.length === 0 || items.some((item) => !item.date)) return items;
  return [...items].sort((a, b) => b.date!.getTime() - a.date!.getTime());
}

async function fetchFeedItems(url: string): Promise<{ items: FeedItem[]; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT, Accept: ACCEPT_HEADER } });
    if (!res.ok) {
      // Logged (not just swallowed) so a blocked/rejected feed shows up in
      // the function's Logs tab instead of just silently never updating --
      // this was previously indistinguishable from "feed has no new items."
      console.error(`check-feeds: ${url} responded ${res.status}`);
      return { items: [], error: `HTTP ${res.status}` };
    }
    const xml = await res.text();
    const items = extractItems(xml);
    if (items.length === 0) {
      // Include where the request actually ended up (a silent redirect --
      // e.g. to an HTML page instead of the feed, as happened with a
      // Substack account that no longer serves one at its old URL -- would
      // otherwise look identical to a feed that's just empty) and a
      // truncated snippet of what came back, since there's no other way to
      // see the real response body without direct network access to the
      // target site.
      console.error(
        `check-feeds: ${url} returned 200 (final URL: ${res.url}) but no <item>/<entry> tags were found. Body starts: ${xml.slice(0, 300).replace(/\s+/g, " ")}`
      );
    }
    return { items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`check-feeds: ${url} fetch failed: ${message}`);
    return { items: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}

type FeedResult = { channel_id: string; rss_url: string; error?: string; newCount?: number };

// One feed's whole fetch-compare-update cycle, run concurrently across every
// tracked feed (see Promise.all below) rather than one at a time -- with up
// to FETCH_TIMEOUT_MS per feed, a sequential loop over even a handful of
// feeds could take well past a caller's patience (pg_cron's net.http_post
// gives up after its own timeout_milliseconds, see cron_setup.sql) even
// though this function was still working fine, just slowly. Running them in
// parallel keeps total wall time close to a single feed's worst case
// regardless of how many are tracked.
async function processFeed(feed: { channel_id: string; rss_url: string; last_seen_guid: string | null }): Promise<FeedResult> {
  const { items: rawItems, error: fetchError } = await fetchFeedItems(feed.rss_url);
  const ids = orderNewestFirst(rawItems).map((item) => item.id);
  if (ids.length === 0) {
    await supabase.from("channel_feeds").update({ last_checked_at: new Date().toISOString() }).eq("channel_id", feed.channel_id);
    return { channel_id: feed.channel_id, rss_url: feed.rss_url, error: fetchError || "no items found in feed" };
  }

  const newestId = ids[0];
  if (!feed.last_seen_guid) {
    // First check for this feed: nothing to compare against yet, so just
    // record where we are now rather than counting the whole backlog as
    // "new" (which would badge every profile the moment it's first added).
    await supabase
      .from("channel_feeds")
      .update({ last_seen_guid: newestId, last_checked_at: new Date().toISOString() })
      .eq("channel_id", feed.channel_id);
    return { channel_id: feed.channel_id, rss_url: feed.rss_url, error: "first check, baseline recorded" };
  }

  const knownIndex = ids.indexOf(feed.last_seen_guid);
  const newCount = knownIndex === -1 ? 1 : knownIndex; // unknown feed shape/rewritten guids: assume at least 1 rather than the whole list
  if (newCount > 0) {
    const { error: rpcError } = await supabase.rpc("increment_channel_new_count", {
      p_channel_id: feed.channel_id,
      p_amount: newCount,
      p_last_seen_guid: newestId,
    });
    if (!rpcError) return { channel_id: feed.channel_id, rss_url: feed.rss_url, newCount };
    return { channel_id: feed.channel_id, rss_url: feed.rss_url, error: rpcError.message };
  }

  await supabase.from("channel_feeds").update({ last_checked_at: new Date().toISOString() }).eq("channel_id", feed.channel_id);
  return { channel_id: feed.channel_id, rss_url: feed.rss_url, newCount: 0 };
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { data: feeds, error } = await supabase
    .from("channel_feeds")
    .select("channel_id, rss_url, last_seen_guid")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_FEEDS_PER_RUN);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  // Per-feed outcome, returned in the response -- lets a manual invocation
  // (curl/dashboard "Invoke") show exactly which feeds failed and why,
  // rather than needing to cross-reference the Logs tab separately.
  const results = await Promise.all((feeds ?? []).map(processFeed));
  const checked = results.length;
  const updated = results.filter((r) => (r.newCount ?? 0) > 0).length;

  return new Response(JSON.stringify({ checked, updated, results }), { headers: { "Content-Type": "application/json" } });
});
