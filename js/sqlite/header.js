// @ts-check
/**
 * Cabecera de 100 bytes del formato de archivo SQLite 3.
 * @see https://www.sqlite.org/fileformat.html#the_database_header
 * @module sqlite/header
 */

import { startsWithAscii, u16be, u32be } from '../util/bytes.js';
import { AppError, ErrorCode } from '../util/errors.js';

export const SQLITE_MAGIC = 'SQLite format 3\u0000';
export const HEADER_SIZE = 100;

/** @enum {number} */
export const TextEncoding = Object.freeze({ UTF8: 1, UTF16LE: 2, UTF16BE: 3 });

/**
 * @typedef {object} DatabaseHeader
 * @property {number} pageSize      tamaño de página en bytes (512–65536)
 * @property {number} reserved      bytes reservados al final de cada página
 * @property {number} usableSize    pageSize - reserved
 * @property {number} pageCount     páginas según la cabecera (0 si no es fiable)
 * @property {number} textEncoding  1 UTF-8, 2 UTF-16le, 3 UTF-16be
 */

/**
 * @param {Uint8Array} bytes al menos 100 bytes
 * @returns {boolean}
 */
export function isSqlite(bytes) {
  return startsWithAscii(bytes, SQLITE_MAGIC);
}

/**
 * @param {Uint8Array} h primeros 100 bytes del archivo
 * @returns {DatabaseHeader}
 */
export function parseDatabaseHeader(h) {
  if (h.length < HEADER_SIZE || !isSqlite(h)) {
    throw new AppError(ErrorCode.NOT_SQLITE, 'Falta la firma "SQLite format 3"');
  }
  let pageSize = u16be(h, 16);
  if (pageSize === 1) pageSize = 65536;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) {
    throw new AppError(ErrorCode.SQLITE_CORRUPT, `Tamaño de página inválido: ${pageSize}`);
  }
  const reserved = h[20];
  const usableSize = pageSize - reserved;
  if (usableSize < 480) {
    throw new AppError(ErrorCode.SQLITE_CORRUPT, `Espacio útil por página inválido: ${usableSize}`);
  }
  const changeCounter = u32be(h, 24);
  const declaredPages = u32be(h, 28);
  const versionValidFor = u32be(h, 92);
  const textEncoding = u32be(h, 56) || TextEncoding.UTF8;
  if (textEncoding < 1 || textEncoding > 3) {
    throw new AppError(ErrorCode.SQLITE_CORRUPT, `Codificación de texto desconocida: ${textEncoding}`);
  }
  return {
    pageSize,
    reserved,
    usableSize,
    // El recuento solo es fiable si la cabecera lo escribió una versión moderna.
    pageCount: declaredPages > 0 && changeCounter === versionValidFor ? declaredPages : 0,
    textEncoding,
  };
}
