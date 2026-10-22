// @ts-check
/**
 * Almacén de bytes en el sistema de archivos privado del origen (OPFS)
 * mediante FileSystemSyncAccessHandle (solo en Workers). Escribe por lotes
 * y lee con una caché LRU de bloques: memoria acotada aunque la base pese
 * varios GB. El archivo temporal se borra al terminar.
 * @module storage/opfs-store
 */

import { BlockCache } from './block-cache.js';

const WRITE_BATCH = 4 << 20; // 4 MiB
const BLOCK_SIZE = 1 << 20; // 1 MiB: múltiplo de cualquier tamaño de página SQLite
const CACHE_BLOCKS = 64; // 64 MiB de caché

/** Prefijo de los temporales: permite purgar restos de sesiones interrumpidas. */
export const TEMP_PREFIX = 'padron-tmp-';

/**
 * Subconjunto de FileSystemSyncAccessHandle que se usa (los métodos eran
 * asíncronos en versiones antiguas de Chrome; por eso se esperan con await).
 * @typedef {object} SyncHandle
 * @property {(buffer: Uint8Array, options: { at: number }) => number} read
 * @property {(buffer: Uint8Array, options: { at: number }) => number} write
 * @property {(size: number) => void | Promise<void>} truncate
 * @property {() => void | Promise<void>} flush
 * @property {() => void | Promise<void>} close
 */

/**
 * @typedef {object} OpfsDirectory
 * @property {(name: string, options?: { create?: boolean }) => Promise<any>} getFileHandle
 * @property {(name: string) => Promise<void>} removeEntry
 * @property {() => AsyncIterableIterator<string>} keys
 */

/** @returns {Promise<OpfsDirectory>} */
async function rootDirectory() {
  return /** @type {any} */ (navigator.storage).getDirectory();
}

export class OpfsStore {
  /** ¿Hay OPFS con acceso síncrono en este contexto? */
  static isSupported() {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.getDirectory === 'function' &&
      typeof globalThis.FileSystemFileHandle === 'function' &&
      'createSyncAccessHandle' in globalThis.FileSystemFileHandle.prototype
    );
  }

  /**
   * Bytes libres estimados en la cuota del origen (Infinity si no se sabe).
   * @returns {Promise<number>}
   */
  static async freeSpace() {
    try {
      const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
      return quota - usage;
    } catch {
      return Infinity;
    }
  }

  /**
   * Borra temporales de ejecuciones anteriores (ignora los que estén en uso).
   */
  static async purgeStale() {
    try {
      const dir = await rootDirectory();
      /** @type {string[]} */
      const stale = [];
      for await (const name of dir.keys()) if (name.startsWith(TEMP_PREFIX)) stale.push(name);
      for (const name of stale) await dir.removeEntry(name).catch(() => {});
    } catch {
      /* OPFS no disponible: nada que limpiar */
    }
  }

  /**
   * @param {string} label sufijo legible del nombre temporal
   * @returns {Promise<OpfsStore>}
   */
  static async create(label) {
    const dir = await rootDirectory();
    const name = `${TEMP_PREFIX}${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const fileHandle = await dir.getFileHandle(name, { create: true });
    /** @type {SyncHandle} */
    const handle = await fileHandle.createSyncAccessHandle();
    await handle.truncate(0);
    return new OpfsStore(dir, name, handle);
  }

  /**
   * @param {OpfsDirectory} dir
   * @param {string} name
   * @param {SyncHandle} handle
   */
  constructor(dir, name, handle) {
    this.dir = dir;
    this.name = name;
    this.handle = handle;
    this.size = 0;
    this.batch = new Uint8Array(WRITE_BATCH);
    this.batchLength = 0;
    /** @type {BlockCache|null} */
    this.cache = null;
    this.spill = new Uint8Array(0);
  }

  /**
   * @param {Uint8Array} data
   */
  append(data) {
    let src = 0;
    while (src < data.length) {
      const take = Math.min(WRITE_BATCH - this.batchLength, data.length - src);
      this.batch.set(data.subarray(src, src + take), this.batchLength);
      this.batchLength += take;
      src += take;
      if (this.batchLength === WRITE_BATCH) this.#flushBatch();
    }
  }

  async seal() {
    this.#flushBatch();
    await this.handle.flush();
    this.cache = new BlockCache(BLOCK_SIZE, CACHE_BLOCKS, (block, into) =>
      this.handle.read(into, { at: block * BLOCK_SIZE }),
    );
  }

  /**
   * @param {number} offset
   * @param {number} length
   * @returns {Uint8Array}
   */
  read(offset, length) {
    if (!this.cache) throw new Error('OpfsStore.read antes de seal()');
    if (offset < 0 || offset + length > this.size) throw new RangeError('Lectura fuera del almacén');
    const block = Math.floor(offset / BLOCK_SIZE);
    const start = offset % BLOCK_SIZE;
    if (start + length <= BLOCK_SIZE) return this.cache.view(block, start, start + length);
    if (this.spill.length < length) this.spill = new Uint8Array(length);
    let filled = 0;
    let pos = offset;
    while (filled < length) {
      const b = Math.floor(pos / BLOCK_SIZE);
      const o = pos % BLOCK_SIZE;
      const take = Math.min(BLOCK_SIZE - o, length - filled);
      this.spill.set(this.cache.view(b, o, o + take), filled);
      filled += take;
      pos += take;
    }
    return this.spill.subarray(0, length);
  }

  async dispose() {
    this.cache = null;
    try {
      await this.handle.close();
    } finally {
      await this.dir.removeEntry(this.name).catch(() => {});
    }
  }

  #flushBatch() {
    if (this.batchLength === 0) return;
    const written = this.handle.write(this.batch.subarray(0, this.batchLength), { at: this.size });
    if (written !== this.batchLength) throw new DOMException('Escritura incompleta en OPFS', 'QuotaExceededError');
    this.size += this.batchLength;
    this.batchLength = 0;
  }
}
