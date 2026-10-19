// The official microformats parser (microformats.org's microformats-parser),
// loaded from a CDN the first time someone imports a profile -- never on
// app start, and cached by the service worker afterwards like the rest of
// the app. Pinned to an exact version so it can't change underneath us.
//
// A CDN is the simplest way to use the reference parser while My Index has
// no build step. It does mean the CDN sees one request per device. If that
// matters more later, the same file can be bundled into the repo instead
// (see the Oltra spec, §14.1).
const MF2_URL = "https://cdn.jsdelivr.net/npm/microformats-parser@2.0.6/+esm";

let loading = null;

export function loadMf2() {
  if (!loading) {
    loading = import(MF2_URL)
      .then((mod) => mod.mf2)
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}
