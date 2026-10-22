// @ts-check
/**
 * Cabecera de las copias cifradas de WhatsApp para Android (.crypt14/.crypt15):
 * un varint con el tamaño del prefijo y un mensaje protobuf BackupPrefix.
 *
 *   1 key_type_deprecated · 2 datos crypt14 · 3 datos crypt15 {1: IV de 16 bytes}
 *   4 backup_metadata {1: versión de la app, 3: 2 últimos dígitos del número,
 *     5..37: indicadores de migración (solo en msgstore)}
 *   5 metadatos de passkey · 6 key_type_new
 * @module crypto/backup-header
 */

import { decodeMessage, findField, readProtoVarint, WireType } from './protobuf.js';

/** Tipos de clave declarados en la cabecera. */
export const KeyType = Object.freeze({
  WA_PROVIDED: 0,
  E2EE_DEPRECATED: 1,
  E2EE_PASSWORD: 2,
  E2EE_ENCRYPTION_KEY: 3,
  E2EE_PASSKEY: 4,
});

/** Bytes que bastan para leer cualquier cabecera conocida. */
export const HEADER_PROBE_BYTES = 8192;

/**
 * @typedef {object} BackupHeader
 * @property {'crypt15'|'crypt14'} kind
 * @property {number} dataOffset  inicio del texto cifrado
 * @property {Uint8Array} iv
 * @property {number|null} keyType key_type_new o, si falta, key_type_deprecated
 * @property {boolean} passkey
 * @property {string} appVersion
 * @property {string} jidSuffix
 * @property {boolean} hasMigrationFlags true en copias de msgstore
 */

const textDecoder = new TextDecoder();

/**
 * @param {Uint8Array} bytes
 */
function decodeText(bytes) {
  return textDecoder.decode(bytes);
}

/**
 * Interpreta la cabecera. Devuelve null si los bytes no tienen esa forma.
 * @param {Uint8Array} head primeros bytes del archivo
 * @returns {BackupHeader|null}
 */
export function parseBackupHeader(head) {
  try {
    const cur = { pos: 0 };
    const size = readProtoVarint(head, cur);
    if (size < 8 || cur.pos + size > head.length) return null;
    const fields = decodeMessage(head.subarray(cur.pos, cur.pos + size));
    const dataOffset = cur.pos + size;

    const c15 = findField(fields, 3, WireType.LEN);
    const c14 = findField(fields, 2, WireType.LEN);
    /** @type {Uint8Array|null} */
    let iv = null;
    /** @type {'crypt15'|'crypt14'} */
    let kind = 'crypt15';
    if (c15) {
      iv = findField(decodeMessage(c15.bytes), 1, WireType.LEN)?.bytes ?? null;
    } else if (c14) {
      kind = 'crypt14';
      iv = new Uint8Array(0);
    }
    if (!iv || (kind === 'crypt15' && iv.length !== 16)) return null;

    let appVersion = '';
    let jidSuffix = '';
    let hasMigrationFlags = false;
    const meta = findField(fields, 4, WireType.LEN);
    if (meta) {
      const m = decodeMessage(meta.bytes);
      appVersion = decodeText(findField(m, 1, WireType.LEN)?.bytes ?? new Uint8Array(0));
      jidSuffix = decodeText(findField(m, 3, WireType.LEN)?.bytes ?? new Uint8Array(0));
      hasMigrationFlags = m.some((f) => f.field >= 5 && f.field <= 37 && f.wire === WireType.VARINT);
    }
    const keyTypeNew = findField(fields, 6, WireType.VARINT);
    const keyTypeOld = findField(fields, 1, WireType.VARINT);
    return {
      kind,
      dataOffset,
      iv,
      keyType: keyTypeNew ? keyTypeNew.int : keyTypeOld ? keyTypeOld.int : null,
      passkey: Boolean(findField(fields, 5, WireType.LEN)),
      appVersion,
      jidSuffix,
      hasMigrationFlags,
    };
  } catch {
    return null;
  }
}
