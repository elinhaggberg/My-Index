// Downscales a picked photo before it ever touches storage -- a full-res
// camera photo would bloat both IndexedDB and export files far more than
// this app's thumbnail-sized avatars/covers/snippet images need. Outputs a
// Blob (not a data: URI) so it can go straight into js/imageStore.js's
// separate Blob store, matching the same pattern already proven in My
// Bookshelf and My Closet's photo.js.
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
