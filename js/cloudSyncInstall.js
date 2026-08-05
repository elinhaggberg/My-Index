// Runs the actual "install" on top of a connected Cloud Sync project --
// everything supabase/SETUP.md used to walk through by hand happens here
// instead, via the Management API endpoints in api/cloud-sync-*. RSS sync
// and Cloud Backup are independent, separately-selectable feature sets
// (different tables, different Edge Functions); the "connect the app"
// step is shared and always runs last, once, regardless of which of the
// two were picked.
//
// Every step is an upsert (create-table-if-not-exists, deploy-or-update,
// unschedule-then-reschedule), so the whole sequence is safe to run again
// from scratch if it fails partway -- there's no separate "resume" logic,
// just re-run.
import { getValidAccessToken, getSelectedProject, setApiConfig, getApiConfig } from "./supabaseOAuth.js";
import { getBackupPassphrase, setBackupPassphrase, verifyPassphrase } from "./cloudBackup.js";

const CRON_SECRET_NAME = "CRON_SECRET";
const BACKUP_PASSPHRASE_NAME = "BACKUP_PASSPHRASE";
const INSTALLED_FEATURES_KEY = "mi_installed_features_v1";

// Tracked locally (keyed by project ref, so switching projects doesn't
// carry over a stale "already installed" state) since there's no cheap way
// to ask the project itself "which of these two independent feature sets
// did I already set up here" -- used to pre-check/disable the feature
// checkboxes and reveal each feature's own section once it's live.
export function getInstalledFeatures(ref) {
  try {
    const raw = localStorage.getItem(INSTALLED_FEATURES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || parsed.ref !== ref) return { rssSync: false, backup: false };
    return { rssSync: Boolean(parsed.rssSync), backup: Boolean(parsed.backup) };
  } catch {
    return { rssSync: false, backup: false };
  }
}

function markFeaturesInstalled(ref, features) {
  const current = getInstalledFeatures(ref);
  localStorage.setItem(
    INSTALLED_FEATURES_KEY,
    JSON.stringify({
      ref,
      rssSync: current.rssSync || Boolean(features?.rssSync),
      backup: current.backup || Boolean(features?.backup),
    })
  );
}

export const RSS_SYNC_STEPS = [
  "Setting up database tables",
  "Creating a secret for scheduled checks",
  "Deploying the sync function",
  "Deploying the feed-check function",
  "Scheduling hourly feed checks",
];

export const BACKUP_STEPS = [
  "Setting up backup tables",
  "Creating a backup passphrase",
  "Deploying the backup function",
  "Deploying the image sync function",
];

const CONNECT_STEP = "Connecting the app to your project";

// Exported so the UI can render the full (pending) step list upfront,
// matching exactly what installCloudSync will report progress against --
// depends on which feature(s) are selected, so it's a function, not a
// fixed constant like before.
export function getInstallSteps({ rssSync, backup }) {
  const steps = [];
  if (rssSync) steps.push(...RSS_SYNC_STEPS);
  if (backup) steps.push(...BACKUP_STEPS);
  steps.push(CONNECT_STEP);
  return steps;
}

function randomSecret() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function loadTemplate(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status}).`);
  return res.text();
}

async function callApi(path, token, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request to ${path} failed.`);
  return data;
}

async function runSql(token, ref, sql) {
  return callApi("/api/cloud-sync-sql", token, { ref, sql, readOnly: false });
}

async function deployFunction(token, ref, { slug, verifyJwt, source }) {
  return callApi("/api/cloud-sync-deploy-function", token, { ref, slug, name: slug, verifyJwt, source });
}

async function setSecret(token, ref, name, value) {
  return callApi("/api/cloud-sync-secret", token, { ref, name, value });
}

async function fetchPublishableKey(token, ref) {
  const path = `/v1/projects/${ref}/api-keys?reveal=true`;
  const res = await fetch(`/api/supabase-management?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Couldn't read the project's API keys (status ${res.status}).`);
  const publishable = Array.isArray(data) ? data.find((k) => k.type === "publishable") : null;
  if (!publishable?.api_key) throw new Error("Couldn't find a publishable API key on this project.");
  return publishable.api_key;
}

function rssSyncSteps(token, ref) {
  const cronSecret = randomSecret();
  const [dbLabel, secretLabel, syncFnLabel, checkFnLabel, cronLabel] = RSS_SYNC_STEPS;
  return [
    {
      label: dbLabel,
      run: async () => {
        const sql = await loadTemplate("/supabase/schema.sql");
        await runSql(token, ref, sql);
      },
    },
    {
      label: secretLabel,
      run: async () => {
        await setSecret(token, ref, CRON_SECRET_NAME, cronSecret);
      },
    },
    {
      label: syncFnLabel,
      run: async () => {
        const source = await loadTemplate("/supabase/functions/sync-index/index.ts");
        // Not true: the gateway's verify_jwt check only understands the
        // legacy JWT-shaped anon key, and this project's publishable key
        // (sb_publishable_...) isn't one -- every real call would get
        // rejected as "Invalid JWT" otherwise. There's no meaningful
        // security loss here either way: the anon/publishable key was
        // never a secret boundary, the tables it can't reach directly are
        // what actually protects the data (see schema.sql's RLS comment).
        await deployFunction(token, ref, { slug: "sync-index", verifyJwt: false, source });
      },
    },
    {
      label: checkFnLabel,
      run: async () => {
        const source = await loadTemplate("/supabase/functions/check-feeds/index.ts");
        // Called by pg_cron, which can't present a user JWT -- verify_jwt
        // false is what the manual docs call "turning off Enforce JWT
        // Verification." check-feeds checks CRON_SECRET itself instead.
        await deployFunction(token, ref, { slug: "check-feeds", verifyJwt: false, source });
      },
    },
    {
      label: cronLabel,
      run: async () => {
        const template = await loadTemplate("/supabase/cron_setup.sql");
        const sql = template.replaceAll("<PASTE_YOUR_CRON_SECRET_HERE>", cronSecret).replaceAll("<YOUR_PROJECT_REF>", ref);
        await runSql(token, ref, sql);
      },
    },
  ];
}

function backupSteps(token, ref) {
  const [dbLabel, passphraseLabel, fnLabel, imageFnLabel] = BACKUP_STEPS;
  return [
    {
      label: dbLabel,
      run: async () => {
        // Also creates the private "backup-images" Storage bucket that
        // image sync uploads into (see js/cloudImageSync.js) -- one more
        // statement in the same SQL file, not a separate step, since it's
        // just as much "setting up backup tables" as backup_records itself.
        const sql = await loadTemplate("/supabase/backup_schema.sql");
        await runSql(token, ref, sql);
      },
    },
    {
      label: passphraseLabel,
      run: async () => {
        // Reuse the existing passphrase on a reinstall rather than
        // generating a new one -- rotating it here would silently break
        // sync on every already-paired second device. Only ever generated
        // fresh the first time Cloud Backup is turned on for this project.
        let passphrase = getBackupPassphrase();
        if (!passphrase) {
          passphrase = randomSecret();
          setBackupPassphrase(passphrase);
        }
        await setSecret(token, ref, BACKUP_PASSPHRASE_NAME, passphrase);
      },
    },
    {
      label: fnLabel,
      run: async () => {
        const source = await loadTemplate("/supabase/functions/backup-sync/index.ts");
        // Same verify_jwt reasoning as sync-index -- the passphrase header
        // check inside the function is the real access control here.
        await deployFunction(token, ref, { slug: "backup-sync", verifyJwt: false, source });
      },
    },
    {
      label: imageFnLabel,
      run: async () => {
        const source = await loadTemplate("/supabase/functions/backup-image/index.ts");
        await deployFunction(token, ref, { slug: "backup-image", verifyJwt: false, source });
      },
    },
  ];
}

async function listDeployedFunctions(token, ref) {
  const path = `/v1/projects/${ref}/functions`;
  const res = await fetch(`/api/supabase-management?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

// Whether this project already has Cloud Backup's Edge Function deployed --
// by another Make It Local app sharing this project, or by this same app
// on a different device -- so the UI can offer "add this app to it"
// (joinExistingBackup below) instead of the normal install flow, which
// would otherwise generate a fresh passphrase and silently overwrite the
// one every other app sharing this project is already using. Read-only:
// only lists function slugs, never needs the backup passphrase itself.
export async function checkExistingBackupSetup(ref) {
  const token = await getValidAccessToken();
  if (!token) return false;
  try {
    const functions = await listDeployedFunctions(token, ref);
    return functions.some((fn) => fn.slug === "backup-sync");
  } catch {
    return false;
  }
}

// The "another app (or another device) already set this project up" entry
// point -- verifies the given passphrase actually works against the
// project's deployed backup-sync function before committing to anything
// locally, then re-runs the same steps a normal backup install would:
// heals this project's schema (see backup_schema.sql's dropped store
// constraint), redeploys this app's own copy of the Edge Functions
// (harmless -- the code is identical across every app), and re-sets the
// same passphrase as the project secret (a no-op, since it's already
// correct). Never generates a new passphrase -- that's the one thing that
// must never happen here, since it would break every other app already
// using this project. Returns true on success, false if the passphrase was
// wrong, or null if the project couldn't be reached at all.
export async function joinExistingBackup(passphrase, onProgress) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to Supabase.");
  const project = getSelectedProject();
  if (!project?.ref) throw new Error("No project selected.");
  const { ref } = project;

  let config = getApiConfig();
  if (!config?.url || !config?.anonKey) {
    const anonKey = await fetchPublishableKey(token, ref);
    config = { url: `https://${ref}.supabase.co`, anonKey, ref };
    setApiConfig(config);
  }

  const valid = await verifyPassphrase(passphrase, config);
  if (valid !== true) return valid;

  setBackupPassphrase(passphrase);

  for (const step of backupSteps(token, ref)) {
    onProgress?.(step.label, "running");
    try {
      await step.run();
    } catch (err) {
      onProgress?.(step.label, "error", err.message || "Something went wrong.");
      throw err;
    }
    onProgress?.(step.label, "done");
  }

  markFeaturesInstalled(ref, { backup: true });
  return true;
}

// onProgress(stepLabel, status) is called with status "running", "done", or
// "error" as each step starts/finishes, so the UI can show live checkmarks
// rather than one long spinner for what's actually several sequential
// requests. features = { rssSync: boolean, backup: boolean } -- at least
// one should be true.
export async function installCloudSync(features, onProgress) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to Supabase.");
  const project = getSelectedProject();
  if (!project?.ref) throw new Error("No project selected.");
  const { ref } = project;

  const steps = [
    ...(features?.rssSync ? rssSyncSteps(token, ref) : []),
    ...(features?.backup ? backupSteps(token, ref) : []),
    {
      label: CONNECT_STEP,
      run: async () => {
        const anonKey = await fetchPublishableKey(token, ref);
        setApiConfig({ url: `https://${ref}.supabase.co`, anonKey, ref });
      },
    },
  ];

  for (const step of steps) {
    onProgress?.(step.label, "running");
    try {
      await step.run();
    } catch (err) {
      onProgress?.(step.label, "error", err.message || "Something went wrong.");
      throw err;
    }
    onProgress?.(step.label, "done");
  }

  markFeaturesInstalled(ref, features);
}
