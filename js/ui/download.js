// @ts-check
/**
 * Descarga de un Blob como archivo local.
 * @module ui/download
 */

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoca con holgura para no cortar la descarga en navegadores lentos.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
