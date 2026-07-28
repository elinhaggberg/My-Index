// Profile avatars and Tag cover images are stored as data: URI strings
// directly on their IndexedDB record. An earlier version stored them as
// raw Blobs instead, which turned out to hit a real WebKit/Safari bug:
// a Blob just written to IndexedDB isn't reliably readable again on the
// *same* database connection -- it renders broken (a question-mark icon)
// until the app is fully restarted, which opens a fresh connection and
// reads it correctly. A plain string doesn't go through IndexedDB's
// special Blob-handling path at all, so it doesn't hit that bug -- the
// ~33% base64 size overhead is a non-issue at these dimensions/quality.
const MAX_DIMENSION = 960;
const JPEG_QUALITY = 0.82;

export function readAndResizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > MAX_DIMENSION) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else if (height >= width && height > MAX_DIMENSION) {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Only still needed for exporting a profile/tag saved by an earlier
// version of the app, which may still have a real Blob on it.
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// A data: URI is already directly usable as an <img src> or a CSS
// background-image -- no object URL, no lookup. Blob is still handled here
// for any profile/tag saved by an earlier version of the app before this
// storage format changed; it isn't produced by anything anymore, but
// existing saved data shouldn't break.
export function resolveImageUrl(image) {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (image instanceof Blob) return URL.createObjectURL(image);
  return "";
}
