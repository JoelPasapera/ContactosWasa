// @ts-check
/**
 * Worker de procesamiento: descifra, lee y extrae fuera del hilo principal
 * para no bloquear la interfaz. Toda la lógica pesada vive aquí.
 * @module worker/extract-worker
 */

import { runPipeline } from '../backup/pipeline.js';
import { parseKey, keyFromKeyfile } from '../crypto/key.js';
import { OpfsStore } from '../storage/opfs-store.js';
import { serializeError } from '../util/errors.js';
import { ResponseType } from './protocol.js';

/** Limpia temporales OPFS de sesiones anteriores al arrancar. */
OpfsStore.purgeStale();

self.addEventListener('message', (event) => {
  const req = /** @type {import('./protocol.js').ProcessRequest} */ (event.data);
  if (req?.type !== 'process') return;
  void handleProcess(req);
});

/**
 * @param {import('./protocol.js').ProcessRequest} req
 */
async function handleProcess(req) {
  try {
    const rootKey = resolveKey(req.keyText, req.keyFileBytes);
    let last = 0;
    const result = await runPipeline({
      backups: req.backups,
      rootKey,
      vcardText: req.vcardText,
      includeGroups: req.includeGroups,
      onProgress: (phase, done, total) => {
        // Limita la frecuencia de mensajes para no saturar el hilo principal.
        const now = Date.now();
        if (now - last < 60 && done < total) return;
        last = now;
        post({ type: ResponseType.PROGRESS, phase, done, total });
      },
    });
    post({
      type: ResponseType.DONE,
      contacts: result.contacts,
      stats: result.stats,
      sources: result.sources,
    });
  } catch (err) {
    const { code, detail, file } = serializeError(err);
    post({ type: ResponseType.ERROR, code, detail, file });
  }
}

/**
 * @param {string} keyText
 * @param {Uint8Array|null} keyFileBytes
 * @returns {Uint8Array|null}
 */
function resolveKey(keyText, keyFileBytes) {
  if (keyText && keyText.trim()) return parseKey(keyText);
  if (keyFileBytes && keyFileBytes.length > 0) return keyFromKeyfile(keyFileBytes);
  return null;
}

/**
 * @param {object} message
 */
function post(message) {
  self.postMessage(message);
}
