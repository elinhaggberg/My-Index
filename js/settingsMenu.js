import { openSheet } from "./sheet.js";
import { exportBackupData, importData, getHomeTitle, setHomeTitle, markBackedUp, getProfiles } from "./storage.js";
import { shareOrDownload } from "./share.js";
import { getTheme, setTheme, PLAYFUL_SWATCHES } from "./theme.js";
import {
  getConnectUrl,
  isCloudSyncConnected,
  disconnectCloudSync,
  listSupabaseProjects,
  getSelectedProject,
  setSelectedProject,
  getApiConfig,
} from "./supabaseOAuth.js";
import { installCloudSync, INSTALL_STEPS } from "./cloudSyncInstall.js";
import { resyncAllChannels } from "./feedSync.js";
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

  const installSectionEl = el.querySelector("#cloud-sync-install-section");
  const installStepsEl = el.querySelector("#cloud-sync-install-steps");
  const installBtn = el.querySelector("#cloud-sync-install-btn");
  const resyncSectionEl = el.querySelector("#cloud-sync-resync-section");
  const resyncBtn = el.querySelector("#cloud-sync-resync-btn");
  const resyncMessageEl = el.querySelector("#cloud-sync-resync-message");

  // Disabled alone looked identical to a normal button, giving no sign a
  // tap had registered while the (multi-second, several-requests) install
  // or resync was actually running. Grays the button out, adds a spinner,
  // and swaps in a "working" label until restoreButton puts it back.
  function setButtonBusy(btn, busyText) {
    btn.dataset.restoreText = btn.textContent;
    btn.disabled = true;
    btn.classList.add("loading");
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${busyText}`;
  }
  function restoreButton(btn, finalText) {
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.textContent = finalText ?? btn.dataset.restoreText;
  }

  function renderSteps(statusByLabel, messageByLabel) {
    installStepsEl.replaceChildren(
      ...INSTALL_STEPS.flatMap((label) => {
        const status = statusByLabel.get(label) || "pending";
        const row = document.createElement("div");
        row.className = "cloud-sync-step " + status;
        const mark = document.createElement("span");
        mark.className = "cloud-sync-step-mark";
        mark.textContent = status === "done" ? "✓" : status === "error" ? "✕" : status === "running" ? "…" : "○";
        const text = document.createElement("span");
        text.textContent = label;
        row.append(mark, text);

        const message = status === "error" ? messageByLabel?.get(label) : null;
        if (!message) return [row];
        const detail = document.createElement("p");
        detail.className = "cloud-sync-step-error";
        detail.textContent = message;
        return [row, detail];
      })
    );
  }

  async function runInstall() {
    setButtonBusy(installBtn, "Installing…");
    const statusByLabel = new Map();
    const messageByLabel = new Map();
    renderSteps(statusByLabel, messageByLabel);
    try {
      await installCloudSync((label, status, message) => {
        statusByLabel.set(label, status);
        if (message) messageByLabel.set(label, message);
        renderSteps(statusByLabel, messageByLabel);
      });
      restoreButton(installBtn, "Reinstall RSS sync");
      // Reveals the "Resync all channels" section immediately rather than
      // only after closing and reopening the sheet.
      await render();
    } catch {
      // The failed step is already marked (with its error message) in the
      // list above -- nothing more to say here, and the whole sequence is
      // safe to just re-run.
      restoreButton(installBtn);
    }
  }

  async function runResync() {
    setButtonBusy(resyncBtn, "Resyncing…");
    resyncMessageEl.classList.add("hidden");
    try {
      const count = await resyncAllChannels(getProfiles);
      resyncMessageEl.textContent = count > 0 ? `Resynced ${count} channel${count === 1 ? "" : "s"}.` : "No RSS channels found to resync.";
      resyncMessageEl.classList.remove("hidden", "error");
    } catch {
      resyncMessageEl.textContent = "Couldn't resync right now. Please try again.";
      resyncMessageEl.classList.remove("hidden");
      resyncMessageEl.classList.add("error");
    } finally {
      restoreButton(resyncBtn);
    }
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
      installSectionEl.classList.add("hidden");
      return;
    }
    if (projects.length === 0) {
      statusLine.textContent = "✓ Connected — no projects found on this account yet.";
      pickerEl.replaceChildren();
      installSectionEl.classList.add("hidden");
      return;
    }

    statusLine.textContent = selected ? `✓ Connected — ${selected.name}` : "Connected — which project is My Index's?";
    pickerEl.replaceChildren(
      ...projects.map((p) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "project-picker-row" + (selected?.ref === p.ref ? " active" : "");
        const name = document.createElement("span");
        name.textContent = p.name;
        const check = document.createElement("span");
        check.innerHTML = ICON_CHECK;
        row.append(name, check);
        row.addEventListener("click", () => {
          setSelectedProject({ ref: p.ref, name: p.name });
          render();
        });
        return row;
      })
    );

    installSectionEl.classList.toggle("hidden", !selected);
    let alreadyInstalled = false;
    if (selected) {
      const apiConfig = getApiConfig();
      alreadyInstalled = apiConfig?.ref === selected.ref;
      const statusByLabel = new Map(alreadyInstalled ? INSTALL_STEPS.map((label) => [label, "done"]) : []);
      renderSteps(statusByLabel);
      installBtn.textContent = alreadyInstalled ? "Reinstall RSS sync" : "Install RSS sync";
    }
    resyncSectionEl.classList.toggle("hidden", !alreadyInstalled);
    resyncMessageEl.classList.add("hidden");
  }

  el.querySelector("#cloud-sync-connect-btn").addEventListener("click", () => {
    location.href = getConnectUrl();
  });
  el.querySelector("#cloud-sync-disconnect-btn").addEventListener("click", () => {
    disconnectCloudSync();
    render();
  });
  installBtn.addEventListener("click", runInstall);
  resyncBtn.addEventListener("click", runResync);

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
