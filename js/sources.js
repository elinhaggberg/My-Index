// Excerpts and their sources. A quote from an article and the article
// itself are both ordinary snippets, living side by side in the register;
// they're connected two ways:
//   - explicitly: an excerpt's sourceId points to the snippet it came from
//     (the only way for a book, which has no link)
//   - implicitly: an excerpt and a source with the same link belong
//     together, without anyone having to say so -- e.g. a quote saved from
//     the reader and the article saved as a Link
// An excerpt can also carry a page ("42", "s. 42", "ch. 3"), so excerpts
// from a source can be listed in reading order.
// Any snippet can name a source explicitly -- an image or a link can come
// from a particular web page or book too. The implicit same-link pairing
// stays for excerpts only, so two links to the same page don't claim each
// other.

import { getSnippets } from "./storage.js";
import { typeFor } from "./snippetTypes.js";
import { hostnameFor } from "./util.js";

export const isExcerpt = (s) => !!typeFor(s?.type).excerpt;
export const isSource = (s) => !!typeFor(s?.type).source;

function sameLink(a, b) {
  const norm = (u) => {
    try {
      const url = new URL(u);
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  };
  const na = norm(a);
  return !!na && na === norm(b);
}

export function sourceTitle(s) {
  return (s.content || s.title || s.siteName || hostnameFor(s.url) || "Untitled").trim();
}

// "42" -> "p. 42"; anything else ("s. 42", "ch. 3", "12:30") as typed.
export function pageLabel(page) {
  const p = String(page || "").trim();
  if (!p) return "";
  return /^\d+([–-]\d+)?$/.test(p) ? `p. ${p}` : p;
}

// Reading order: by the page's leading number when there is one, then by
// when it was saved.
function byPage(a, b) {
  const num = (s) => {
    const m = String(s.page || "").match(/\d+/);
    return m ? Number(m[0]) : Infinity;
  };
  return num(a) - num(b) || (a.createdAt || 0) - (b.createdAt || 0);
}

// The source an excerpt came from, if it's in the register.
export function findSource(excerpt, all) {
  if (excerpt.sourceId) {
    const explicit = all.find((s) => s.id === excerpt.sourceId);
    if (explicit) return explicit;
  }
  if (!isExcerpt(excerpt) || !excerpt.url) return null;
  return all.find((s) => s.id !== excerpt.id && isSource(s) && sameLink(s.url, excerpt.url)) || null;
}

// Every excerpt that belongs to a source, in reading order.
export function findExcerpts(source, all) {
  return all
    .filter((s) => s.id !== source.id && (s.sourceId === source.id || (isExcerpt(s) && !s.sourceId && source.url && sameLink(s.url, source.url))))
    .sort(byPage);
}

// Other excerpts from the same place as this one -- through their shared
// source, or, when the source itself was never saved, their shared link.
export function findSiblings(excerpt, all) {
  const source = findSource(excerpt, all);
  if (source) return findExcerpts(source, all).filter((s) => s.id !== excerpt.id);
  if (!isExcerpt(excerpt) || !excerpt.url) return [];
  return all.filter((s) => s.id !== excerpt.id && isExcerpt(s) && !s.sourceId && sameLink(s.url, excerpt.url)).sort(byPage);
}

// Whether `candidate` can be `snippet`'s source: not itself, and not
// anything that (through its own sources) already comes from `snippet` --
// no loops.
export function canBeSourceOf(candidate, snippet, all) {
  if (!isSource(candidate) || candidate.id === snippet.id) return false;
  const byId = new Map(all.map((s) => [s.id, s]));
  const seen = new Set();
  for (let s = candidate; s?.sourceId && !seen.has(s.id); s = byId.get(s.sourceId)) {
    seen.add(s.id);
    if (s.sourceId === snippet.id) return false;
  }
  return true;
}

// Excerpt counts for a grid's source cards: one read of all snippets shared
// by every card rendered in the same moment, rather than one each.
let countsPromise = null;
export function getExcerptCount(source) {
  if (!countsPromise) {
    countsPromise = getSnippets();
    setTimeout(() => (countsPromise = null), 500);
  }
  return countsPromise.then((all) => findExcerpts(source, all).length);
}
