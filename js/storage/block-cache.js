// @ts-check
/**
 * Caché LRU de bloques de tamaño fijo con memoria preasignada.
 * Lista doblemente enlazada sobre Int32Array y un Map bloque→ranura:
 * O(1) por acceso y ninguna asignación después de construirla.
 * @module storage/block-cache
 */

const NONE = -1;

export class BlockCache {
  /**
   * @param {number} blockSize
   * @param {number} capacity número de bloques en memoria
   * @param {(block: number, into: Uint8Array) => number} load
   *   rellena `into` con el bloque y devuelve los bytes válidos
   */
  constructor(blockSize, capacity, load) {
    this.blockSize = blockSize;
    this.capacity = capacity;
    this.load = load;
    this.slab = new Uint8Array(blockSize * capacity);
    this.blockOf = new Float64Array(capacity).fill(NONE);
    this.validBytes = new Int32Array(capacity);
    this.prev = new Int32Array(capacity).fill(NONE);
    this.next = new Int32Array(capacity).fill(NONE);
    /** @type {Map<number, number>} */
    this.slotOf = new Map();
    this.head = NONE;
    this.tail = NONE;
    this.used = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Ranura que contiene el bloque (cargándolo si hace falta).
   * @param {number} block
   * @returns {number}
   */
  slot(block) {
    let slot = this.slotOf.get(block);
    if (slot !== undefined) {
      this.hits++;
      if (slot !== this.head) {
        this.#unlink(slot);
        this.#pushFront(slot);
      }
      return slot;
    }
    this.misses++;
    if (this.used < this.capacity) {
      slot = this.used++;
    } else {
      slot = this.tail;
      this.#unlink(slot);
      this.slotOf.delete(this.blockOf[slot]);
    }
    const view = this.slab.subarray(slot * this.blockSize, (slot + 1) * this.blockSize);
    this.validBytes[slot] = this.load(block, view);
    this.blockOf[slot] = block;
    this.slotOf.set(block, slot);
    this.#pushFront(slot);
    return slot;
  }

  /**
   * Vista de bytes [start, end) dentro de un bloque.
   * @param {number} block
   * @param {number} start
   * @param {number} end
   */
  view(block, start, end) {
    const slot = this.slot(block);
    if (end > this.validBytes[slot]) throw new RangeError('Lectura más allá del final del archivo');
    const base = slot * this.blockSize;
    return this.slab.subarray(base + start, base + end);
  }

  /** @param {number} slot */
  #unlink(slot) {
    const p = this.prev[slot];
    const n = this.next[slot];
    if (p !== NONE) this.next[p] = n;
    else this.head = n;
    if (n !== NONE) this.prev[n] = p;
    else this.tail = p;
    this.prev[slot] = NONE;
    this.next[slot] = NONE;
  }

  /** @param {number} slot */
  #pushFront(slot) {
    this.prev[slot] = NONE;
    this.next[slot] = this.head;
    if (this.head !== NONE) this.prev[this.head] = slot;
    this.head = slot;
    if (this.tail === NONE) this.tail = slot;
  }
}
