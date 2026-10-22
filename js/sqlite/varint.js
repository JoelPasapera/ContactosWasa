// @ts-check
/**
 * Varints de SQLite: big-endian, 7 bits por byte con bit de continuación,
 * de 1 a 9 bytes (el noveno aporta sus 8 bits).
 * @module sqlite/varint
 */

/** Cursor mutable para leer sin asignar objetos por llamada. */
export class Cursor {
  /** @param {number} [pos] */
  constructor(pos = 0) {
    this.pos = pos;
  }
}

/**
 * Lee un varint y avanza el cursor. Exacto hasta 2^53, suficiente para
 * tamaños de carga útil y rowid reales.
 * @param {Uint8Array} buf
 * @param {Cursor} cur
 * @returns {number}
 */
export function readVarint(buf, cur) {
  let pos = cur.pos;
  let b = buf[pos++];
  if (b < 0x80) {
    cur.pos = pos;
    return b;
  }
  let v = b & 0x7f;
  for (let i = 1; i < 8; i++) {
    b = buf[pos++];
    v = v * 128 + (b & 0x7f);
    if (b < 0x80) {
      cur.pos = pos;
      return v;
    }
  }
  v = v * 256 + buf[pos++];
  cur.pos = pos;
  return v;
}
