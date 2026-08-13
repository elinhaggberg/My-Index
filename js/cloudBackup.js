// Client side of the optional Cloud Backup add-on -- pushes/pulls the
// actual profiles/tags/snippets to the connected Supabase project, unlike
// feedSync.js which only ever moves lightweight RSS-tracking metadata.
// Same "bring your own database" principle: nothing here works until
// someone connects a project and installs Cloud Backup specifically (it's
// a separate opt-in from RSS sync -- see js/cloudSyncInstall.js).
//
// Deletions propagate via tombstones (see js/storage.js's recordTombstone/
// getTombstones/clearTombstones): pushAll sends them alongside live
// records, pullChanges applies an incoming one as a real local delete
// instead of silently ignoring it.
import { getApiConfig, setApiConfig } from "./supabaseOAuth.js";
import { syncRecordImageForPush, deleteRecordImage } from "./cloudImageSync.js";

const PASSPHRASE_KEY = "mi_backup_passphrase_v1";
const LAST_SYNCED_KEY = "mi_backup_last_synced_v1";
const PERIODIC_INTERVAL_MS = 15 * 60 * 1000;
const SYNCABLE_STORES = ["profiles", "tags", "snippets"];
// A single non-content record (theme/homeTitle/showProfileRow, see
// storage.js's getPrefsSnapshot) travels through the same push/pull API as
// everything else, under its own reserved store name and a fixed record id
// since there's only ever one "current prefs" per account.
const PREFS_STORE = "prefs";
const PREFS_RECORD_ID = "prefs";

export function getBackupPassphrase() {
  return localStorage.getItem(PASSPHRASE_KEY) || "";
}

export function setBackupPassphrase(passphrase) {
  localStorage.setItem(PASSPHRASE_KEY, passphrase);
}

export function clearBackupPassphrase() {
  localStorage.removeItem(PASSPHRASE_KEY);
}

export function isBackupConfigured() {
  const config = getApiConfig();
  return Boolean(config?.url && config?.anonKey && getBackupPassphrase());
}

function getLastSyncedAt() {
  return localStorage.getItem(LAST_SYNCED_KEY) || "";
}

function setLastSyncedAt(iso) {
  localStorage.setItem(LAST_SYNCED_KEY, iso);
}

export function getLastSyncedDisplay() {
  const iso = getLastSyncedAt();
  return iso ? new Date(iso) : null;
}

// A single paste-able code bundling everything a second device needs --
// project URL, publishable key, and the backup passphrase -- so pairing a
// device is "copy one code, paste it," not transcribing three separate
// values by hand. Treat it like a password: anyone with this code can
// read and write your backup data.
export function getPairingCode() {
  const config = getApiConfig();
  const passphrase = getBackupPassphrase();
  if (!config?.url || !config?.anonKey || !passphrase) return null;
  const payload = { url: config.url, anonKey: config.anonKey, passphrase };
  return btoa(JSON.stringify(payload));
}

// The second-device entry point -- no OAuth, no Supabase login, just this
// code. Sets the same local config feedSync.js/cloudBackup.js both read
// from, exactly as if this device had run the OAuth install itself
// (minus the "ref", which only matters for the Management API install
// flow this device never touches). Returns true on success, false if the
// code doesn't parse or is missing a required field.
export function applyPairingCode(code) {
  let payload;
  try {
    payload = JSON.parse(atob(code.trim()));
  } catch {
    return false;
  }
  if (!payload.url || !payload.anonKey || !payload.passphrase) return false;
  setApiConfig({ url: payload.url, anonKey: payload.anonKey, ref: payload.ref || null });
  setBackupPassphrase(payload.passphrase);
  return true;
}

// Confirms a passphrase actually authenticates against a project's already-
// deployed backup-sync function, before committing to it locally -- used
// when joining a project another app (or another device running this same
// app) already set up (see js/cloudSyncInstall.js's joinExistingBackup), so
// a typo surfaces immediately as "that's not right" instead of silently
// breaking sync later. Reuses the existing "pull" action with a since far
// in the future so the response stays tiny regardless of how much is
// already backed up -- works against any previously-deployed backup-sync,
// even one from before this verification path existed, since the
// passphrase check happens before the action switch either way. Returns
// true (valid), false (wrong passphrase), or null (couldn't reach it at
// all -- a different failure than "wrong," worth telling apart in the UI).
export async function verifyPassphrase(passphrase, config) {
  try {
    const res = await fetch(`${config.url}/functions/v1/backup-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.anonKey, "x-backup-passphrase": passphrase },
      body: JSON.stringify({ action: "pull", since: "9999-12-31T00:00:00.000Z" }),
    });
    if (res.status === 401) return false;
    return res.ok;
  } catch {
    return null;
  }
}

async function callBackupApi(action, body) {
  const config = getApiConfig();
  const passphrase = getBackupPassphrase();
  if (!config?.url || !config?.anonKey || !passphrase) return null;
  try {
    const res = await fetch(`${config.url}/functions/v1/backup-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.anonKey, "x-backup-passphrase": passphrase },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// syncRecordImageForPush uploads a device-local idb: image to Storage and
// swaps in a portable storage: reference (or leaves a remote URL/no-image
// record untouched) -- see cloudImageSync.js's own comment on it. Without
// this, a synced record's image would just be a meaningless local
// IndexedDB key on whatever device pulls it.
async function toRecord(store, record) {
  const synced = await syncRecordImageForPush(store, record);
  return {
    store,
    recordId: synced.id,
    data: synced,
    updatedAt: new Date(synced.updatedAt || synced.createdAt || Date.now()).toISOString(),
  };
}

function toTombstoneRecord(t) {
  return { store: t.store, recordId: t.recordId, data: null, updatedAt: new Date(t.deletedAt).toISOString(), deleted: true };
}

// Always sends the full current dataset rather than trying to diff "what
// changed since last sync" client-side -- several local mutations (tag
// edits, tag deletion's ripple into profiles/snippets) don't reliably bump
// an updatedAt timestamp, so a precise diff would risk silently missing
// real changes. backup-sync's own last-write-wins-by-timestamp check on
// the server makes resending everything safe, just a bit more bandwidth
// than strictly necessary -- an acceptable trade at personal-register
// scale (dozens to low hundreds of records).
export async function pushAll({ getProfiles, getTags, getSnippets, getTombstones, clearTombstones, getPrefsSnapshot, getPrefsUpdatedAt }) {
  if (!isBackupConfigured()) return { applied: 0 };
  const [profiles, tags, snippets, tombstones] = await Promise.all([getProfiles(), getTags(), getSnippets(), getTombstones()]);
  const records = [
    ...(await Promise.all(profiles.map((p) => toRecord("profiles", p)))),
    ...(await Promise.all(tags.filter((t) => !t.isSystem).map((t) => toRecord("tags", t)))),
    ...(await Promise.all(snippets.map((s) => toRecord("snippets", s)))),
    ...tombstones.map(toTombstoneRecord),
  ];
  // Only pushed once prefs have actually been touched locally (getPrefsUpdatedAt
  // is null on a fresh install that never changed anything) -- otherwise a
  // brand-new device's untouched defaults could race a real customization
  // already sitting in the cloud from another device.
  const prefsUpdatedAt = getPrefsUpdatedAt?.();
  if (prefsUpdatedAt) {
    records.push({ store: PREFS_STORE, recordId: PREFS_RECORD_ID, data: getPrefsSnapshot(), updatedAt: prefsUpdatedAt });
  }
  if (records.length === 0) return { applied: 0 };
  const result = await callBackupApi("push", { records });
  // Only clears once the request actually went through -- a failed/dropped
  // push (result is null, see callBackupApi) leaves the tombstones in place
  // so the next sync attempt tries them again instead of quietly losing the
  // deletion. Clears all of them regardless of each one's own applied/skipped
  // outcome (see backup-sync's last-write-wins check): a tombstone that lost
  // to a newer edit elsewhere doesn't need to be retried, that's the correct
  // outcome, not a failure. Each tombstone's uploaded image (if it had one)
  // is cleaned up the same way, best-effort (see deleteRecordImage).
  if (result && tombstones.length) {
    await Promise.all(tombstones.map((t) => deleteRecordImage(t.store, t.recordId)));
    await clearTombstones(tombstones.map((t) => t.id));
  }
  return { applied: result?.applied ?? 0 };
}

// Pulls everything changed since the last successful sync (or everything,
// on a fresh/paired device with no prior sync) and writes it straight into
// local storage via upsertRecords -- matched by the record's own id, so
// this converges with what's already there rather than duplicating it. A
// deleted row is applied as a real local delete (applyRemoteDeletion, not
// upsertRecords) so it actually disappears here too, instead of the old
// behavior of silently dropping it.
export async function pullChanges({ upsertRecords, applyRemoteDeletion, applyPrefsSnapshot }) {
  if (!isBackupConfigured()) return { pulled: 0 };
  const since = getLastSyncedAt();
  const result = await callBackupApi("pull", since ? { since } : {});
  if (!result?.records) return { pulled: 0 };

  const byStore = { profiles: [], tags: [], snippets: [] };
  const deletions = [];
  for (const r of result.records) {
    if (r.store === PREFS_STORE) {
      if (r.data) applyPrefsSnapshot?.(r.data, r.updated_at);
      continue;
    }
    if (!SYNCABLE_STORES.includes(r.store)) continue;
    if (r.deleted) deletions.push(r);
    else if (r.data) byStore[r.store].push(r.data);
  }
  for (const store of SYNCABLE_STORES) {
    if (byStore[store].length) await upsertRecords(store, byStore[store]);
  }
  for (const r of deletions) await applyRemoteDeletion(r.store, r.record_id);
  if (result.pulledAt) setLastSyncedAt(result.pulledAt);
  return { pulled: result.records.length };
}

// The manual "Sync now" action, and what the periodic/visibility triggers
// below call too -- push first (send whatever's changed here), then pull
// (pick up whatever changed elsewhere), so a round-trip always leaves this
// device caught up in both directions.
export async function syncNow(storageFns) {
  if (!isBackupConfigured()) return { synced: false };
  await pushAll(storageFns);
  await pullChanges(storageFns);
  return { synced: true };
}

let periodicTimer = null;

// Called once from app.js at startup. Syncs once immediately (catches up
// on anything that happened elsewhere since this device was last open),
// then again every 15 minutes while the app stays open, plus whenever the
// tab is backgrounded (a reasonable proxy for "the user just finished
// making changes and is stepping away") or foregrounded again. There's no
// true OS-level background sync for a browser tab, so "periodic" here
// only ever means "while the app is actually open."
// onSynced (optional) fires after every push+pull round, including the
// silent periodic/visibility ones below -- lets app.js re-apply the theme
// and refresh the on-screen title immediately if this round pulled a prefs
// change from another device, instead of it sitting unapplied until the
// next full reload.
export function startAutoSync(storageFns, onSynced) {
  if (!isBackupConfigured()) return;

  const run = () => syncNow(storageFns).then(() => onSynced?.());
  run();
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(run, PERIODIC_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!isBackupConfigured()) return;
    run();
  });
}
