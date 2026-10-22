// "Share from iOS": the values an iOS Shortcut needs to send a link or a
// bit of text to the Inbox, ready to copy -- previously they had to be dug
// out of the browser's developer tools, which isn't possible on a phone.
//
// Why a queue in the user's own Supabase project rather than a link: iOS's
// webapp:// scheme opens the installed app, but passes on nothing beyond
// its address (tested), and a plain https:// link would open Safari, whose
// storage is separate from the installed app's. So the Shortcut posts the
// item to the sync-index function's "capture" action, then opens the app,
// which imports whatever is waiting (see importQueuedCaptures in app.js).

import { openSheet } from "./sheet.js";
import { getApiConfig } from "./supabaseOAuth.js";
import { getInstalledFeatures } from "./cloudSyncInstall.js";
import { getDeviceId } from "./feedSync.js";

function projectRef(url) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

function valueRow(label, value, hint) {
  const row = document.createElement("div");
  row.className = "shortcut-value";
  const top = document.createElement("div");
  top.className = "shortcut-value-top";
  const name = document.createElement("span");
  name.className = "shortcut-value-label";
  name.textContent = label;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "text-btn secondary shortcut-copy-btn";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select and copy";
    }
    setTimeout(() => (copy.textContent = "Copy"), 1600);
  });
  top.append(name, copy);
  const code = document.createElement("code");
  code.className = "shortcut-value-code";
  code.textContent = value;
  row.append(top, code);
  if (hint) {
    const h = document.createElement("p");
    h.className = "shortcut-value-hint";
    h.textContent = hint;
    row.appendChild(h);
  }
  return row;
}

export function openShortcutSetup() {
  const sheet = openSheet("tpl-shortcut-setup");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const config = getApiConfig();
  if (!config?.url || !config?.anonKey) {
    el.querySelector("#shortcut-not-ready").classList.remove("hidden");
    return;
  }
  if (!getInstalledFeatures(projectRef(config.url)).rssSync) {
    el.querySelector("#shortcut-rss-note").classList.remove("hidden");
  }

  el.querySelector("#shortcut-steps").classList.remove("hidden");
  el.querySelector("#shortcut-values").replaceChildren(
    valueRow("Address (Get Contents of URL)", `${config.url}/functions/v1/sync-index`),
    valueRow("Header: apikey", config.anonKey),
    valueRow("Header: Content-Type", "application/json"),
    valueRow("JSON field: action", "capture"),
    valueRow("JSON field: deviceId", getDeviceId()),
    valueRow("JSON field: url", "Shortcut Input", "Not copied as text: pick the Shortcut Input variable."),
    valueRow("Address (Open URLs)", `webapp://${location.host}/`)
  );
}
