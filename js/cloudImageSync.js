// Storage-based image sync for Cloud Backup -- replaces storage.js's older
// inlineRecordImage approach (embedding an image's full data: URI inside
// the synced record) with uploading the actual bytes once to this
// project's private Supabase Storage bucket via the backup-image Edge
// Function, and syncing a small "storage:<store>:<recordId>" reference in
// the record's place instead. A pulled reference resolves lazily -- see
// createStorageResolver below, registered against imageStore.js's
// resolveImageSrc -- so restoring on a second device (or just a normal
// periodic sync) never has to download every image up front, only the
// ones actually scrolled into view.
import { getApiConfig } from "./supabaseOAuth.js";
import { getBackupPassphrase } from "./cloudBackup.js";
import { IDB_PREFIX, getImage, putImage } from "./imageStore.js";

export const STORAGE_PREFIX = "storage:";

// Which record's uploaded image is current as of which local edit -- a
// cheap, good-enough proxy for "did the image actually change" that avoids
// re-uploading a multi-hundred-KB photo on every ~15-minute sync cycle when
// nothing about it changed. Not a content hash: records don't reliably bump
// updatedAt for every single field, but they do bump it on every save, and
// a save is the only moment an image could have changed too -- same
// "good enough at personal-register scale" trade cloudBackup.js's pushAll
// already makes by resending the full dataset rather than precisely
// diffing it.
const SYNCED_VERSIONS_KEY = "mi_image_synced_versions_v1";

function readSyncedVersions() {
  try {
    return JSON.parse(localStorage.getItem(SYNCED_VERSIONS_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeSyncedVersions(versions) {
  localStorage.setItem(SYNCED_VERSIONS_KEY, JSON.stringify(versions));
}

function alreadySynced(recordId, updatedAt) {
  return readSyncedVersions()[recordId] === updatedAt;
}

function markSynced(recordId, updatedAt) {
  const versions = readSyncedVersions();
  versions[recordId] = updatedAt;
  writeSyncedVersions(versions);
}

function forgetSynced(recordId) {
  const versions = readSyncedVersions();
  delete versions[recordId];
  writeSyncedVersions(versions);
}

function parseStorageRef(ref) {
  const [, store, recordId] = ref.split(":");
  return { store, recordId };
}

function backupImageUrl(config, params) {
  return `${config.url}/functions/v1/backup-image?${new URLSearchParams(params)}`;
}

function authHeaders(config, passphrase, extra) {
  return { apikey: config.anonKey, "x-backup-passphrase": passphrase, ...extra };
}

// Upload side, called from cloudBackup.js's pushAll in place of the old
// inlineRecordImage. A device-local "idb:<id>" image is uploaded (once per
// change, see alreadySynced above) to the project's private Storage
// bucket, and the record synced in its place carries the small storage:
// reference instead. Anything else (a remote unfurled URL, or no image at
// all) passes through unchanged, same contract inlineRecordImage had.
//
// On any failure -- not configured, network error, the backup-image
// function not deployed yet on an install from before this existed -- the
// image is dropped from the outgoing record (never the raw idb: reference,
// which would be meaningless synced to another device) rather than
// blocking the rest of the push. This device's own local record is never
// touched either way, so the next successful sync retries the upload from
// scratch.
export async function syncRecordImageForPush(store, record) {
  const image = record.image;
  if (typeof image !== "string" || !image.startsWith(IDB_PREFIX)) return record;

  const recordId = image.slice(IDB_PREFIX.length);
  const updatedAt = record.updatedAt || record.createdAt || 0;
  const ref = `${STORAGE_PREFIX}${store}:${recordId}`;
  if (alreadySynced(recordId, updatedAt)) return { ...record, image: ref };

  const config = getApiConfig();
  const passphrase = getBackupPassphrase();
  if (!config?.url || !config?.anonKey || !passphrase) return { ...record, image: null };

  const blob = await getImage(recordId);
  if (!blob) return { ...record, image: null };

  try {
    const res = await fetch(backupImageUrl(config, { action: "upload", store, recordId }), {
      method: "POST",
      headers: authHeaders(config, passphrase, { "Content-Type": blob.type || "image/jpeg" }),
      body: blob,
    });
    if (!res.ok) return { ...record, image: null };
    markSynced(recordId, updatedAt);
    return { ...record, image: ref };
  } catch {
    return { ...record, image: null };
  }
}

// Best-effort cleanup for a deleted record's uploaded image, called
// alongside sending its tombstone. Never blocks or fails the tombstone
// push itself -- an orphaned object in a private bucket costs nothing but
// a few KB of storage, so this is cleanup, not correctness.
export async function deleteRecordImage(store, recordId) {
  forgetSynced(recordId);
  const config = getApiConfig();
  const passphrase = getBackupPassphrase();
  if (!config?.url || !config?.anonKey || !passphrase) return;
  try {
    // POST, not GET -- same reasoning as resolveStorageRef's call to this
    // same function below: service-worker.js's fetch handler only lets
    // GET requests through untouched, and would otherwise swallow this
    // into its own cache-then-network handling, same as it already
    // deliberately avoids for backup-sync's calls.
    await fetch(backupImageUrl(config, { action: "delete", store, recordId }), {
      method: "POST",
      headers: authHeaders(config, passphrase),
    });
  } catch {
    // Best-effort -- see comment above.
  }
}

// Download side: pass the result to imageStore.js's registerRemoteResolver
// so every existing resolveImageSrc call site (snippet cards, profile
// avatars, tag covers...) picks up storage: references automatically, no
// call-site changes needed. Fetches a short-lived signed URL from the Edge
// Function, downloads the bytes once, and caches them into this device's
// own image store -- patchRecordImage (injected per app, since each app's
// records live in a differently-shaped local store) then rewrites the
// record's image field from the storage: reference to a plain idb: one, so
// every subsequent open resolves instantly with no network round trip at
// all, exactly like a record whose image was always local to begin with.
export function createStorageResolver({ patchRecordImage }) {
  return async function resolveStorageRef(ref) {
    const { store, recordId } = parseStorageRef(ref);
    const config = getApiConfig();
    const passphrase = getBackupPassphrase();
    if (!config?.url || !config?.anonKey || !passphrase) return "";

    try {
      // POST, not GET -- see the CACHE_NAME cross-origin caveat in
      // deleteRecordImage's comment above; the second fetch below (the
      // actual signed CDN URL) has to stay a plain GET, that's just how a
      // signed URL works, but this first call to our own Edge Function
      // doesn't need to be one.
      const urlRes = await fetch(backupImageUrl(config, { action: "url", store, recordId }), {
        method: "POST",
        headers: authHeaders(config, passphrase),
      });
      if (!urlRes.ok) return "";
      const { url } = await urlRes.json();
      if (!url) return "";

      const imgRes = await fetch(url);
      if (!imgRes.ok) return "";
      const blob = await imgRes.blob();
      await putImage(recordId, blob);
      await patchRecordImage(store, recordId, IDB_PREFIX + recordId);
      return URL.createObjectURL(blob);
    } catch {
      return "";
    }
  };
}
