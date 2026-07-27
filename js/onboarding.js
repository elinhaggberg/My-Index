import { getOnboardingSeen, setOnboardingSeen } from "./storage.js";
import { openSheet } from "./sheet.js";

// Shows a condensed "how this app works" explainer exactly once, the very
// first time the app is ever opened on a device -- covers what a PWA is,
// that there's no server and no account, and that backups are the user's
// own responsibility. Runs regardless of whether there's data yet, unlike
// the What's New check, since this is about the app itself, not a changelog.
export function checkOnboarding() {
  if (getOnboardingSeen()) return;
  setOnboardingSeen();

  const sheet = openSheet("tpl-how-it-works");
  sheet.el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
  sheet.el.querySelector("#how-it-works-got-it-btn").addEventListener("click", () => sheet.close());
}
