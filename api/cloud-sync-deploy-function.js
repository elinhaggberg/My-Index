// Deploys one Edge Function to the user's connected Supabase project, via
// the Management API (POST /v1/projects/{ref}/functions/deploy?slug=...,
// multipart/form-data -- confirmed against Supabase's own OpenAPI spec).
// "Deploy" is an upsert: it creates the function if it doesn't exist yet,
// or updates it in place otherwise, so this is safe to call again if a
// previous install attempt failed partway through.
//
// The client sends plain JSON (source as a string); this function builds
// the actual multipart body server-side using Node's built-in FormData/Blob
// rather than asking the browser to construct multipart itself or trying to
// pipe a raw stream through -- much simpler to get right than either.
//
// verify_jwt is part of the same request: setting it false here is what
// the manual setup docs call "turning off Enforce JWT Verification" for
// check-feeds (it's called by pg_cron, which can't present a user JWT).
const REF_PATTERN = /^[a-z]+$/;
const SLUG_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing access token." });
    return;
  }

  const { ref, slug, name, verifyJwt, source } = req.body || {};
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
    res.status(400).json({ error: "Invalid project ref." });
    return;
  }
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    res.status(400).json({ error: "Invalid function slug." });
    return;
  }
  if (typeof source !== "string" || !source.trim()) {
    res.status(400).json({ error: "Missing function source." });
    return;
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([source], { type: "application/typescript" }), "index.ts");
    form.append(
      "metadata",
      JSON.stringify({
        entrypoint_path: "index.ts",
        verify_jwt: Boolean(verifyJwt),
        name: name || slug,
      })
    );

    const upstream = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { Authorization: auth },
      body: form,
    });
    const text = await upstream.text();
    const data = text ? JSON.parse(text) : null;
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: (data && (data.message || data.error)) || `Couldn't deploy ${slug}.` });
      return;
    }
    res.status(200).json({ ok: true, result: data });
  } catch {
    res.status(502).json({ error: "Network error while reaching Supabase." });
  }
};
