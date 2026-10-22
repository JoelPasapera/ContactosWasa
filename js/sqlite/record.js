// @ts-check
/**
 * Formato de registro de SQLite: cabecera de tipos seriales + cuerpo.
 * Decodificación perezosa y sin asignaciones por fila mediante RowView.
 * @see https://www.sqlite.org/fileformat.html#record_format
 * @module sqlite/record
 */

import { Cursor, readVarint } from './varint.js';

/** La columna no está en el registro (fila anterior a un ALTER TABLE ADD COLUMN). */
export const MISSING = -1;
/** La columna es alias del rowid (INTEGER PRIMARY KEY). */
export const ROWID = -2;

/** Tamaño del contenido para los tipos seriales 0–11. */
const FIXED_SIZES = new Int8Array([0, 1, 2, 3, 4, 6, 8, 8, 0, 0, 0, 0]);

/**
 * @param {number} type tipo serial
 * @returns {number} bytes que ocupa el valor en el cuerpo
 */
export function serialTypeSize(type) {
  return type >= 12 ? Math.floor((type - 12) / 2) : FIXED_SIZES[type];
}

/**
 * Entero con signo big-endian de los tipos seriales 1–6, 8 y 9.
 * @param {Uint8Array} b
 * @param {number} o
 * @param {number} type
 * @returns {number}
 */
export function readSerialInt(b, o, type) {
  switch (type) {
    case 1:
      return (b[o] << 24) >> 24;
    case 2:
      return ((b[o] << 24) | (b[o + 1] << 16)) >> 16;
    case 3:
      return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8)) >> 8;
    case 4:
      return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    case 5: {
      const hi = (((b[o] << 8) | b[o + 1]) << 16) >> 16;
      const lo = ((b[o + 2] << 24) | (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5]) >>> 0;
      return hi * 4294967296 + lo;
    }
    case 6: {
      const hi = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
      const lo = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
      return hi * 4294967296 + lo;
    }
    case 8:
      return 0;
    case 9:
      return 1;
    default:
      return NaN;
  }
}

/**
 * Proyección de columnas: qué posiciones del registro interesan y en qué
 * ranura de la fila aparecen. Se construye una vez por consulta.
 */
export class Projection {
  /**
   * @param {string[]} names            nombres pedidos (para depurar)
   * @param {Int32Array} slotOfRecord   posición de registro → ranura (-1 si no se pide)
   * @param {Int32Array} initialTypes   tipo inicial por ranura (MISSING o ROWID)
   * @param {(number|string|null)[]} defaults valor DEFAULT por ranura
   */
  constructor(names, slotOfRecord, initialTypes, defaults) {
    this.names = names;
    this.slotOfRecord = slotOfRecord;
    this.initialTypes = initialTypes;
    this.defaults = defaults;
    this.width = names.length;
  }
}

/**
 * Vista de la fila actual. Se reutiliza en todo el recorrido: sus valores
 * solo son válidos dentro del callback que la recibe.
 */
export class RowView {
  /**
   * @param {Projection} projection
   * @param {TextDecoder} decoder
   */
  constructor(projection, decoder) {
    this.projection = projection;
    this.decoder = decoder;
    this.types = new Int32Array(projection.width);
    this.offsets = new Int32Array(projection.width);
    /** @type {Uint8Array} */
    this.buf = new Uint8Array(0);
    /** @type {DataView|null} */
    this.view = null;
    /** @type {Uint8Array|null} */
    this.viewOf = null;
    this.rowid = 0;
  }

  /**
   * @param {number} k ranura
   * @returns {boolean}
   */
  isNull(k) {
    const t = this.types[k];
    if (t === ROWID) return false;
    if (t === MISSING) return this.projection.defaults[k] == null;
    return t === 0 || t === 10 || t === 11;
  }

  /**
   * Valor numérico; NaN si es NULL o no numérico.
   * @param {number} k
   * @returns {number}
   */
  num(k) {
    const t = this.types[k];
    if (t === ROWID) return this.rowid;
    if (t === MISSING) {
      const d = this.projection.defaults[k];
      return d == null || d === '' ? NaN : Number(d);
    }
    if ((t >= 1 && t <= 6) || t === 8 || t === 9) return readSerialInt(this.buf, this.offsets[k], t);
    if (t === 7) return this.#dataView().getFloat64(this.offsets[k]);
    if (t >= 13 && (t & 1) === 1) {
      const s = this.text(k);
      return s === null || s.trim() === '' ? NaN : Number(s);
    }
    return NaN;
  }

  /**
   * Valor como texto; null si es NULL.
   * @param {number} k
   * @returns {string|null}
   */
  text(k) {
    const t = this.types[k];
    if (t === ROWID) return String(this.rowid);
    if (t === MISSING) {
      const d = this.projection.defaults[k];
      return d == null ? null : String(d);
    }
    if (t >= 12) {
      const off = this.offsets[k];
      const len = serialTypeSize(t);
      return this.decoder.decode(this.buf.subarray(off, off + len));
    }
    if (t === 0 || t === 10 || t === 11) return null;
    return String(this.num(k));
  }

  /**
   * Copia de los bytes de un BLOB (o TEXT); null en otro caso.
   * @param {number} k
   * @returns {Uint8Array|null}
   */
  blob(k) {
    const t = this.types[k];
    if (t < 12) return null;
    const off = this.offsets[k];
    return this.buf.slice(off, off + serialTypeSize(t));
  }

  #dataView() {
    if (this.viewOf !== this.buf) {
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      this.viewOf = this.buf;
    }
    return /** @type {DataView} */ (this.view);
  }
}

const recordCursor = new Cursor();

/**
 * Decodifica la cabecera de un registro y fija tipos/desplazamientos de las
 * columnas proyectadas en `row`. No decodifica valores.
 * @param {Uint8Array} buf    buffer que contiene la carga útil completa
 * @param {number} base       inicio de la carga útil en `buf`
 * @param {number} size       tamaño de la carga útil
 * @param {number} rowid
 * @param {Projection} proj
 * @param {RowView} row
 * @returns {boolean} false si el registro es inconsistente
 */
export function decodeRecord(buf, base, size, rowid, proj, row) {
  const cur = recordCursor;
  cur.pos = base;
  const headerSize = readVarint(buf, cur);
  if (headerSize < 1 || headerSize > size) return false;
  const headerEnd = base + headerSize;
  const end = base + size;
  const slotOf = proj.slotOfRecord;
  const lastWanted = slotOf.length - 1;
  row.types.set(proj.initialTypes);
  let body = headerEnd;
  let col = 0;
  while (cur.pos < headerEnd && col <= lastWanted) {
    const type = readVarint(buf, cur);
    const slot = slotOf[col];
    if (slot >= 0) {
      row.types[slot] = type;
      row.offsets[slot] = body;
    }
    body += serialTypeSize(type);
    col++;
  }
  if (body > end) return false;
  row.buf = buf;
  row.rowid = rowid;
  return true;
}
