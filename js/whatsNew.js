import { getProfiles, getSnippets, getLastSeenVersion, setLastSeenVersion } from "./storage.js";
import { openSheet } from "./sheet.js";
import { APP_VERSION, CHANGELOG } from "./version.js";

// Shows a "what's new" sheet once per version, but only to returning
// visitors — a brand-new install has nothing to update *from*, so it just
// records the current version silently instead of greeting a first-time
// user with a changelog.
export async function checkWhatsNew() {
  const lastSeen = getLastSeenVersion();
  if (lastSeen === APP_VERSION) return;

  const [profiles, snippets] = await Promise.all([getProfiles(), getSnippets()]);
  const isFreshInstall = !lastSeen && profiles.length === 0 && snippets.length === 0;
  setLastSeenVersion(APP_VERSION);
  if (isFreshInstall) return;

  // A known prior version shows everything shipped since then; an unknown
  // one (someone updating from before this system existed) falls back to
  // just the latest entry, since there's no earlier history to compare to.
  const entries = lastSeen ? CHANGELOG.filter((entry) => entry.version > lastSeen) : CHANGELOG.slice(-1);
  if (entries.length === 0) return;

  openWhatsNewSheet(entries);
}

function openWhatsNewSheet(entries) {
  const sheet = openSheet("tpl-whats-new");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
  el.querySelector("#whats-new-got-it-btn").addEventListener("click", () => sheet.close());

  const body = el.querySelector("#whats-new-body");
  body.replaceChildren(
    ...entries.map((entry) => {
      const section = document.createElement("section");
      const h3 = document.createElement("h3");
      h3.textContent = entry.date;
      const ul = document.createElement("ul");
      ul.replaceChildren(
        ...entry.changes.map((change) => {
          const li = document.createElement("li");
          li.textContent = change;
          return li;
        })
      );
      section.append(h3, ul);
      return section;
    })
  );
}
