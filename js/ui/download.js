// @ts-check
/**
 * Entrega de archivos generados al usuario.
 *
 * - Dentro del visor de artefactos de claude.ai la página no puede iniciar
 *   descargas por sí misma; se usa la capacidad `downloads`, que muestra una
 *   confirmación al usuario. Esa vía solo admite ciertas extensiones (no .vcf).
 * - Fuera del visor (archivo local, GitHub Pages…) se usa un enlace normal de
 *   descarga.
 * @module ui/download
 */

/** @typedef {'platform'|'local'|'blocked'} SaveMode */

/**
 * @typedef {object} DownloadsCapability
 * @property {(req: { filename: string, data: Blob }) => Promise<{ status: string }>} save
 */

/** Extensiones que admite la capacidad `downloads` del visor. */
const PLATFORM_EXTENSIONS = new Set([
  'gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'txt', 'json', 'md',
  'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip',
]);

/** @type {Promise<DownloadsCapability|null>|null} */
let capabilityPromise = null;

/** @returns {any} */
function claudeRuntime() {
  return /** @type {any} */ (globalThis).claude;
}

/**
 * Pide (una vez) la capacidad al visor. Fuera del visor resuelve null al
 * instante; dentro, cuando el visor responde.
 * @returns {Promise<DownloadsCapability|null>}
 */
function capability() {
  if (!capabilityPromise) {
    const runtime = claudeRuntime();
    capabilityPromise =
      runtime && typeof runtime.use === 'function'
        ? Promise.resolve(runtime.use('downloads')).catch(() => null)
        : Promise.resolve(null);
  }
  return capabilityPromise;
}

/**
 * Cómo se podrán guardar archivos en esta vista.
 * @returns {Promise<SaveMode>}
 */
export async function saveMode() {
  if (await capability()) return 'platform';
  // Con el entorno del visor presente pero sin capacidad, un enlace de
  // descarga no tendría efecto.
  return claudeRuntime() && window.self !== window.top ? 'blocked' : 'local';
}

/**
 * ¿Se puede ofrecer esta extensión en el modo dado?
 * @param {SaveMode} mode
 * @param {string} extension sin punto
 */
export function supportsExtension(mode, extension) {
  if (mode === 'platform') return PLATFORM_EXTENSIONS.has(extension.toLowerCase());
  return mode === 'local';
}

/**
 * Entrega el archivo. Resuelve 'saved' o rechaza con un `code` legible.
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<'saved'>}
 */
export async function saveFile(blob, filename) {
  const cap = await capability();
  if (cap) {
    await cap.save({ filename, data: blob });
    return 'saved';
  }
  if ((await saveMode()) === 'blocked') {
    throw Object.assign(new Error('Descargas no disponibles en esta vista'), { code: 'unavailable' });
  }
  anchorDownload(blob, filename);
  return 'saved';
}

/**
 * Descarga clásica mediante un enlace temporal.
 * @param {Blob} blob
 * @param {string} filename
 */
function anchorDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Se revoca con holgura para no cortar la descarga en equipos lentos.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
