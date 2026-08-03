// Runs the actual "install" on top of a connected Cloud Sync project --
// everything supabase/SETUP.md used to walk through by hand (run the
// schema, set a secret, deploy two Edge Functions, schedule the cron job)
// happens here instead, via the Management API endpoints in api/cloud-sync-*.
//
// Every step is an upsert (create-table-if-not-exists, deploy-or-update,
// unschedule-then-reschedule), so the whole sequence is safe to run again
// from scratch if it fails partway -- there's no separate "resume" logic,
// just re-run.
import { getValidAccessToken, getSelectedProject, setApiConfig } from "./supabaseOAuth.js";

const CRON_SECRET_NAME = "CRON_SECRET";

// Exported so the UI can render the full step list upfront (as pending)
// before install even starts, guaranteed to match what installCloudSync
// actually reports progress against below.
export const INSTALL_STEPS = [
  "Setting up database tables",
  "Creating a secret for scheduled checks",
  "Deploying the sync function",
  "Deploying the feed-check function",
  "Scheduling hourly feed checks",
  "Connecting the app to your project",
];

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
  if (!res.ok) throw new Error((data && data.error) || "Couldn't read the project's API keys.");
  const publishable = Array.isArray(data) ? data.find((k) => k.type === "publishable") : null;
  if (!publishable?.api_key) throw new Error("Couldn't find a publishable API key on this project.");
  return publishable.api_key;
}

// onProgress(stepLabel, status) is called with status "running", "done", or
// "error" as each step starts/finishes, so the UI can show live checkmarks
// rather than one long spinner for what's actually ~6 sequential requests.
export async function installCloudSync(onProgress) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not connected to Supabase.");
  const project = getSelectedProject();
  if (!project?.ref) throw new Error("No project selected.");
  const { ref } = project;

  // Generated once and reused in both the CRON_SECRET Edge Function secret
  // and the vault secret cron_setup.sql schedules the cron job with --
  // those two have to match, since check-feeds compares the header pg_cron
  // sends against this same value.
  const cronSecret = randomSecret();

  const [dbLabel, secretLabel, syncFnLabel, checkFnLabel, cronLabel, connectLabel] = INSTALL_STEPS;
  const steps = [
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
    {
      label: connectLabel,
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
}
