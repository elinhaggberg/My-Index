// Shared, SSRF-safe replacement for fetch() in the functions that fetch a
// URL someone else supplied (unfurl.js, discover-feed.js, read-feed.js).
// Those functions run inside a cloud provider's network, so without this
// anyone could ask them to fetch an internal address -- the provider's
// metadata service, a private network range, localhost -- and read the
// answer back. (The leading underscore keeps Vercel from turning this
// folder into an endpoint of its own.)
//
// What it enforces, on the first request and again on every redirect:
//   - http/https only, on the usual web ports
//   - no hostnames that only exist inside a network (localhost, *.local …)
//   - the address the hostname actually resolves to must be public. This
//     is checked at connection time, inside the socket's own DNS lookup,
//     so a hostname can't resolve to something public when checked and
//     something private when connected to (DNS rebinding)
//   - redirects are followed by hand, at most MAX_REDIRECTS, each one
//     checked like a fresh request
//   - an overall time limit and a cap on how much of the body is read
//
// It deliberately returns a small fetch()-like object (ok, status, url,
// headers.get, text, json, arrayBuffer), so the callers barely change.

const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns");
const net = require("node:net");
const zlib = require("node:zlib");

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 2000000;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

// Every range that isn't the public internet: private networks, loopback,
// link-local (where cloud metadata services live), carrier-grade NAT,
// documentation/benchmark ranges, multicast and reserved space.
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  BLOCKED.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  BLOCKED.addSubnet(address, prefix, "ipv6");
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

class BlockedAddressError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedAddressError";
    this.code = "BLOCKED_ADDRESS";
  }
}

// IPv4 addresses can also arrive wrapped in IPv6 (::ffff:10.0.0.1, or the
// 64:ff9b::/96 NAT64 prefix) -- unwrapped and checked as IPv4, or they'd
// slip past the IPv4 rules above.
function embeddedIPv4(address) {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return null;
}

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return BLOCKED.check(address, "ipv4");
  if (family === 6) {
    const v4 = embeddedIPv4(address);
    if (v4) return BLOCKED.check(v4, "ipv4");
    return BLOCKED.check(address, "ipv6");
  }
  return true;
}

function checkUrl(urlString, isBlocked) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new BlockedAddressError("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedAddressError("Only http and https are allowed.");
  if (url.username || url.password) throw new BlockedAddressError("URLs with credentials aren't allowed.");
  if (!ALLOWED_PORTS.has(url.port)) throw new BlockedAddressError("That port isn't allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new BlockedAddressError("That address isn't reachable from here.");
  }
  // A single-label name ("intranet", "router") only resolves inside a
  // private network.
  if (!net.isIP(host) && !host.includes(".")) throw new BlockedAddressError("That address isn't reachable from here.");
  // Node never calls the lookup below for a literal IP, so it's checked here.
  if (net.isIP(host) && isBlocked(host)) throw new BlockedAddressError("That address isn't reachable from here.");
  return url;
}

// Used as the socket's own DNS lookup, so the address that's checked is
// exactly the address that's connected to. If any address a name resolves
// to is private, the whole name is refused -- a mix of public and private
// answers is a classic rebinding setup.
function makeSafeLookup(isBlocked) {
  return function safeLookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    dns.lookup(hostname, { all: true, family: options.family || 0 }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses.length || addresses.some((a) => isBlocked(a.address))) {
        return callback(new BlockedAddressError("That address isn't reachable from here."));
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function decode(res) {
  const encoding = String(res.headers["content-encoding"] || "").toLowerCase().trim();
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function requestOnce(url, { headers, maxBytes, deadline, lookup }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(Object.assign(new Error("Timed out."), { name: "AbortError" }));
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      url,
      {
        method: "GET",
        headers: { "Accept-Encoding": "gzip, deflate, br", ...headers },
        lookup,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: res.headers.location, status });
        }
        const chunks = [];
        let size = 0;
        let truncated = false;
        const body = decode(res);
        const finish = () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated });
        body.on("data", (chunk) => {
          if (truncated) return;
          const room = maxBytes - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            size = maxBytes;
            truncated = true;
            // Enough read -- stop downloading the rest.
            req.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        body.on("end", () => {
          if (!truncated) finish();
        });
        body.on("error", (err) => {
          if (!truncated) reject(err);
        });
      }
    );
    // A hard limit on the whole request, not just on the socket going quiet
    // -- a server trickling a byte at a time would otherwise never time out.
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("Timed out."), { name: "AbortError" })), remaining);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}

function makeResponse(url, result) {
  const text = () => result.body.toString("utf8");
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    url: url.toString(),
    truncated: result.truncated,
    headers: { get: (name) => result.headers[String(name).toLowerCase()] ?? null },
    text: async () => text(),
    json: async () => JSON.parse(text()),
    arrayBuffer: async () => result.body,
  };
}

function createSafeFetch({ isBlocked = isBlockedAddress } = {}) {
  const lookup = makeSafeLookup(isBlocked);
  return async function safeFetch(input, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const deadline = Date.now() + timeoutMs;
    let url = checkUrl(String(input), isBlocked);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const result = await requestOnce(url, { headers, maxBytes, deadline, lookup });
      if (!result.redirect) return makeResponse(url, result);
      // Each redirect target gets the same checks as the original URL.
      url = checkUrl(new URL(result.redirect, url).toString(), isBlocked);
    }
    throw new Error("Too many redirects.");
  };
}

const safeFetch = createSafeFetch();

module.exports = { safeFetch, createSafeFetch, isBlockedAddress, BlockedAddressError };
