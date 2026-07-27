// Profile avatars and Tag cover images are stored as plain Blobs directly on
// their IndexedDB record (unlike My Bookshelf/My Closet, which keep an
// "idb:<id>" reference into a separate image store) -- there's no
// localStorage quota pressure here to design around, since the records
// already live in IndexedDB. These helpers just handle picking/resizing a
// photo and converting to/from a data: URI at the export/import boundary,
// where JSON can't hold a Blob directly.
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
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process that image."))),
          "image/jpeg",
          JPEG_QUALITY
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((r) => r.blob());
}

// The Blob is already in memory (it came straight off the record returned
// by getProfile/getTag/etc.), so this is a synchronous wrap -- no async
// lookup like the sibling apps' resolveImageSrc needs for their IndexedDB
// image store.
export function resolveImageUrl(image) {
  if (!image) return "";
  if (image instanceof Blob) return URL.createObjectURL(image);
  if (typeof image === "string") return image; // legacy/imported data: URI, still usable directly
  return "";
}
