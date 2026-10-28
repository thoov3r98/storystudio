/** Blob URL without the forced-download query, suitable for <video>/<audio>. */
export function previewUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("download");
    return u.toString();
  } catch {
    return url;
  }
}

/** Blob URL that makes the browser download instead of play. */
export function downloadUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("download", "1");
    return u.toString();
  } catch {
    return url;
  }
}
