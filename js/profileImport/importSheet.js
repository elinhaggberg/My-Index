// The "Import from a link" sheet, opened from the New profile editor:
// paste a website, see who it says it belongs to and where else they
// publish, choose which feeds to follow, then hand the result back to the
// editor for a last look before saving. Nothing is saved from here.
//
// A found feed is never followed silently (the Oltra spec, §8.1a): every
// feed gets its own "Follow feed" checkbox, checked by default.

import { openSheet } from "../sheet.js";
import { readAndResizeImage } from "../imageBlob.js";
import { CHANNEL_TYPE_LABELS } from "../channelTypes.js";
import { resolveProfile, fetchProfileImage } from "./resolve.js";
import { toMyIndexChannels, toMyIndexFields } from "./toMyIndex.js";
import { classifyChannel } from "./classify.js";

const SOURCE_LABELS = {
  "h-card": "From the profile published on",
  page: "No profile found, only a feed on",
};

export function openProfileImportSheet({ onApply }) {
  const sheet = openSheet("tpl-profile-import");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const input = el.querySelector("#import-url-input");
  const findBtn = el.querySelector("#import-find-btn");
  const msg = el.querySelector("#import-message");
  const preview = el.querySelector("#import-preview");
  const toggleAllBtn = el.querySelector("#import-toggle-all");

  let found = null;
  let follow = [];
  let imageBlob = null;
  let imageObjectUrl = "";

  function setMessage(text, isError = false) {
    msg.textContent = text;
    msg.classList.toggle("error", isError);
    msg.classList.toggle("hidden", !text);
  }

  function renderAvatar(name) {
    const avatar = el.querySelector("#import-avatar");
    if (imageObjectUrl) {
      avatar.style.backgroundImage = `url("${imageObjectUrl}")`;
      avatar.classList.add("has-image");
      avatar.textContent = "";
    } else {
      avatar.style.backgroundImage = "";
      avatar.classList.remove("has-image");
      avatar.textContent = (name || "?").trim().charAt(0).toUpperCase() || "?";
    }
  }

  function renderChannels() {
    const list = el.querySelector("#import-channels");
    const feeds = found.profile.channels.filter((c) => c.type === "feed").length;
    toggleAllBtn.classList.toggle("hidden", feeds < 2);
    const anyFollowed = found.profile.channels.some((c, i) => c.type === "feed" && follow[i] !== false);
    toggleAllBtn.textContent = anyFollowed ? "Uncheck all" : "Check all";

    list.replaceChildren(
      ...found.profile.channels.map((channel, i) => {
        const row = document.createElement("label");
        row.className = "import-channel";

        const { type } = classifyChannel(channel.url, { hasFeed: channel.type === "feed", isHome: channel.isHome });
        const meta = document.createElement("span");
        meta.className = "import-channel-meta";
        const typeEl = document.createElement("span");
        typeEl.className = "channel-view-type";
        typeEl.textContent = channel.isHome ? `${CHANNEL_TYPE_LABELS[type] || "Website"} · own site` : CHANNEL_TYPE_LABELS[type] || "Other";
        const urlEl = document.createElement("span");
        urlEl.className = "import-channel-url";
        // The destination domain is always shown, not just a label -- a
        // link called "Instagram" should visibly go to instagram.com (A3).
        urlEl.textContent = channel.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
        meta.append(typeEl, urlEl);

        const right = document.createElement("span");
        right.className = "import-channel-right";
        if (channel.type === "feed") {
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = follow[i] !== false;
          box.addEventListener("change", () => {
            follow[i] = box.checked;
            renderChannels();
          });
          const label = document.createElement("span");
          label.textContent = "Follow feed";
          right.append(label, box);
        } else {
          right.textContent = "Link only";
          row.classList.add("door");
        }
        row.append(meta, right);
        return row;
      })
    );
  }

  toggleAllBtn.addEventListener("click", () => {
    const anyFollowed = found.profile.channels.some((c, i) => c.type === "feed" && follow[i] !== false);
    follow = found.profile.channels.map(() => !anyFollowed);
    renderChannels();
  });

  function renderPreview() {
    const { profile, provenance } = found;
    el.querySelector("#import-name").textContent = profile.name;
    const pronounsEl = el.querySelector("#import-pronouns");
    pronounsEl.textContent = profile.pronouns;
    pronounsEl.classList.toggle("hidden", !profile.pronouns);
    el.querySelector("#import-provenance").textContent = `${SOURCE_LABELS[provenance.source] || "From"} ${provenance.domain}`;
    const bioEl = el.querySelector("#import-bio");
    bioEl.textContent = profile.bio;
    bioEl.classList.toggle("hidden", !profile.bio);
    renderAvatar(profile.name);
    renderChannels();
    preview.classList.remove("hidden");
  }

  async function find() {
    const value = input.value.trim();
    if (!value) return;
    findBtn.disabled = true;
    findBtn.classList.add("loading");
    preview.classList.add("hidden");
    setMessage("Looking for a profile and its channels…");
    found = null;
    imageBlob = null;
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = "";
    try {
      found = await resolveProfile(value);
      follow = found.profile.channels.map(() => true);
      setMessage(found.provenance.fallback ? "Found a profile, though the page doesn't mark it as the site owner's for certain — check it's the right person." : "");
      renderPreview();
      // The photo loads in the background; the preview is usable without it.
      if (found.profile.image) {
        fetchProfileImage(found.profile.image.url)
          .then((blob) => readAndResizeImage(blob))
          .then((resized) => {
            imageBlob = resized;
            imageObjectUrl = URL.createObjectURL(resized);
            renderAvatar(found.profile.name);
          })
          .catch(() => {});
      }
    } catch (err) {
      setMessage(err.message || "Couldn't import from that link.", true);
    } finally {
      findBtn.disabled = false;
      findBtn.classList.remove("loading");
    }
  }

  findBtn.addEventListener("click", find);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      find();
    }
  });

  el.querySelector("#import-apply-btn").addEventListener("click", () => {
    if (!found) return;
    onApply({
      ...toMyIndexFields(found),
      image: imageBlob,
      imageAlt: found.profile.image?.alt || "",
      channels: toMyIndexChannels(found.profile.channels, follow),
    });
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    sheet.close();
  });

  setTimeout(() => input.focus(), 50);
}

