// Single entry point the client calls to manage its own tracked feeds and
// pull down badge counts / queued captures. Uses the service role key
// (auto-injected into every Edge Function's environment, never stored in
// this repo) to reach the tables, since the anon key has zero direct access
// to them (see supabase/schema.sql).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function isValidDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, deviceId } = body;
  if (!isValidDeviceId(deviceId)) return json({ error: "Invalid device id" }, 400);

  try {
    switch (action) {
      // Registers (or updates) one Channel's RSS feed for polling. Called
      // whenever a Profile with a channel.rssUrl is saved -- upsert keeps
      // this idempotent, so saving the same channel again just updates the
      // URL rather than duplicating anything.
      case "subscribe-channel": {
        const { channelId, profileId, rssUrl } = body as { channelId: string; profileId: string; rssUrl: string };
        if (!channelId || !profileId || !rssUrl) return json({ error: "Missing channel fields" }, 400);
        const { error } = await supabase.from("channel_feeds").upsert({
          channel_id: channelId,
          device_id: deviceId,
          profile_id: profileId,
          rss_url: rssUrl,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return json({ ok: true });
      }

      // Called when a channel is removed or its rssUrl is cleared, so
      // check-feeds stops polling it.
      case "unsubscribe-channel": {
        const { channelId } = body as { channelId: string };
        if (!channelId) return json({ error: "Missing channelId" }, 400);
        const { error } = await supabase
          .from("channel_feeds")
          .delete()
          .eq("device_id", deviceId)
          .eq("channel_id", channelId);
        if (error) throw error;
        return json({ ok: true });
      }

      // Polled by the client (e.g. on Home load) to merge server-tracked
      // new-item counts into local badges -- grouped by profile_id since
      // that's the level the badge actually shows at.
      case "get-counts": {
        const { data, error } = await supabase
          .from("channel_feeds")
          .select("channel_id, profile_id, new_count")
          .eq("device_id", deviceId);
        if (error) throw error;
        return json({ counts: data ?? [] });
      }

      // Visiting a Profile's page clears its badge -- zero every channel
      // this device tracks for that profile.
      case "clear-counts": {
        const { profileId } = body as { profileId: string };
        if (!profileId) return json({ error: "Missing profileId" }, 400);
        const { error } = await supabase
          .from("channel_feeds")
          .update({ new_count: 0 })
          .eq("device_id", deviceId)
          .eq("profile_id", profileId);
        if (error) throw error;
        return json({ ok: true });
      }

      // Called by the iOS Shortcut capture flow (POSTed directly, not from
      // the app) -- queues a shared link for this device to pick up next
      // time it opens the app, landing as an untagged ("Uncategorized")
      // Snippet. Nothing else about the link is stored or inspected here.
      case "capture": {
        const { url } = body as { url: string };
        if (!url || typeof url !== "string") return json({ error: "Missing url" }, 400);
        const { error } = await supabase.from("pending_captures").insert({ device_id: deviceId, url });
        if (error) throw error;
        return json({ ok: true });
      }

      // Polled by the client on open -- returns and clears any links
      // captured via the Shortcut flow since the last time the app ran.
      case "consume-captures": {
        const { data, error } = await supabase
          .from("pending_captures")
          .select("id, url, created_at")
          .eq("device_id", deviceId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        if (data && data.length) {
          const ids = data.map((row) => row.id);
          await supabase.from("pending_captures").delete().in("id", ids);
        }
        return json({ captures: data ?? [] });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
