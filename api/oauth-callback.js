// Server-side leg of the "Connect Supabase" flow (see the Cloud Sync setup
// in js/supabaseOAuth.js). Supabase redirects here with an authorization
// code after the user consents on Supabase's own screen; this function
// exchanges that code for an access/refresh token pair using the OAuth
// app's client secret, which must never reach the browser. The resulting
// tokens are handed back to the client in the URL fragment (never a query
// param, so they never land in a server access log) -- there's no database
// of ours to hold them in instead, by design: the browser is the only place
// they're stored, same principle as everything else in this app.

const CLIENT_ID = "366ba718-1824-41e2-b90f-faa4b5136d14";

module.exports = async (req, res) => {
  const origin = `https://${req.headers.host}`;
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    res.redirect(302, `${origin}/?oauth_error=${encodeURIComponent(errorDescription || error)}`);
    return;
  }
  if (!code) {
    res.redirect(302, `${origin}/?oauth_error=${encodeURIComponent("Missing authorization code.")}`);
    return;
  }

  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    res.redirect(302, `${origin}/?oauth_error=${encodeURIComponent("Cloud sync isn't fully set up yet on the server side.")}`);
    return;
  }

  try {
    const tokenRes = await fetch("https://api.supabase.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: `${origin}/api/oauth-callback`,
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      res.redirect(302, `${origin}/?oauth_error=${encodeURIComponent(data.error_description || "Couldn't finish connecting to Supabase.")}`);
      return;
    }

    const fragment = new URLSearchParams({
      access_token: data.access_token,
      refresh_token: data.refresh_token || "",
      expires_in: String(data.expires_in || 3600),
    });
    if (state) fragment.set("state", String(state));
    res.redirect(302, `${origin}/#oauth=${fragment.toString()}`);
  } catch {
    res.redirect(302, `${origin}/?oauth_error=${encodeURIComponent("Network error while connecting to Supabase.")}`);
  }
};
