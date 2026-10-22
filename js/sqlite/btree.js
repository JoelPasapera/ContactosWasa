// @ts-check
/**
 * Recorrido de B-trees de tabla (con rowid) del formato SQLite:
 * barrido completo en orden de rowid y búsqueda puntual por rowid.
 * Soporta páginas de desbordamiento y protege contra ciclos.
 * @see https://www.sqlite.org/fileformat.html#b_tree_pages
 * @module sqlite/btree
 */

import { u16be, u32be } from '../util/bytes.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { decodeRecord, RowView } from './record.js';
import { Cursor, readVarint } from './varint.js';

export const PageType = Object.freeze({
  INDEX_INTERIOR: 0x02,
  TABLE_INTERIOR: 0x05,
  INDEX_LEAF: 0x0a,
  TABLE_LEAF: 0x0d,
});

const MAX_DEPTH = 64;

/**
 * Fuente de páginas que el árbol necesita.
 * @typedef {object} Pager
 * @property {number} pageSize
 * @property {number} usableSize
 * @property {number} pageCount
 * @property {TextDecoder} decoder
 * @property {(pgno: number) => Uint8Array} page vista válida hasta la siguiente llamada
 */

/**
 * @param {string} detail
 */
function corrupt(detail) {
  return new AppError(ErrorCode.SQLITE_CORRUPT, detail);
}

export class TableBTree {
  /**
   * @param {Pager} pager
   * @param {number} rootPage
   * @param {string} [label] nombre de la tabla para los mensajes de error
   */
  constructor(pager, rootPage, label = '') {
    this.pager = pager;
    this.root = rootPage;
    this.label = label;
    this.cursor = new Cursor();
    /** Copia estable de la hoja en curso (la caché de páginas puede reciclar vistas). */
    this.leaf = new Uint8Array(pager.pageSize);
    /** Carga útil reensamblada cuando hay desbordamiento. */
    this.scratch = new Uint8Array(pager.pageSize * 4);
    const U = pager.usableSize;
    this.maxLocal = U - 35;
    this.minLocal = Math.floor(((U - 12) * 32) / 255) - 23;
  }

  /**
   * Recorre todas las filas en orden ascendente de rowid.
   * @param {import('./record.js').Projection} projection
   * @param {(row: RowView) => void} visit
   * @param {() => void} [onLeaf] se invoca tras cada hoja (progreso)
   */
  scan(projection, visit, onLeaf) {
    const { pager } = this;
    const row = new RowView(projection, pager.decoder);
    /** @type {number[]} */
    const stack = [this.root];
    let visited = 0;
    while (stack.length > 0) {
      const pgno = /** @type {number} */ (stack.pop());
      if (++visited > pager.pageCount) throw corrupt(`Ciclo en el árbol de ${this.label}`);
      const page = pager.page(pgno);
      const hdr = pgno === 1 ? 100 : 0;
      const type = page[hdr];
      if (type === PageType.TABLE_LEAF) {
        this.leaf.set(page);
        this.#scanLeaf(hdr, projection, row, visit);
        if (onLeaf) onLeaf();
      } else if (type === PageType.TABLE_INTERIOR) {
        const count = u16be(page, hdr + 3);
        stack.push(this.#child(u32be(page, hdr + 8)));
        // Se apilan de derecha a izquierda para visitar primero el hijo izquierdo.
        for (let i = count - 1; i >= 0; i--) {
          const cell = this.#cellOffset(page, hdr, 12, count, i);
          stack.push(this.#child(u32be(page, cell)));
        }
      } else {
        throw corrupt(`Página ${pgno} de ${this.label} con tipo inesperado 0x${type.toString(16)}`);
      }
    }
  }

  /**
   * Busca una fila por rowid (descenso con búsqueda binaria).
   * @param {number} rowid
   * @param {import('./record.js').Projection} projection
   * @returns {RowView|null}
   */
  get(rowid, projection) {
    const { pager } = this;
    let pgno = this.root;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const page = pager.page(pgno);
      const hdr = pgno === 1 ? 100 : 0;
      const type = page[hdr];
      if (type === PageType.TABLE_INTERIOR) {
        const count = u16be(page, hdr + 3);
        let lo = 0;
        let hi = count;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          this.cursor.pos = this.#cellOffset(page, hdr, 12, count, mid) + 4;
          if (readVarint(page, this.cursor) < rowid) lo = mid + 1;
          else hi = mid;
        }
        pgno =
          lo < count
            ? this.#child(u32be(page, this.#cellOffset(page, hdr, 12, count, lo)))
            : this.#child(u32be(page, hdr + 8));
      } else if (type === PageType.TABLE_LEAF) {
        this.leaf.set(page);
        const leaf = this.leaf;
        const count = u16be(leaf, hdr + 3);
        let lo = 0;
        let hi = count - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          const cell = this.#cellOffset(leaf, hdr, 8, count, mid);
          this.cursor.pos = cell;
          readVarint(leaf, this.cursor); // tamaño de la carga útil
          const key = readVarint(leaf, this.cursor);
          if (key === rowid) {
            const row = new RowView(projection, pager.decoder);
            return this.#decodeCell(cell, projection, row) ? row : null;
          }
          if (key < rowid) lo = mid + 1;
          else hi = mid - 1;
        }
        return null;
      } else {
        throw corrupt(`Página ${pgno} de ${this.label} con tipo inesperado 0x${type.toString(16)}`);
      }
    }
    throw corrupt(`Árbol de ${this.label} demasiado profundo`);
  }

  /**
   * @param {number} hdr
   * @param {import('./record.js').Projection} projection
   * @param {RowView} row
   * @param {(row: RowView) => void} visit
   */
  #scanLeaf(hdr, projection, row, visit) {
    const leaf = this.leaf;
    const count = u16be(leaf, hdr + 3);
    for (let i = 0; i < count; i++) {
      const cell = this.#cellOffset(leaf, hdr, 8, count, i);
      if (this.#decodeCell(cell, projection, row)) visit(row);
    }
  }

  /**
   * Prepara `row` para la celda de hoja en `cell` (sobre this.leaf).
   * @param {number} cell
   * @param {import('./record.js').Projection} projection
   * @param {RowView} row
   * @returns {boolean}
   */
  #decodeCell(cell, projection, row) {
    const leaf = this.leaf;
    const cur = this.cursor;
    cur.pos = cell;
    const payloadSize = readVarint(leaf, cur);
    const rowid = readVarint(leaf, cur);
    const start = cur.pos;
    if (payloadSize <= this.maxLocal) {
      if (start + payloadSize > leaf.length) throw corrupt(`Celda fuera de página en ${this.label}`);
      return decodeRecord(leaf, start, payloadSize, rowid, projection, row);
    }
    const payload = this.#assembleOverflow(start, payloadSize);
    return decodeRecord(payload, 0, payloadSize, rowid, projection, row);
  }

  /**
   * Reconstruye una carga útil repartida en páginas de desbordamiento.
   * @param {number} start inicio de la parte local en this.leaf
   * @param {number} size  tamaño total de la carga útil
   * @returns {Uint8Array}
   */
  #assembleOverflow(start, size) {
    const { pager } = this;
    const U = pager.usableSize;
    if (size > pager.pageCount * U) throw corrupt(`Tamaño de registro imposible en ${this.label}`);
    const M = this.minLocal;
    const K = M + ((size - M) % (U - 4));
    const local = K <= this.maxLocal ? K : M;
    if (start + local + 4 > this.leaf.length) throw corrupt(`Celda fuera de página en ${this.label}`);
    if (this.scratch.length < size) this.scratch = new Uint8Array(Math.max(size, this.scratch.length * 2));
    const out = this.scratch;
    out.set(this.leaf.subarray(start, start + local), 0);
    let next = u32be(this.leaf, start + local);
    let filled = local;
    let hops = 0;
    while (filled < size) {
      if (next < 1 || next > pager.pageCount || ++hops > pager.pageCount) {
        throw corrupt(`Cadena de desbordamiento rota en ${this.label}`);
      }
      const page = pager.page(next);
      const take = Math.min(U - 4, size - filled);
      out.set(page.subarray(4, 4 + take), filled);
      filled += take;
      next = u32be(page, 0);
    }
    return out;
  }

  /**
   * Desplazamiento de la celda i validado contra los límites de la página.
   * @param {Uint8Array} page
   * @param {number} hdr
   * @param {number} headerSize 8 (hoja) o 12 (interior)
   * @param {number} count
   * @param {number} i
   */
  #cellOffset(page, hdr, headerSize, count, i) {
    const ptrArray = hdr + headerSize;
    if (ptrArray + 2 * count > this.pager.usableSize) {
      throw corrupt(`Demasiadas celdas en una página de ${this.label}`);
    }
    const off = u16be(page, ptrArray + 2 * i);
    if (off < ptrArray + 2 * count || off >= this.pager.usableSize) {
      throw corrupt(`Puntero de celda inválido en ${this.label}`);
    }
    return off;
  }

  /**
   * @param {number} pgno
   */
  #child(pgno) {
    if (pgno < 1 || pgno > this.pager.pageCount) throw corrupt(`Página hija fuera de rango en ${this.label}`);
    return pgno;
  }
}
