// @ts-check
/**
 * Creación del Worker de procesamiento. En la versión modular (servida por
 * HTTP) se carga como módulo desde su archivo; en la versión de un solo
 * archivo el empaquetador inyecta el código del Worker como texto en
 * `globalThis.__PADRON_WORKER_SRC__` y se crea desde una URL blob:, que
 * funciona sin servidor y bajo la política del visor de artefactos.
 * @module worker/spawn
 */

/** @returns {Worker} */
export function spawnWorker() {
  const inline = /** @type {any} */ (globalThis).__PADRON_WORKER_SRC__;
  if (typeof inline === 'string') {
    const url = URL.createObjectURL(new Blob([inline], { type: 'text/javascript' }));
    const worker = new Worker(url);
    // El Worker ya tiene su copia del código; la URL puede liberarse.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return worker;
  }
  return new Worker(new URL('./extract-worker.js', import.meta.url), { type: 'module' });
}
