// Vercel serverless function: given a URL, fetches its HTML server-side
// (the browser can't do this itself — most sites block cross-origin reads)
// and pulls out just enough to build a Snippet: title, image, description,
// site name. Nothing here is stored or logged — the function is stateless
// by design, so adding it doesn't compromise the "no data collection"
// premise of the app.

const TIMEOUT_MS = 8000;
const MAX_HTML_LENGTH = 700000;

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function getMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i");
  const match = html.match(re1) || html.match(re2);
  return match ? decodeEntities(match[1].trim()) : "";
}

function getTitleTag(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : "";
}

function getLinkHref(html, rel) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(`<link[^>]+rel=["']${escaped}["'][^>]*href=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<link[^>]+href=["']([^"']*)["'][^>]*rel=["']${escaped}["']`, "i");
  const match = html.match(re1) || html.match(re2);
  return match ? decodeEntities(match[1].trim()) : "";
}

function resolveUrl(maybeRelative, base) {
  if (!maybeRelative) return "";
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return "";
  }
}

// Status codes sites commonly use to push back on non-browser requests —
// worth a clearer message than a generic "couldn't fetch" for these, since
// it's the site refusing rather than a network problem.
function messageForStatus(status) {
  if (status === 401 || status === 403 || status === 999) {
    return "Scraping isn't allowed on this site — it blocked the request.";
  }
  if (status === 429) {
    return "This site is rate-limiting automated requests — try again in a moment.";
  }
  if (status === 404) {
    return "That page wasn't found (404).";
  }
  if (status >= 500) {
    return "This site's server had an error, or is blocking automated requests.";
  }
  return `Couldn't fetch that page (HTTP ${status}).`;
}

// YouTube pages are handled separately, via YouTube's own public oEmbed
// endpoint, rather than the generic HTML-scraping path below. Scraping the
// watch page directly is unreliable: YouTube often serves a cookie-consent
// or bot-check interstitial to non-browser requests instead of the real
// page, which has no video info on it at all. oEmbed is unauthenticated,
// stable, and built for exactly this (title + thumbnail), so it sidesteps
// the problem entirely.
//
// Matched by hostname only, not by path shape -- watch/live/shorts/embed
// links, playlist and tracking query params, youtu.be short links, all of
// it. Trying to hand-parse every URL shape YouTube hands out is fragile
// (miss one and it silently falls through to the unreliable scrape path
// instead); oEmbed already validates the URL itself and returns a clean
// not-found response for anything that isn't a real video.
function isYouTubeHost(parsed) {
  const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
  return host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com";
}

async function fetchYouTubeOEmbed(parsed, signal) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.toString())}&format=json`;
  const response = await fetch(oembedUrl, { signal });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    title: data.title || "",
    image: data.thumbnail_url || "",
    description: data.author_name ? `By ${data.author_name}` : "",
    siteName: "YouTube",
    sourceUrl: parsed.toString(),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const target = req.query.url;
  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "Missing url parameter." });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ error: "That doesn't look like a valid URL." });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "Only http/https URLs are supported." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    if (isYouTubeHost(parsed)) {
      const result = await fetchYouTubeOEmbed(parsed, controller.signal);
      if (result) {
        res.status(200).json(result);
        return;
      }
      res.status(200).json({
        error: "Couldn't find that YouTube video — it may be private, age-restricted, or deleted.",
        title: "",
        image: "",
        description: "",
        siteName: "YouTube",
        sourceUrl: parsed.toString(),
      });
      return;
    }

    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MyIndexApp/1.0; +https://vercel.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      res.status(200).json({
        error: messageForStatus(response.status),
        title: "",
        image: "",
        description: "",
        siteName: parsed.hostname,
        sourceUrl: parsed.toString(),
      });
      return;
    }

    let html = await response.text();
    if (html.length > MAX_HTML_LENGTH) html = html.slice(0, MAX_HTML_LENGTH);

    const finalUrl = response.url || parsed.toString();
    const title = getMeta(html, "og:title") || getTitleTag(html);
    const description = getMeta(html, "og:description") || getMeta(html, "description");
    const image = resolveUrl(getMeta(html, "og:image") || getMeta(html, "twitter:image") || getLinkHref(html, "image_src"), finalUrl);
    const siteName = getMeta(html, "og:site_name") || parsed.hostname.replace(/^www\./, "");

    // Title is the one field the editor's Content input actually surfaces
    // ("fetch fills this in") -- a missing image is never worth its own
    // message, since there's no visible "Image" field for the user to be
    // watching for. So the only thing worth complaining about here is a
    // missing title; a found title with no image is just a quiet success.
    const result = { title, image, description, siteName, sourceUrl: finalUrl };
    if (!title) {
      result.error =
        !description && !image
          ? "Couldn't find any details on this page — it may block scraping or need JavaScript to load its content."
          : "Couldn't find a title on this page — you can type your own below.";
    }
    res.status(200).json(result);
  } catch (err) {
    const message = err && err.name === "AbortError" ? "Timed out fetching that page." : "Couldn't fetch that link.";
    res.status(200).json({ error: message, title: "", image: "", description: "", siteName: parsed.hostname, sourceUrl: parsed.toString() });
  } finally {
    clearTimeout(timeout);
  }
};
