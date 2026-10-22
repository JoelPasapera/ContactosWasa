// @ts-check
/**
 * Conjunto de enteros no negativos optimizado para rowid de SQLite:
 * mapa de bits creciente para valores densos y un Set de respaldo para
 * valores enormes o dispersos. Consultas O(1) sin asignaciones.
 * @module util/rowid-set
 */

/** Por encima de este valor se usa el Set de respaldo (2^27 bits = 16 MiB). */
const BITMAP_LIMIT = 1 << 27;

export class RowidSet {
  constructor() {
    /** @type {Uint32Array} */
    this.words = new Uint32Array(1024);
    /** @type {Set<number>} */
    this.sparse = new Set();
    this.count = 0;
  }

  /** @param {number} value */
  add(value) {
    if (!(value >= 0) || !Number.isInteger(value)) return;
    if (value >= BITMAP_LIMIT) {
      if (!this.sparse.has(value)) {
        this.sparse.add(value);
        this.count++;
      }
      return;
    }
    const w = value >>> 5;
    if (w >= this.words.length) this.#grow(w + 1);
    const bit = 1 << (value & 31);
    if ((this.words[w] & bit) === 0) {
      this.words[w] |= bit;
      this.count++;
    }
  }

  /**
   * @param {number} value
   * @returns {boolean}
   */
  has(value) {
    if (value >= BITMAP_LIMIT) return this.sparse.has(value);
    const w = value >>> 5;
    return w < this.words.length && (this.words[w] & (1 << (value & 31))) !== 0;
  }

  /** @param {number} minWords */
  #grow(minWords) {
    let size = this.words.length;
    while (size < minWords) size *= 2;
    const next = new Uint32Array(size);
    next.set(this.words);
    this.words = next;
  }
}
