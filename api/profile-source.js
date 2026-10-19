// Vercel serverless function behind "Import from a link" (js/profileImport/):
// fetches the page someone pasted, so the browser can read the person's
// h-card from it, and fetches their profile photo once, so it can be stored
// on the device and the photo's host never sees the reader (see the Oltra
// spec, A8).
//
//   ?mode=page&url=…   → { html, finalUrl }   (HTML pages only, size-capped)
//   ?mode=image&url=…  → the image bytes      (raster images only, size-capped)
//
// Same statelessness/no-data-collection premise as the other functions --
// nothing is stored or logged -- and every fetch goes through safeFetch, so
// it can't be pointed at internal addresses (api/_lib/safeFetch.js).

const { safeFetch, BlockedAddressError } = require("./_lib/safeFetch.js");

const TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 1500000;
const MAX_IMAGE_BYTES = 5000000;
const USER_AGENT = "Mozilla/5.0 (compatible; MyIndexApp/1.0; +https://vercel.com)";
// SVG is left out on purpose: it's a document that can carry scripts, and a
// profile photo never needs to be one.
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

function errorMessage(err) {
  if (err instanceof BlockedAddressError) return "That address isn't reachable from here.";
  if (err && err.name === "AbortError") return "Timed out.";
  return "Couldn't fetch that.";
}

async function servePage(target, res) {
  const response = await safeFetch(target, {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_PAGE_BYTES,
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) {
    res.status(200).json({ error: `The page couldn't be loaded (HTTP ${response.status}).` });
    return;
  }
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  const html = await response.text();
  if (!type.includes("html") && !/<html[\s>]|<!doctype html/i.test(html.slice(0, 2000))) {
    res.status(200).json({ error: "That address isn't a web page." });
    return;
  }
  res.setHeader("Cache-Control", "public, s-maxage=300");
  res.status(200).json({ html, finalUrl: response.url });
}

async function serveImage(target, res) {
  const response = await safeFetch(target, {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_IMAGE_BYTES + 1,
    headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" },
  });
  const type = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !IMAGE_TYPES.has(type) || response.truncated) {
    res.status(415).json({ error: "That isn't an image that can be used as a profile photo." });
    return;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "public, s-maxage=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).end(bytes);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { url: target, mode } = req.query;
  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "Missing url parameter." });
    return;
  }

  try {
    if (mode === "image") await serveImage(target, res);
    else await servePage(target, res);
  } catch (err) {
    res.status(200).json({ error: errorMessage(err) });
  }
};
