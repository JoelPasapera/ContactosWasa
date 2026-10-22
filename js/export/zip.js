// @ts-check
/**
 * Escritor ZIP desde cero (sin dependencias): método "store" o "deflate"
 * (vía CompressionStream nativo). Suficiente para empaquetar un .xlsx o un
 * lote de exportaciones. No usa Zip64; los tamaños involucrados están muy
 * por debajo de 4 GB.
 * @module export/zip
 */

import { crc32 } from './crc32.js';

const encoder = new TextEncoder();

/**
 * @typedef {object} ZipEntry
 * @property {string} name  ruta dentro del ZIP (con / como separador)
 * @property {Uint8Array} data
 * @property {boolean} [store] true para no comprimir (ya comprimido)
 */

/**
 * Comprime con DEFLATE crudo (el método 8 de ZIP) usando la API del navegador.
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function deflateRaw(data) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(/** @type {BufferSource} */ (data));
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = cs.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * @param {ZipEntry[]} entries
 * @returns {Promise<Blob>}
 */
export async function createZip(entries) {
  /** @type {Uint8Array[]} */
  const localParts = [];
  /** @type {Uint8Array[]} */
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const uncompressed = entry.data.length;
    let method = 0;
    let payload = entry.data;
    if (!entry.store && uncompressed > 0) {
      const deflated = await deflateRaw(entry.data);
      if (deflated.length < uncompressed) {
        method = 8;
        payload = deflated;
      }
    }
    const local = buildLocalHeader(nameBytes, method, crc, payload.length, uncompressed);
    localParts.push(local, payload);
    centralParts.push(buildCentralHeader(nameBytes, method, crc, payload.length, uncompressed, offset));
    offset += local.length + payload.length;
  }

  const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
  const eocd = buildEocd(entries.length, centralSize, offset);
  const parts = /** @type {BlobPart[]} */ ([...localParts, ...centralParts, eocd]);
  return new Blob(parts, { type: 'application/zip' });
}

/**
 * @param {Uint8Array} name
 * @param {number} method
 * @param {number} crc
 * @param {number} compSize
 * @param {number} uncompSize
 */
function buildLocalHeader(name, method, crc, compSize, uncompSize) {
  const buf = new Uint8Array(30 + name.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(4, 20, true); // versión necesaria
  dv.setUint16(6, 0x0800, true); // nombres en UTF-8
  dv.setUint16(8, method, true);
  dv.setUint16(10, 0, true); // hora
  dv.setUint16(12, 0x21, true); // fecha (1980-01-01, válida)
  dv.setUint32(14, crc, true);
  dv.setUint32(18, compSize, true);
  dv.setUint32(22, uncompSize, true);
  dv.setUint16(26, name.length, true);
  dv.setUint16(28, 0, true); // extra
  buf.set(name, 30);
  return buf;
}

/**
 * @param {Uint8Array} name
 * @param {number} method
 * @param {number} crc
 * @param {number} compSize
 * @param {number} uncompSize
 * @param {number} localOffset
 */
function buildCentralHeader(name, method, crc, compSize, uncompSize, localOffset) {
  const buf = new Uint8Array(46 + name.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x02014b50, true);
  dv.setUint16(4, 20, true); // versión creadora
  dv.setUint16(6, 20, true); // versión necesaria
  dv.setUint16(8, 0x0800, true);
  dv.setUint16(10, method, true);
  dv.setUint16(12, 0, true);
  dv.setUint16(14, 0x21, true);
  dv.setUint32(16, crc, true);
  dv.setUint32(20, compSize, true);
  dv.setUint32(24, uncompSize, true);
  dv.setUint16(28, name.length, true);
  dv.setUint16(30, 0, true); // extra
  dv.setUint16(32, 0, true); // comentario
  dv.setUint16(34, 0, true); // disco
  dv.setUint16(36, 0, true); // atributos internos
  dv.setUint32(38, 0, true); // atributos externos
  dv.setUint32(42, localOffset, true);
  buf.set(name, 46);
  return buf;
}

/**
 * @param {number} count
 * @param {number} centralSize
 * @param {number} centralOffset
 */
function buildEocd(count, centralSize, centralOffset) {
  const buf = new Uint8Array(22);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, count, true);
  dv.setUint16(10, count, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, centralOffset, true);
  dv.setUint16(20, 0, true);
  return buf;
}
