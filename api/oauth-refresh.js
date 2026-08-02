// Exchanges a stored refresh token for a fresh access token, same
// client-secret-stays-on-the-server principle as oauth-callback.js. Called
// by js/supabaseOAuth.js whenever the locally-stored access token has
// expired, right before a Management API call needs a valid one.

const CLIENT_ID = "366ba718-1824-41e2-b90f-faa4b5136d14";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const refreshToken = req.body?.refresh_token;
  if (!refreshToken) {
    res.status(400).json({ error: "Missing refresh_token." });
    return;
  }

  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    res.status(500).json({ error: "Cloud sync isn't fully set up yet on the server side." });
    return;
  }

  try {
    const tokenRes = await fetch("https://api.supabase.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      res.status(401).json({ error: data.error_description || "Couldn't refresh the Supabase connection." });
      return;
    }
    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in || 3600,
    });
  } catch {
    res.status(502).json({ error: "Network error while refreshing the Supabase connection." });
  }
};
