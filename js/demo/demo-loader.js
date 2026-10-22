// @ts-check
/**
 * Demostración guiada: convierte los archivos de ejemplo embebidos en objetos
 * File idénticos a los que el usuario arrastraría. Los datos se cargan solo
 * cuando se pide el ejemplo (importación dinámica).
 * @module demo/demo-loader
 */

/**
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @returns {Promise<{ files: File[], keyHex: string }>}
 */
export async function loadDemo() {
  const { DEMO_KEY_HEX, DEMO_FILES } = await import('./demo-data.js');
  const files = DEMO_FILES.map(
    (f) => new File([/** @type {BlobPart} */ (base64ToBytes(f.base64))], f.name, { type: 'application/octet-stream' }),
  );
  return { files, keyHex: DEMO_KEY_HEX };
}
