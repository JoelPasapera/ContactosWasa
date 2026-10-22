// @ts-check
/**
 * Utilidades de bajo nivel sobre bytes (sin dependencias).
 * @module util/bytes
 */

/**
 * Valor de un dígito hexadecimal o -1 si no lo es.
 * @param {number} code código UTF-16 del carácter
 * @returns {number}
 */
function hexNibble(code) {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  const lower = code | 0x20;
  if (lower >= 97 && lower <= 102) return lower - 87; // a-f
  return -1;
}

/**
 * Convierte una cadena hexadecimal sin separadores en bytes.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new RangeError('Longitud hexadecimal impar');
  const out = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < out.length; i++) {
    const hi = hexNibble(hex.charCodeAt(2 * i));
    const lo = hexNibble(hex.charCodeAt(2 * i + 1));
    if ((hi | lo) < 0) throw new RangeError('Carácter no hexadecimal');
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/**
 * ¿Comienzan los bytes (desde `offset`) con el texto ASCII dado?
 * @param {Uint8Array} bytes
 * @param {string} ascii
 * @param {number} [offset]
 * @returns {boolean}
 */
export function startsWithAscii(bytes, ascii, offset = 0) {
  if (bytes.length - offset < ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Entero sin signo de 16 bits big-endian.
 * @param {Uint8Array} b
 * @param {number} o
 */
export function u16be(b, o) {
  return (b[o] << 8) | b[o + 1];
}

/**
 * Entero sin signo de 32 bits big-endian.
 * @param {Uint8Array} b
 * @param {number} o
 */
export function u32be(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/**
 * Lee los primeros `length` bytes de un Blob/File.
 * @param {Blob} blob
 * @param {number} length
 * @returns {Promise<Uint8Array>}
 */
export async function readHead(blob, length) {
  return new Uint8Array(await blob.slice(0, Math.min(length, blob.size)).arrayBuffer());
}
