// Client-facing endpoint for Cloud Backup's image sync -- moves an
// uploaded photo's actual bytes into this project's private Storage
// bucket instead of inlining them as a data: URI inside a synced record
// (see js/cloudImageSync.js), and mints short-lived signed URLs so a
// device that pulled a "storage:" reference can fetch the bytes directly
// from Storage's own CDN rather than proxying them back through this
// function. Same passphrase-gated access model as backup-sync/index.ts --
// deployed with verify_jwt: false since the publishable key isn't
// JWT-shaped, and the bucket itself is fully private with no RLS policy
// granting the anon key any access at all; this function's service-role
// client is the only thing that can ever reach it.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "backup-images";
const SIGNED_URL_TTL_SECONDS = 3600;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-passphrase",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const PASSPHRASE = Deno.env.get("BACKUP_PASSPHRASE");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Every record's own client-side id already doubles as its image-store key
// (see js/imageStore.js), so the object path can be derived directly from
// the store + record id a caller already has -- no separate manifest of
// "which records have an uploaded image" needs to be kept anywhere.
function objectPath(store: string, recordId: string) {
  return `${store}/${recordId}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!PASSPHRASE || req.headers.get("x-backup-passphrase") !== PASSPHRASE) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = url.searchParams.get("store");
  const recordId = url.searchParams.get("recordId");
  if (!store || !recordId) return json({ error: "Missing store or recordId" }, 400);
  const path = objectPath(store, recordId);

  try {
    switch (action) {
      // Uploads (or replaces) this record's image. Raw bytes in the request
      // body, not JSON -- avoids the ~33% base64 inflation a JSON payload
      // would cost for what's already a resized photo (see
      // js/imageBlob.js's MAX_DIMENSION).
      case "upload": {
        if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
        const bytes = await req.arrayBuffer();
        const contentType = req.headers.get("content-type") || "image/jpeg";
        const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
        if (error) throw error;
        return json({ ok: true });
      }

      // A signed URL rather than streaming bytes back through this function
      // -- the client fetches directly from Storage's own CDN with the
      // access token already embedded in the URL, since a plain <img src>
      // or fetch() from resolveImageSrc has no way to send a custom auth
      // header on that second request.
      case "url": {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (error) throw error;
        return json({ url: data.signedUrl });
      }

      // Best-effort cleanup once a record's tombstone has synced. A missing
      // object isn't an error here -- a record whose image was never
      // actually uploaded (or never had one) still needs its tombstone
      // handled through this same call.
      case "delete": {
        await supabase.storage.from(BUCKET).remove([path]);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
