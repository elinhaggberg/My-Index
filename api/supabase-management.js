// Thin server-side proxy to Supabase's Management API. Exists so calls go
// server-to-server rather than straight from the browser -- api.supabase.com
// isn't documented as allowing arbitrary-origin browser requests, so routing
// through here sidesteps that uncertainty entirely rather than hoping CORS
// cooperates. The caller's own OAuth access token (obtained via
// supabaseOAuth.js) just passes through untouched; this function never
// needs the OAuth app's client secret, since the token was already minted
// by oauth-callback.js. Only GET, and only a small allowlist of read-only
// paths.
const ALLOWED_GET_PATHS = [
  /^\/v1\/projects$/,
  // Used once after install to read back the project's publishable key, so
  // js/cloudSyncInstall.js can wire up feedSync.js automatically -- never
  // matches the "secret" (service role) key entry in the response, only
  // read here, never written.
  /^\/v1\/projects\/[a-z]+\/api-keys(\?.*)?$/,
  // Used by checkExistingBackupSetup (see js/cloudSyncInstall.js) to detect
  // whether a project already has Cloud Backup's Edge Function deployed --
  // by this same app on another device, or a different Make It Local app
  // sharing the project -- so the UI can offer to join it with its
  // existing passphrase instead of generating a new one and silently
  // overwriting theirs. Read-only, no secrets in the response.
  /^\/v1\/projects\/[a-z]+\/functions$/,
];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing access token." });
    return;
  }

  const path = req.query.path;
  if (typeof path !== "string" || !ALLOWED_GET_PATHS.some((re) => re.test(path))) {
    res.status(400).json({ error: "Unsupported Management API path." });
    return;
  }

  try {
    const upstream = await fetch(`https://api.supabase.com${path}`, { headers: { Authorization: auth } });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: "Network error while reaching Supabase." });
  }
};
