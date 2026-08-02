import { openSheet } from "./sheet.js";
import { exportBackupData, importData, getHomeTitle, setHomeTitle, markBackedUp } from "./storage.js";
import { shareOrDownload } from "./share.js";
import { getTheme, setTheme, PLAYFUL_SWATCHES } from "./theme.js";
import {
  getConnectUrl,
  isCloudSyncConnected,
  disconnectCloudSync,
  listSupabaseProjects,
  getSelectedProject,
  setSelectedProject,
} from "./supabaseOAuth.js";
import { ICON_CHECK } from "./icons.js";

export function openSettingsMenu(nav, refresh) {
  const sheet = openSheet("tpl-settings-menu");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  el.querySelector("#instructions-btn").addEventListener("click", () => {
    sheet.close();
    openInstructions();
  });
  el.querySelector("#customize-btn").addEventListener("click", () => {
    sheet.close();
    openCustomize();
  });
  el.querySelector("#export-all-btn").addEventListener("click", async () => {
    const data = await exportBackupData();
    const stamp = new Date().toISOString().slice(0, 10);
    await shareOrDownload(`my-index-backup-${stamp}.json`, JSON.stringify(data, null, 2));
    markBackedUp();
    sheet.close();
  });
  el.querySelector("#import-btn").addEventListener("click", () => {
    sheet.close();
    openImport(refresh);
  });
  el.querySelector("#app-library-link-btn").addEventListener("click", () => {
    sheet.close();
    openAppLibraryPromo();
  });
  el.querySelector("#cloud-sync-btn").addEventListener("click", () => {
    sheet.close();
    openCloudSyncSheet();
  });
}

// Exported so app.js can jump straight here (with a connect/error message)
// right after the redirect back from Supabase's consent screen -- the whole
// point of showing feedback immediately rather than making the user dig
// back into Settings to find out whether it worked.
export function openCloudSyncSheet(oauthResult) {
  const sheet = openSheet("tpl-cloud-sync");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const messageEl = el.querySelector("#cloud-sync-message");
  const disconnectedEl = el.querySelector("#cloud-sync-disconnected");
  const connectedEl = el.querySelector("#cloud-sync-connected");

  if (oauthResult === "connected") {
    messageEl.textContent = "Connected!";
    messageEl.classList.remove("hidden", "error");
  } else if (oauthResult === "error") {
    messageEl.textContent = "Couldn't finish connecting to Supabase. Please try again.";
    messageEl.classList.remove("hidden");
    messageEl.classList.add("error");
  }

  async function render() {
    const connected = isCloudSyncConnected();
    disconnectedEl.classList.toggle("hidden", connected);
    connectedEl.classList.toggle("hidden", !connected);
    if (!connected) return;

    // The OAuth grant is per-organization, not per-project (see the consent
    // screen's own "ORGANIZATION" picker) -- it can see every project in
    // that org, including unrelated ones (e.g. a sibling app's). So this
    // list is never auto-selected; the user has to explicitly tap one.
    const statusLine = el.querySelector("#cloud-sync-status-line");
    const pickerEl = el.querySelector("#cloud-sync-project-picker");
    const projects = await listSupabaseProjects();
    const selected = getSelectedProject();

    if (!projects || !Array.isArray(projects)) {
      statusLine.textContent = "✓ Connected";
      pickerEl.replaceChildren();
      return;
    }
    if (projects.length === 0) {
      statusLine.textContent = "✓ Connected — no projects found on this account yet.";
      pickerEl.replaceChildren();
      return;
    }

    statusLine.textContent = selected ? `✓ Connected — ${selected.name}` : "Connected — which project is My Index's?";
    pickerEl.replaceChildren(
      ...projects.map((p) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "project-picker-row" + (selected?.ref === p.id ? " active" : "");
        const name = document.createElement("span");
        name.textContent = p.name;
        const check = document.createElement("span");
        check.innerHTML = ICON_CHECK;
        row.append(name, check);
        row.addEventListener("click", () => {
          setSelectedProject({ ref: p.id, name: p.name });
          render();
        });
        return row;
      })
    );
  }

  el.querySelector("#cloud-sync-connect-btn").addEventListener("click", () => {
    location.href = getConnectUrl();
  });
  el.querySelector("#cloud-sync-disconnect-btn").addEventListener("click", () => {
    disconnectCloudSync();
    render();
  });

  render();
}

function openAppLibraryPromo() {
  const sheet = openSheet("tpl-app-library-promo");
  sheet.el.querySelector(".cancel-btn").addEventListener("click", () => sheet.close());
}

function openInstructions() {
  const sheet = openSheet("tpl-instructions");
  sheet.el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
}

function openCustomize() {
  const sheet = openSheet("tpl-customize");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const titleInput = el.querySelector("#home-title-input");
  titleInput.value = getHomeTitle();
  titleInput.addEventListener("input", () => {
    setHomeTitle(titleInput.value);
    const homeTitleEl = document.getElementById("home-title");
    if (homeTitleEl) homeTitleEl.textContent = getHomeTitle();
  });

  const accentPicker = el.querySelector("#playful-accent-picker");
  const themeButtons = el.querySelectorAll(".theme-option");
  const swatchRow = el.querySelector("#playful-swatch-row");
  swatchRow.replaceChildren(
    ...PLAYFUL_SWATCHES.map((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch-btn";
      btn.dataset.accent = s.id;
      btn.style.background = s.accent;
      btn.setAttribute("aria-label", s.label);
      return btn;
    })
  );
  const swatchButtons = el.querySelectorAll(".swatch-btn");

  function renderActive() {
    const pref = getTheme();
    themeButtons.forEach((b) => b.classList.toggle("active", b.dataset.themeMode === pref.mode));
    swatchButtons.forEach((b) => b.classList.toggle("active", b.dataset.accent === pref.playfulAccent));
    accentPicker.classList.toggle("hidden", pref.mode !== "playful");
  }

  themeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setTheme({ ...getTheme(), mode: btn.dataset.themeMode });
      renderActive();
    });
  });
  swatchButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setTheme({ ...getTheme(), playfulAccent: btn.dataset.accent });
      renderActive();
    });
  });

  renderActive();
}

function openImport(refresh) {
  const sheet = openSheet("tpl-import");
  const fileInput = sheet.el.querySelector(".import-file-input");
  const messageEl = sheet.el.querySelector(".import-message");

  sheet.el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
  sheet.el.querySelector(".import-file-btn").addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    messageEl.classList.remove("error");

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      messageEl.textContent = "That doesn't look like valid JSON.";
      messageEl.classList.add("error");
      return;
    }
    try {
      const result = await importData(parsed);
      const parts = [];
      if (result.profileCount) parts.push(`${result.profileCount} profile${result.profileCount !== 1 ? "s" : ""}`);
      if (result.snippetCount) parts.push(`${result.snippetCount} snippet${result.snippetCount !== 1 ? "s" : ""}`);
      let text = parts.length ? `Imported ${parts.join(" and ")}.` : "Import complete.";
      if (result.preferencesApplied) text += " Restored your theme/settings too.";
      messageEl.textContent = text;
      if (refresh) refresh();
      setTimeout(() => sheet.close(), 900);
    } catch (err) {
      messageEl.textContent = err.message || "That doesn't look like a valid export file.";
      messageEl.classList.add("error");
    }
  });
}
