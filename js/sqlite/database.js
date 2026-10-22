// @ts-check
/**
 * Fachada de solo lectura sobre un archivo SQLite almacenado en un
 * ReadableStore (memoria u OPFS). Lee el esquema de sqlite_schema y expone
 * tablas con proyección de columnas por nombre.
 * @module sqlite/database
 */

import { AppError, ErrorCode } from '../util/errors.js';
import { TableBTree } from './btree.js';
import { HEADER_SIZE, parseDatabaseHeader, TextEncoding } from './header.js';
import { MISSING, Projection, ROWID } from './record.js';
import { parseCreateTable } from './schema-sql.js';

/**
 * Acceso aleatorio síncrono a los bytes de la base.
 * @typedef {object} ReadableStore
 * @property {number} size
 * @property {(offset: number, length: number) => Uint8Array} read
 *   vista válida hasta la siguiente lectura
 */

/**
 * @typedef {object} TableInfo
 * @property {string} name
 * @property {number} rootPage
 * @property {import('./schema-sql.js').ParsedTable} parsed
 */

const ROWID_NAMES = new Set(['rowid', '_rowid_', 'oid']);

/** @param {number} encoding */
function decoderLabel(encoding) {
  if (encoding === TextEncoding.UTF16LE) return 'utf-16le';
  if (encoding === TextEncoding.UTF16BE) return 'utf-16be';
  return 'utf-8';
}

export class SqliteDatabase {
  /**
   * @param {ReadableStore} store
   */
  constructor(store) {
    if (store.size < HEADER_SIZE) throw new AppError(ErrorCode.NOT_SQLITE, 'Archivo demasiado pequeño');
    const header = parseDatabaseHeader(store.read(0, HEADER_SIZE).slice());
    const pagesInStore = Math.floor(store.size / header.pageSize);
    if (pagesInStore < 1) throw new AppError(ErrorCode.SQLITE_CORRUPT, 'La base no contiene páginas completas');
    this.store = store;
    this.pageSize = header.pageSize;
    this.usableSize = header.usableSize;
    this.pageCount = header.pageCount > 0 ? Math.min(header.pageCount, pagesInStore) : pagesInStore;
    this.decoder = new TextDecoder(decoderLabel(header.textEncoding));
    /** @type {Map<string, TableInfo>|null} */
    this.schemaCache = null;
  }

  /**
   * Vista de una página (1-based), válida hasta la siguiente lectura.
   * @param {number} pgno
   * @returns {Uint8Array}
   */
  page(pgno) {
    return this.store.read((pgno - 1) * this.pageSize, this.pageSize);
  }

  /** Tablas con rowid indexadas por nombre en minúsculas. */
  get tables() {
    if (!this.schemaCache) this.schemaCache = this.#readSchema();
    return this.schemaCache;
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  hasTable(name) {
    return this.tables.has(name.toLowerCase());
  }

  /**
   * @param {string} name
   * @returns {Table|null} null si no existe o es WITHOUT ROWID
   */
  table(name) {
    const info = this.tables.get(name.toLowerCase());
    if (!info || info.parsed.withoutRowid) return null;
    return new Table(this, info);
  }

  /** @returns {Map<string, TableInfo>} */
  #readSchema() {
    const names = ['type', 'name', 'tbl_name', 'rootpage', 'sql'];
    const projection = new Projection(
      names,
      Int32Array.of(0, 1, 2, 3, 4),
      new Int32Array(names.length).fill(MISSING),
      names.map(() => null),
    );
    const tree = new TableBTree(this, 1, 'sqlite_schema');
    /** @type {Map<string, TableInfo>} */
    const map = new Map();
    tree.scan(projection, (row) => {
      if (row.text(0) !== 'table') return;
      const name = row.text(1);
      const rootPage = row.num(3);
      const sql = row.text(4);
      if (!name || !sql || !(rootPage > 0)) return;
      const parsed = parseCreateTable(sql);
      if (!parsed || parsed.virtual) return;
      map.set(name.toLowerCase(), { name, rootPage, parsed });
    });
    return map;
  }
}

export class Table {
  /**
   * @param {SqliteDatabase} db
   * @param {TableInfo} info
   */
  constructor(db, info) {
    this.name = info.name;
    this.tree = new TableBTree(db, info.rootPage, info.name);
    /** @type {Map<string, import('./schema-sql.js').ColumnDef>} */
    this.columns = new Map(info.parsed.columns.map((c) => [c.key, c]));
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  hasColumn(name) {
    return this.columns.has(name.toLowerCase());
  }

  /**
   * Proyección por nombres. Las columnas inexistentes se leen como NULL;
   * "rowid"/"oid" sin columna homónima devuelven el rowid.
   * @param {string[]} names
   * @returns {Projection}
   */
  project(names) {
    const defs = names.map((n) => this.columns.get(n.toLowerCase()) ?? null);
    let maxRecord = -1;
    for (const d of defs) {
      if (d && !d.rowidAlias && d.recordIndex > maxRecord) maxRecord = d.recordIndex;
    }
    const slotOfRecord = new Int32Array(maxRecord + 1).fill(-1);
    const initialTypes = new Int32Array(names.length).fill(MISSING);
    /** @type {(number|string|null)[]} */
    const defaults = names.map(() => null);
    defs.forEach((d, k) => {
      if (!d) {
        if (ROWID_NAMES.has(names[k].toLowerCase())) initialTypes[k] = ROWID;
        return;
      }
      if (d.rowidAlias) {
        initialTypes[k] = ROWID;
        return;
      }
      if (d.recordIndex >= 0) slotOfRecord[d.recordIndex] = k;
      defaults[k] = d.defaultValue;
    });
    return new Projection(names, slotOfRecord, initialTypes, defaults);
  }

  /**
   * @param {Projection} projection
   * @param {(row: import('./record.js').RowView) => void} visit
   * @param {() => void} [onLeaf]
   */
  scan(projection, visit, onLeaf) {
    this.tree.scan(projection, visit, onLeaf);
  }

  /**
   * @param {number} rowid
   * @param {Projection} projection
   */
  get(rowid, projection) {
    return this.tree.get(rowid, projection);
  }
}
