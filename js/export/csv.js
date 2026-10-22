// @ts-check
/**
 * Escritor CSV conforme a RFC 4180 con BOM UTF-8 (para que Excel reconozca
 * los acentos) y separador configurable.
 * @module export/csv
 */

const BOM = '﻿';

/**
 * @param {string} value
 * @param {string} delimiter
 * @returns {string}
 */
function escapeField(value, delimiter) {
  const needsQuote = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r');
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @param {{ delimiter?: string }} [options]
 * @returns {Blob}
 */
export function toCsvBlob(headers, rows, options = {}) {
  const delimiter = options.delimiter ?? ',';
  const parts = [BOM];
  parts.push(headers.map((h) => escapeField(h, delimiter)).join(delimiter), '\r\n');
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      if (i > 0) parts.push(delimiter);
      const cell = row[i];
      parts.push(escapeField(cell == null ? '' : String(cell), delimiter));
    }
    parts.push('\r\n');
  }
  return new Blob(parts, { type: 'text/csv;charset=utf-8' });
}
