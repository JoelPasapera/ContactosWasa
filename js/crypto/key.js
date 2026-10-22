// @ts-check
/**
 * La clave de 64 dígitos del "cifrado de extremo a extremo" de WhatsApp:
 * 32 bytes expresados como 64 dígitos hexadecimales. Se admite con o sin
 * espacios y en mayúsculas o minúsculas.
 * @module crypto/key
 */

import { hexToBytes } from '../util/bytes.js';
import { AppError, ErrorCode } from '../util/errors.js';

/**
 * Normaliza la entrada del usuario a 64 dígitos hexadecimales en minúsculas,
 * o null si todavía no parece una clave completa.
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeKeyInput(input) {
  const compact = input.replace(/[\s:]+/g, '').toLowerCase();
  if (compact.length !== 64 || !/^[0-9a-f]{64}$/.test(compact)) return null;
  return compact;
}

/**
 * Convierte la clave de 64 dígitos en sus 32 bytes.
 * @param {string} input
 * @returns {Uint8Array}
 */
export function parseKey(input) {
  const normalized = normalizeKeyInput(input);
  if (!normalized) {
    throw new AppError(ErrorCode.KEY_INVALID, 'La clave debe tener 64 dígitos hexadecimales');
  }
  return hexToBytes(normalized);
}

/**
 * Extrae la clave raíz de un archivo `encrypted_backup.key`. Ese archivo es
 * un objeto Java serializado que envuelve un arreglo de 32 bytes; la clave
 * son sus últimos 32 bytes.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function keyFromKeyfile(bytes) {
  if (bytes.length === 32) return bytes.slice();
  if (bytes.length < 32) throw new AppError(ErrorCode.KEY_INVALID, `Archivo de clave de ${bytes.length} bytes`);
  return bytes.slice(bytes.length - 32);
}
