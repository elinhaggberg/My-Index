// Local photo uploads (Profile avatars, Tag covers, Image-snippet photos)
// are stored here instead of inline on their own record -- a phone photo
// easily runs a couple hundred KB, and keeping it out of the profiles/tags/
// snippets stores means listing/searching/filtering never has to load image
// bytes just to read a title. Ported verbatim from the same pattern already
// proven in My Bookshelf and My Closet, so a future shared cloud-image-sync
// mechanism can work identically across all three.
export const IDB_PREFIX = "idb:";

const DB_NAME = "my-index-images";
const STORE_NAME = "images";
const DB_VERSION = 1;

let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function putImage(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((r) => r.blob());
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Turns whatever a record's image field holds into something an <img> or
// background-image can actually load: a Blob (a fresh, not-yet-saved
// upload) becomes an object URL directly; an "idb:<id>" reference is looked
// up and turned into an object URL; anything else (a remote http(s) URL
// from an unfurled link, or a legacy inline data: URI from before this
// store existed) is already usable as-is.
export async function resolveImageSrc(ref) {
  if (!ref) return "";
  if (ref instanceof Blob) return URL.createObjectURL(ref);
  if (typeof ref === "string" && ref.startsWith(IDB_PREFIX)) {
    const blob = await getImage(ref.slice(IDB_PREFIX.length));
    return blob ? URL.createObjectURL(blob) : "";
  }
  return ref;
}
