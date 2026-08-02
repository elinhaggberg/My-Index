// Sets an Edge Function secret (e.g. CRON_SECRET) on the user's connected
// Supabase project, via the Management API (POST /v1/projects/{ref}/secrets
// -- confirmed against Supabase's own OpenAPI spec). Used once during
// install by js/cloudSyncInstall.js. The value passes straight through
// from the client to Supabase; it's never logged or stored here.
const REF_PATTERN = /^[a-z]+$/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

  const { ref, name, value } = req.body || {};
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
    res.status(400).json({ error: "Invalid project ref." });
    return;
  }
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.startsWith("SUPABASE_")) {
    res.status(400).json({ error: "Invalid secret name." });
    return;
  }
  if (typeof value !== "string" || !value) {
    res.status(400).json({ error: "Missing secret value." });
    return;
  }

  try {
    const upstream = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([{ name, value }]),
    });
    const text = await upstream.text();
    const data = text ? JSON.parse(text) : null;
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: (data && (data.message || data.error)) || "Supabase rejected that secret." });
      return;
    }
    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ error: "Network error while reaching Supabase." });
  }
};
