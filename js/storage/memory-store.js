// @ts-check
/**
 * Almacén de bytes en memoria, escrito en secuencia y leído al azar.
 * Usa bloques de 16 MiB para no depender de un único ArrayBuffer gigante
 * (cuyo tamaño máximo varía entre navegadores).
 * @module storage/memory-store
 */

const CHUNK_SIZE = 1 << 24; // 16 MiB: múltiplo de cualquier tamaño de página SQLite

export class MemoryStore {
  constructor() {
    /** @type {Uint8Array[]} */
    this.chunks = [];
    this.size = 0;
    /** Búfer para lecturas que cruzan dos bloques (solo la cabecera en la práctica). */
    this.spill = new Uint8Array(0);
  }

  /**
   * Añade bytes al final.
   * @param {Uint8Array} data
   */
  append(data) {
    let src = 0;
    while (src < data.length) {
      const index = Math.floor(this.size / CHUNK_SIZE);
      const offset = this.size % CHUNK_SIZE;
      if (index === this.chunks.length) this.chunks.push(new Uint8Array(CHUNK_SIZE));
      const take = Math.min(CHUNK_SIZE - offset, data.length - src);
      this.chunks[index].set(data.subarray(src, src + take), offset);
      src += take;
      this.size += take;
    }
  }

  /** Cierra la escritura (sin efecto en memoria). */
  async seal() {}

  /**
   * Vista de `length` bytes desde `offset`, válida hasta la siguiente lectura.
   * @param {number} offset
   * @param {number} length
   * @returns {Uint8Array}
   */
  read(offset, length) {
    if (offset < 0 || offset + length > this.size) throw new RangeError('Lectura fuera del almacén');
    const index = Math.floor(offset / CHUNK_SIZE);
    const start = offset % CHUNK_SIZE;
    if (start + length <= CHUNK_SIZE) return this.chunks[index].subarray(start, start + length);
    if (this.spill.length < length) this.spill = new Uint8Array(length);
    let filled = 0;
    let pos = offset;
    while (filled < length) {
      const i = Math.floor(pos / CHUNK_SIZE);
      const o = pos % CHUNK_SIZE;
      const take = Math.min(CHUNK_SIZE - o, length - filled);
      this.spill.set(this.chunks[i].subarray(o, o + take), filled);
      filled += take;
      pos += take;
    }
    return this.spill.subarray(0, length);
  }

  async dispose() {
    this.chunks = [];
    this.size = 0;
  }
}
