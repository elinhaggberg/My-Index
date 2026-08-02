// Runs a SQL statement against the user's own connected Supabase project's
// database, via the Management API's "Run a query" endpoint
// (POST /v1/projects/{ref}/database/query -- confirmed against Supabase's
// own OpenAPI spec, since their docs pages block automated fetches). Used
// by js/cloudSyncInstall.js to apply supabase/schema.sql and
// supabase/cron_setup.sql without the user ever opening the SQL editor
// themselves. The user's own OAuth access token passes through untouched;
// this never sees or needs the OAuth app's client secret.
const REF_PATTERN = /^[a-z]+$/;

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

  const { ref, sql, readOnly } = req.body || {};
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
    res.status(400).json({ error: "Invalid project ref." });
    return;
  }
  if (typeof sql !== "string" || !sql.trim()) {
    res.status(400).json({ error: "Missing sql." });
    return;
  }

  try {
    const upstream = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: Boolean(readOnly) }),
    });
    const text = await upstream.text();
    const data = text ? JSON.parse(text) : null;
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: (data && (data.message || data.error)) || "Supabase rejected that query." });
      return;
    }
    res.status(200).json({ ok: true, result: data });
  } catch {
    res.status(502).json({ error: "Network error while reaching Supabase." });
  }
};
