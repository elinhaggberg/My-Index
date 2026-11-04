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

// The live check behind Cloud sync's status: "ok", "bad-passphrase" (the
// project answers but no longer accepts this device's passphrase), or
// "unreachable" (offline, or the project is paused or gone). Uses the
// same tiny pull as verifyPassphrase.
export async function checkBackupHealth() {
  const config = getApiConfig();
  const passphrase = getBackupPassphrase();
  if (!config?.url || !config?.anonKey || !passphrase) return "unreachable";
  try {
    const res = await fetch(`${config.url}/functions/v1/backup-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.anonKey, "x-backup-passphrase": passphrase },
      body: JSON.stringify({ action: "pull", since: "9999-12-31T00:00:00.000Z" }),
    });
    if (res.status === 401) return "bad-passphrase";
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

// "just now", "12 min ago", "3 h ago", or the date for anything older.
export function formatSyncedAgo(date) {
  if (!date) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleDateString();
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
    if (!res.ok) {
      const detail = await res.json().then((j) => j?.error).catch(() => "");
      setLastSyncProblem(`${action === "push" ? "Upload" : "Download"} failed (${res.status})${detail ? `: ${detail}` : ""}`);
      return null;
    }
    const json = await res.json();
    if (action === "push" || action === "pull") clearLastSyncProblem(action);
    return json;
  } catch (err) {
    setLastSyncProblem(`${action === "push" ? "Upload" : "Download"} couldn't reach the project${err?.message ? `: ${err.message}` : ""}`);
    return null;
  }
}

// The most recent thing that went wrong with a sync, in words, shown in
// the Cloud sync sheet -- so a failing upload is visible from the app
// itself instead of only in the Supabase dashboard. Cleared by the next
// successful round-trip of the same kind.
const LAST_PROBLEM_KEY = "mi_backup_last_problem_v1";
function setLastSyncProblem(text) {
  localStorage.setItem(LAST_PROBLEM_KEY, JSON.stringify({ text, at: new Date().toISOString() }));
}
function clearLastSyncProblem(action) {
  try {
    const p = JSON.parse(localStorage.getItem(LAST_PROBLEM_KEY) || "null");
    if (p && p.text.startsWith(action === "push" ? "Upload" : "Download")) localStorage.removeItem(LAST_PROBLEM_KEY);
  } catch {
    localStorage.removeItem(LAST_PROBLEM_KEY);
  }
}
export function getLastSyncProblem() {
  try {
    return JSON.parse(localStorage.getItem(LAST_PROBLEM_KEY) || "null");
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

// `data` is an empty object, not null: backup_records.data is NOT NULL
// (backup_schema.sql), so a null there made the whole push fail at the
// first deletion -- the records before it got through, every deletion
// didn't, and the tombstones were retried (and failed) on every sync.
function toTombstoneRecord(t) {
  return { store: t.store, recordId: t.recordId, data: {}, updatedAt: new Date(t.deletedAt).toISOString(), deleted: true };
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
  if (!result) return { applied: 0, failed: true };
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
  return { applied: result.applied ?? 0 };
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
  // Always everything, not "changed since the last sync": the server
  // filters by each record's own timestamp, which is when it was edited on
  // its device, not when it reached the cloud. A note written on the phone
  // at 10:00 and synced at 10:05 was older than a 10:03 sync elsewhere, so
  // that device never asked for it again. At personal-register scale the
  // whole set is small, and upsertRecords keeps only what's newer.
  const result = await callBackupApi("pull", {});
  if (!result?.records) return { pulled: 0, failed: true };

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
  let changed = 0;
  for (const store of SYNCABLE_STORES) {
    if (byStore[store].length) changed += (await upsertRecords(store, byStore[store])) || 0;
  }
  for (const r of deletions) if (await applyRemoteDeletion(r.store, r.record_id)) changed++;
  if (result.pulledAt) setLastSyncedAt(result.pulledAt);
  return { pulled: changed };
}

// The manual "Sync now" action, and what the periodic/visibility triggers
// below call too -- push first (send whatever's changed here), then pull
// (pick up whatever changed elsewhere), so a round-trip always leaves this
// device caught up in both directions.
// One sync at a time: opening the app and it becoming visible can ask for
// two at once, and the second just joins the one already running.
let inFlight = null;
export function syncNow(storageFns) {
  if (!inFlight) inFlight = runSync(storageFns).finally(() => (inFlight = null));
  return inFlight;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSync(storageFns) {
  if (!isBackupConfigured()) return { synced: false };
  // Either half failing counts: a push that silently failed is how
  // deletions once went missing without anyone noticing.
  let push = await pushAll(storageFns);
  // A request cut off on the way (iOS freezing the app as it goes to the
  // background, the network not up yet right after opening) usually goes
  // through a moment later -- one more try before calling it failed.
  if (push.failed) {
    await wait(2000);
    push = await pushAll(storageFns);
  }
  const pull = await pullChanges(storageFns);
  const result = { synced: !push.failed && !pull.failed, pulled: pull.pulled };
  // Every sync -- the automatic ones and Sync now -- announces what it
  // brought in, so the page on screen can redraw (see js/app.js).
  window.dispatchEvent(new CustomEvent("mi:synced", { detail: result }));
  return result;
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

  const run = () => syncNow(storageFns).then((result) => onSynced?.(result));
  run();
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = setInterval(run, PERIODIC_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (!isBackupConfigured()) return;
    run();
  });
}
