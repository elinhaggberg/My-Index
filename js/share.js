export function filenameFor(name, ext = "json") {
  const slug = (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "my-index"}.${ext}`;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Tries the native share sheet first (best for "send this to someone" on a
// phone); falls back to a plain file download anywhere that isn't supported.
// Deliberately omits title/text alongside the file: some share targets treat
// those as separate shareable content and create a companion text
// attachment instead of just naming the file.
async function shareFileOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled";
    }
  }

  downloadBlob(file.name, file);
  return "downloaded";
}

export async function shareOrDownload(filename, content) {
  return shareFileOrDownload(new File([content], filename, { type: "application/json" }));
}
