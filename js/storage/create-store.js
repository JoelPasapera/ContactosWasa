// @ts-check
/**
 * Política de almacenamiento para la base descifrada: memoria para copias
 * pequeñas (más rápido y nada toca el disco) y OPFS para las grandes
 * (memoria acotada). Si OPFS no está disponible, se usa memoria.
 * @module storage/create-store
 */

import { MemoryStore } from './memory-store.js';
import { OpfsStore } from './opfs-store.js';

/** Copias cifradas de este tamaño o más se vuelcan a OPFS. */
export const OPFS_THRESHOLD = 192 * 1024 * 1024;

/** Factor de expansión prudente de la compresión zlib de una base SQLite. */
const EXPANSION_ESTIMATE = 4;

/** @typedef {MemoryStore | OpfsStore} ByteStore */

/**
 * @param {number} encryptedSize tamaño del archivo cifrado
 * @param {string} label         nombre corto para el temporal
 * @returns {Promise<ByteStore>}
 */
export async function createStore(encryptedSize, label) {
  if (encryptedSize >= OPFS_THRESHOLD && OpfsStore.isSupported()) {
    const free = await OpfsStore.freeSpace();
    if (free > encryptedSize * EXPANSION_ESTIMATE) {
      try {
        return await OpfsStore.create(label);
      } catch {
        /* p. ej. navegación privada: se continúa en memoria */
      }
    }
  }
  return new MemoryStore();
}
