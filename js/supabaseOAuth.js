// Client side of the "bring your own database" Cloud Sync connection --
// lets someone link their own Supabase project via OAuth instead of us
// hosting any backend of our own. Tokens live only in this browser
// (localStorage), never on a server we control, same principle as the rest
// of the app's local-first storage. The OAuth app's client secret never
// reaches this file -- it stays server-side in api/oauth-callback.js and
// api/oauth-refresh.js, which is the only reason those two functions exist.
const CLIENT_ID = "366ba718-1824-41e2-b90f-faa4b5136d14";
const TOKEN_KEY = "mi_supabase_oauth_v1";
const STATE_KEY = "mi_supabase_oauth_state_v1";

function redirectUri() {
  return `${location.origin}/api/oauth-callback`;
}

function readTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTokens(tokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function isCloudSyncConnected() {
  return Boolean(readTokens());
}

export function disconnectCloudSync() {
  localStorage.removeItem(TOKEN_KEY);
}

// Builds the URL to send the user to Supabase's own consent screen.
// A random "state" value is stashed in sessionStorage and checked again on
// the way back (consumeOAuthRedirect), so a stray/forged redirect can't get
// treated as a real connection.
export function getConnectUrl() {
  const state = crypto.randomUUID ? crypto.randomUUID() : "st-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    state,
  });
  return `https://api.supabase.com/v1/oauth/authorize?${params.toString()}`;
}

// Called once on app startup. api/oauth-callback.js redirects back here
// with tokens in the URL fragment (never a query param, so they never land
// in a server log) after a successful consent. Returns "connected",
// "error", or null if there was nothing to consume this load.
export function consumeOAuthRedirect() {
  if (!location.hash.startsWith("#oauth=")) return null;
  const params = new URLSearchParams(location.hash.slice("#oauth=".length));
  history.replaceState(null, "", location.pathname + location.search);

  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  const accessToken = params.get("access_token");
  if (!accessToken || !expectedState || params.get("state") !== expectedState) return "error";

  writeTokens({
    accessToken,
    refreshToken: params.get("refresh_token") || "",
    expiresAt: Date.now() + Number(params.get("expires_in") || 3600) * 1000,
  });
  return "connected";
}

// Returns a currently-valid access token, silently refreshing first if it's
// expired (or about to, within a minute). Returns null if not connected, or
// if the refresh itself fails -- a failed refresh means the connection is
// dead either way, so it clears the stored tokens rather than leaving a
// broken connection looking "connected."
export async function getValidAccessToken() {
  const tokens = readTokens();
  if (!tokens) return null;
  if (tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    disconnectCloudSync();
    return null;
  }

  try {
    const res = await fetch("/api/oauth-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    });
    if (!res.ok) {
      disconnectCloudSync();
      return null;
    }
    const data = await res.json();
    writeTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    });
    return data.access_token;
  } catch {
    // A network hiccup shouldn't nuke a real connection -- leave the stored
    // (expired) tokens in place so the next attempt can retry.
    return null;
  }
}

// First real proof the connection works end-to-end: lists the user's
// Supabase projects. Routed through api/supabase-management.js rather than
// called directly from the browser, since it's server-to-server from there
// and so isn't at the mercy of whatever CORS policy api.supabase.com does
// or doesn't set for browser callers.
export async function listSupabaseProjects() {
  const token = await getValidAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`/api/supabase-management?path=${encodeURIComponent("/v1/projects")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
