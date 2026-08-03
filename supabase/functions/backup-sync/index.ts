// Client-facing Cloud Backup endpoint. Deployed with verify_jwt: false
// (see js/cloudSyncInstall.js) since the publishable key isn't JWT-shaped --
// the backup passphrase below is what actually authorizes every request,
// not the platform's own JWT gate.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-passphrase",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Set once during Cloud Backup install (see api/cloud-sync-secret.js) and
// never stored anywhere else server-side -- this header check is the only
// thing standing between the public anon key and your actual notes and
// profiles, so unlike channel_feeds' device_id (a loose per-device scope
// fine for low-stakes RSS metadata), this has to be a real secret.
const PASSPHRASE = Deno.env.get("BACKUP_PASSPHRASE");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!PASSPHRASE || req.headers.get("x-backup-passphrase") !== PASSPHRASE) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action } = body;

  try {
    switch (action) {
      // Uploads locally-changed records. Last-write-wins per record, by
      // comparing updated_at -- a record older than (or equal to) what's
      // already stored is silently skipped rather than clobbering a newer
      // write from another device. One read + one write per record rather
      // than a single bulk statement, which is plenty fast at
      // personal-register scale (dozens to low hundreds of records) and
      // much easier to follow than a conditional-upsert one-liner.
      case "push": {
        const { records } = body as {
          records: Array<{ store: string; recordId: string; data: unknown; updatedAt: string; deleted?: boolean }>;
        };
        if (!Array.isArray(records)) return json({ error: "Missing records" }, 400);

        let applied = 0;
        for (const r of records) {
          if (!r.store || !r.recordId || !r.updatedAt) continue;
          const { data: existing } = await supabase
            .from("backup_records")
            .select("updated_at")
            .eq("store", r.store)
            .eq("record_id", r.recordId)
            .maybeSingle();
          if (existing && new Date(existing.updated_at) >= new Date(r.updatedAt)) continue;

          const { error } = await supabase.from("backup_records").upsert({
            store: r.store,
            record_id: r.recordId,
            data: r.data ?? null,
            updated_at: r.updatedAt,
            deleted: Boolean(r.deleted),
          });
          if (error) throw error;
          applied++;
        }
        return json({ applied });
      }

      // Downloads everything changed since a given time (or everything, for
      // a fresh device's first restore). The caller decides what "since"
      // to pass -- this endpoint doesn't track per-device sync state.
      case "pull": {
        const { since } = body as { since?: string };
        let query = supabase.from("backup_records").select("store, record_id, data, updated_at, deleted");
        if (since) query = query.gt("updated_at", since);
        const { data, error } = await query;
        if (error) throw error;
        return json({ records: data ?? [], pulledAt: new Date().toISOString() });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
