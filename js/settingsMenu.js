import { openSheet } from "./sheet.js";
import {
  exportBackupData,
  importData,
  getHomeTitle,
  setHomeTitle,
  markBackedUp,
  getProfiles,
  getTags,
  getSnippets,
  upsertRecords,
  getTombstones,
  clearTombstones,
  applyRemoteDeletion,
  getShowProfileRow,
  setShowProfileRow,
} from "./storage.js";
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
  getWizardStep,
  setWizardStep,
} from "./supabaseOAuth.js";
import { installCloudSync, getInstallSteps, getInstalledFeatures } from "./cloudSyncInstall.js";
import { resyncAllChannels } from "./feedSync.js";
import { isBackupConfigured, getPairingCode, getLastSyncedDisplay, syncNow, applyPairingCode } from "./cloudBackup.js";
import { ICON_CHECK } from "./icons.js";

const STORAGE_FNS = {
  getProfiles,
  getTags,
  getSnippets,
  upsertRecords,
  getTombstones,
  clearTombstones,
  applyRemoteDeletion,
};

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
    openCustomize(refresh);
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

// Disabled alone looked identical to a normal button, giving no sign a tap
// had registered while a several-request install/resync/sync was actually
// running. Grays the button out, adds a spinner, and swaps in a "working"
// label until restoreButton puts it back. Shared by every Cloud Sync
// button that does real async work.
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
  const wizardSteps = [
    el.querySelector("#cloud-wizard-step-1"),
    el.querySelector("#cloud-wizard-step-2"),
    el.querySelector("#cloud-wizard-step-3"),
  ];

  // Only ever shown pre-connection -- someone who's connected before (even
  // if currently disconnected) skips straight to step 3's Connect button,
  // see getWizardStep's own comment in supabaseOAuth.js.
  function renderWizard() {
    const step = getWizardStep();
    wizardSteps.forEach((stepEl, i) => stepEl.classList.toggle("hidden", i !== step));
  }
  el.querySelector("#cloud-wizard-step1-continue-btn").addEventListener("click", () => {
    setWizardStep(1);
    renderWizard();
  });
  el.querySelector("#cloud-wizard-step2-continue-btn").addEventListener("click", () => {
    setWizardStep(2);
    renderWizard();
  });
  el.querySelector("#cloud-wizard-step2-back-btn").addEventListener("click", () => {
    setWizardStep(0);
    renderWizard();
  });
  el.querySelector("#cloud-wizard-step3-back-btn").addEventListener("click", () => {
    setWizardStep(1);
    renderWizard();
  });

  if (oauthResult === "connected") {
    messageEl.textContent = "Connected!";
    messageEl.classList.remove("hidden", "error");
  } else if (oauthResult === "error") {
    messageEl.textContent = "Couldn't finish connecting to Supabase. Please try again.";
    messageEl.classList.remove("hidden");
    messageEl.classList.add("error");
  }

  const featureSummaryEl = el.querySelector("#cloud-sync-feature-summary");
  const manageToggleRowEl = el.querySelector("#cloud-sync-manage-toggle-row");
  const manageBtn = el.querySelector("#cloud-sync-manage-btn");
  const manageSectionEl = el.querySelector("#cloud-sync-manage-section");
  const installSectionEl = el.querySelector("#cloud-sync-install-section");
  const installStepsEl = el.querySelector("#cloud-sync-install-steps");
  const installBtn = el.querySelector("#cloud-sync-install-btn");
  const rssCheckbox = el.querySelector("#cloud-sync-feature-rss");
  const backupCheckbox = el.querySelector("#cloud-sync-feature-backup");
  const resyncSectionEl = el.querySelector("#cloud-sync-resync-section");
  const resyncBtn = el.querySelector("#cloud-sync-resync-btn");
  const resyncMessageEl = el.querySelector("#cloud-sync-resync-message");
  const backupSectionEl = el.querySelector("#cloud-sync-backup-section");
  const lastSyncedEl = el.querySelector("#cloud-sync-last-synced");
  const syncNowBtn = el.querySelector("#cloud-sync-sync-now-btn");
  const backupMessageEl = el.querySelector("#cloud-sync-backup-message");
  const showPairingBtn = el.querySelector("#cloud-sync-show-pairing-btn");
  const pairingCodeEl = el.querySelector("#cloud-sync-pairing-code");
  const copyPairingActionsEl = el.querySelector("#cloud-sync-copy-pairing-actions");
  const copyPairingBtn = el.querySelector("#cloud-sync-copy-pairing-btn");

  function selectedFeatures() {
    return { rssSync: rssCheckbox.checked, backup: backupCheckbox.checked };
  }

  // Once at least one feature is actually installed, the project picker /
  // feature checkboxes / install steps / Disconnect are mostly one-time
  // setup noise, not something worth re-showing on every visit -- collapsed
  // by default, revealed by "Manage connection." Stays forced-open before
  // anything's installed (there's nothing to collapse to yet, and the
  // install flow *is* the primary thing to show) or once the user's
  // explicitly asked to see it. Resets to collapsed each time this sheet is
  // freshly opened, along with everything else in this closure.
  let manageExpanded = false;
  function updateManageVisibility(hasAnyFeatureInstalled) {
    const shouldExpand = !hasAnyFeatureInstalled || manageExpanded;
    manageSectionEl.classList.toggle("hidden", !shouldExpand);
    manageToggleRowEl.classList.toggle("hidden", !hasAnyFeatureInstalled);
    manageBtn.textContent = manageExpanded ? "Hide details" : "Manage connection";
  }
  manageBtn.addEventListener("click", () => {
    manageExpanded = !manageExpanded;
    updateManageVisibility(true);
  });

  function renderSteps(statusByLabel, messageByLabel) {
    installStepsEl.replaceChildren(
      ...getInstallSteps(selectedFeatures()).flatMap((label) => {
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
    const features = selectedFeatures();
    if (!features.rssSync && !features.backup) return;
    setButtonBusy(installBtn, "Installing…");
    const statusByLabel = new Map();
    const messageByLabel = new Map();
    renderSteps(statusByLabel, messageByLabel);
    try {
      await installCloudSync(features, (label, status, message) => {
        statusByLabel.set(label, status);
        if (message) messageByLabel.set(label, message);
        renderSteps(statusByLabel, messageByLabel);
      });
      restoreButton(installBtn, "Install selected");
      // Reveals the Resync/Backup sections immediately rather than only
      // after closing and reopening the sheet.
      await render();
      // Otherwise nothing actually reaches the cloud until the user
      // remembers to hit "Sync now" themselves, or up to 15 minutes pass --
      // a fresh install should push right away so a pairing code handed to
      // a second device immediately has something to pull.
      if (features.backup) await runSyncNow();
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

  function renderLastSynced() {
    const last = getLastSyncedDisplay();
    lastSyncedEl.textContent = last ? `Last synced ${last.toLocaleString()}.` : "Not synced yet.";
  }

  async function runSyncNow() {
    setButtonBusy(syncNowBtn, "Syncing…");
    backupMessageEl.classList.add("hidden");
    try {
      await syncNow(STORAGE_FNS);
      renderLastSynced();
      backupMessageEl.textContent = "Synced!";
      backupMessageEl.classList.remove("hidden", "error");
    } catch {
      backupMessageEl.textContent = "Couldn't sync right now. Please try again.";
      backupMessageEl.classList.remove("hidden");
      backupMessageEl.classList.add("error");
    } finally {
      restoreButton(syncNowBtn, "Sync now");
    }
  }

  showPairingBtn.addEventListener("click", () => {
    const code = getPairingCode();
    if (!code) return;
    pairingCodeEl.value = code;
    pairingCodeEl.classList.remove("hidden");
    copyPairingActionsEl.classList.remove("hidden");
  });
  copyPairingBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pairingCodeEl.value);
      copyPairingBtn.textContent = "Copied!";
    } catch {
      pairingCodeEl.select();
      copyPairingBtn.textContent = "Select and copy manually";
    }
    setTimeout(() => {
      copyPairingBtn.textContent = "Copy pairing code";
    }, 2000);
  });
  syncNowBtn.addEventListener("click", runSyncNow);

  async function render() {
    const connected = isCloudSyncConnected();
    disconnectedEl.classList.toggle("hidden", connected);
    connectedEl.classList.toggle("hidden", !connected);
    if (!connected) {
      renderWizard();
      return;
    }

    // The OAuth grant is per-organization, not per-project (see the consent
    // screen's own "ORGANIZATION" picker) -- it can see every project in
    // that org, including unrelated ones (e.g. a sibling app's). So this
    // list is never auto-selected; the user has to explicitly tap one.
    const statusLine = el.querySelector("#cloud-sync-status-line");
    const pickerEl = el.querySelector("#cloud-sync-project-picker");
    const loadingEl = el.querySelector("#cloud-sync-loading");

    // listSupabaseProjects is a real network round-trip (a couple seconds,
    // not instant) -- without this, the connected panel appears with
    // nothing in it (blank status line, no picker, every section still
    // hidden from its default state) for however long that takes, which
    // reads as "Cloud Sync looks off" rather than "still loading." Hides
    // every section that's about to be rewritten so there's no flash of
    // stale content from a previous render either.
    loadingEl.classList.remove("hidden");
    statusLine.textContent = "";
    pickerEl.replaceChildren();
    installSectionEl.classList.add("hidden");
    resyncSectionEl.classList.add("hidden");
    backupSectionEl.classList.add("hidden");
    featureSummaryEl.classList.add("hidden");
    manageToggleRowEl.classList.add("hidden");

    const projects = await listSupabaseProjects();
    const selected = getSelectedProject();
    loadingEl.classList.add("hidden");

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
    let installed = { rssSync: false, backup: false };
    if (selected) {
      installed = getInstalledFeatures(selected.ref);
      rssCheckbox.checked = installed.rssSync;
      rssCheckbox.disabled = installed.rssSync;
      // Left enabled (unlike rssCheckbox above) even once installed --
      // re-running install is idempotent (every step is an upsert, see
      // cloudSyncInstall.js), and it's the only way an existing install
      // picks up new backup steps added later, like the image-sync
      // function backup-image (see js/cloudImageSync.js).
      backupCheckbox.checked = installed.backup;
      renderSteps(new Map(getInstallSteps(selectedFeatures()).map((label) => [label, "done"])));
    }
    resyncSectionEl.classList.toggle("hidden", !installed.rssSync);
    resyncMessageEl.classList.add("hidden");
    backupSectionEl.classList.toggle("hidden", !installed.backup || !isBackupConfigured());
    if (installed.backup) {
      renderLastSynced();
      backupMessageEl.classList.add("hidden");
      pairingCodeEl.classList.add("hidden");
      copyPairingActionsEl.classList.add("hidden");
    }

    const hasAnyFeatureInstalled = installed.rssSync || installed.backup;
    featureSummaryEl.replaceChildren(
      ...[
        installed.rssSync && "RSS sync",
        installed.backup && "Cloud Backup",
      ]
        .filter(Boolean)
        .map((label) => {
          const row = document.createElement("p");
          row.className = "cloud-sync-feature-summary-row";
          row.innerHTML = `${ICON_CHECK}<span>${label}</span>`;
          return row;
        })
    );
    featureSummaryEl.classList.toggle("hidden", !hasAnyFeatureInstalled);
    updateManageVisibility(hasAnyFeatureInstalled);
  }

  rssCheckbox.addEventListener("change", () => renderSteps(new Map()));
  backupCheckbox.addEventListener("change", () => renderSteps(new Map()));

  el.querySelector("#cloud-sync-connect-btn").addEventListener("click", () => {
    location.href = getConnectUrl();
  });
  el.querySelector("#cloud-sync-restore-btn").addEventListener("click", () => {
    sheet.close();
    openCloudRestoreSheet();
  });
  el.querySelector("#cloud-sync-disconnect-btn").addEventListener("click", () => {
    disconnectCloudSync();
    render();
  });
  installBtn.addEventListener("click", runInstall);
  resyncBtn.addEventListener("click", runResync);

  render();
}

// The second-device entry point -- pastes a pairing code (project URL +
// anon key + backup passphrase, see js/cloudBackup.js) instead of going
// through the OAuth consent flow. This device never touches the
// Management API at all, so it doesn't need its own Supabase login.
function openCloudRestoreSheet() {
  const sheet = openSheet("tpl-cloud-restore");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const codeInput = el.querySelector("#cloud-restore-code");
  const messageEl = el.querySelector("#cloud-restore-message");
  const applyBtn = el.querySelector("#cloud-restore-apply-btn");

  applyBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) return;
    setButtonBusy(applyBtn, "Restoring…");
    messageEl.classList.add("hidden");
    try {
      const applied = applyPairingCode(code);
      if (!applied) {
        messageEl.textContent = "That doesn't look like a valid pairing code.";
        messageEl.classList.remove("hidden");
        messageEl.classList.add("error");
        return;
      }
      const result = await syncNow(STORAGE_FNS);
      if (!result.synced) {
        messageEl.textContent = "Connected, but couldn't reach the backup — check the code and try again.";
        messageEl.classList.remove("hidden");
        messageEl.classList.add("error");
        return;
      }
      messageEl.textContent = "Restored! Your data should be here now.";
      messageEl.classList.remove("hidden", "error");
      setTimeout(() => sheet.close(), 1200);
    } finally {
      restoreButton(applyBtn, "Restore");
    }
  });
}

function openAppLibraryPromo() {
  const sheet = openSheet("tpl-app-library-promo");
  sheet.el.querySelector(".cancel-btn").addEventListener("click", () => sheet.close());
}

function openInstructions() {
  const sheet = openSheet("tpl-instructions");
  sheet.el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
}

function openCustomize(refresh) {
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

  // Only meaningfully affects Home (the only view with a profile row to
  // toggle) -- refresh is a no-op if this sheet happened to be opened from
  // Profiles/Tags/a Tag page instead, same as it is for every other
  // per-view settings action.
  const showProfileRowToggle = el.querySelector("#customize-show-profile-row");
  showProfileRowToggle.checked = getShowProfileRow();
  showProfileRowToggle.addEventListener("change", () => {
    setShowProfileRow(showProfileRowToggle.checked);
    if (refresh) refresh();
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
