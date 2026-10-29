/** Hands the browser a file to save, as if it came from a link. */
export function downloadFile(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The clipboard only works over HTTPS or on localhost; elsewhere a copy button isn't shown.
export const canCopy = () => typeof navigator !== "undefined" && !!navigator.clipboard && window.isSecureContext;
