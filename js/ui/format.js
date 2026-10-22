// @ts-check
/**
 * Formateo para presentación en la interfaz.
 * @module ui/format
 */

const numberFormat = new Intl.NumberFormat('es-PE');

/**
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  return numberFormat.format(n);
}

/**
 * Tamaño de archivo legible.
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * Fecha legible a partir de milisegundos de época (0 = sin dato).
 * @param {number} ms
 * @returns {string}
 */
export function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-PE', { year: 'numeric', month: 'short', day: 'numeric' });
}
