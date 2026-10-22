// @ts-check
/**
 * Descifrado de copias .crypt15 de WhatsApp (Android), que es lo mismo que
 * hacen herramientas abiertas como wa-crypt-tools: el usuario aporta su
 * propia copia y su propia clave de 64 dígitos.
 *
 * Esquema:
 *   - La clave de la copia se deriva de la clave raíz de 32 bytes con
 *     HKDF-SHA256 (sal de 32 ceros, info "backup encryption", 32 bytes).
 *   - El cuerpo es AES-256-GCM con IV de 16 bytes. GCM cifra en modo CTR a
 *     partir de inc32(J0); como el IV no mide 12 bytes, J0 = GHASH_H(IV‖len).
 *     El texto cifrado se descifra por bloques con AES-CTR nativo del
 *     navegador, lo que permite transmitirlo sin cargarlo entero en memoria.
 *   - El texto plano es un flujo zlib que, inflado, es la base SQLite.
 *
 * Disposición del archivo (copia de un solo archivo, el caso de msgstore):
 *   [varint tamaño prefijo][prefijo protobuf][texto cifrado][etiqueta 16][md5 16]
 * @module crypto/backup-cipher
 */

import { AppError, ErrorCode } from '../util/errors.js';
import { deriveJ0 } from './ghash.js';
import { KeyType } from './backup-header.js';
import { equal16, Md5 } from './md5.js';

const CHUNK = 8 * 1024 * 1024; // múltiplo de 16; tamaño de lectura del archivo cifrado
const HKDF_SALT = new Uint8Array(32);
const HKDF_INFO = new TextEncoder().encode('backup encryption');

/**
 * Deriva la clave AES de la copia a partir de la clave raíz.
 * @param {Uint8Array} rootKey 32 bytes
 * @returns {Promise<CryptoKey>}
 */
export async function deriveBackupKey(rootKey) {
  if (rootKey.length !== 32) throw new AppError(ErrorCode.KEY_INVALID, `Clave raíz de ${rootKey.length} bytes`);
  const hkdf = await crypto.subtle.importKey('raw', copy(rootKey), 'HKDF', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    hkdf,
    256,
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
}

/**
 * H = E_K(0^128), el subclave de hash de GCM, vía un bloque de AES-CTR.
 * @param {CryptoKey} key
 * @returns {Promise<Uint8Array>}
 */
async function hashSubkey(key) {
  const zero = new Uint8Array(16);
  const out = await crypto.subtle.encrypt({ name: 'AES-CTR', counter: zero, length: 32 }, key, zero);
  return new Uint8Array(out);
}

/**
 * Bloque contador para el bloque de texto cifrado `blockIndex` (0-based),
 * equivalente a inc32^(blockIndex+1)(J0) de GCM.
 * @param {Uint8Array} j0
 * @param {number} blockIndex
 * @returns {Uint8Array}
 */
function counterForBlock(j0, blockIndex) {
  const ctr = j0.slice();
  const low = ((ctr[12] << 24) | (ctr[13] << 16) | (ctr[14] << 8) | ctr[15]) >>> 0;
  const next = (low + 1 + blockIndex) >>> 0;
  ctr[12] = next >>> 24;
  ctr[13] = (next >>> 16) & 0xff;
  ctr[14] = (next >>> 8) & 0xff;
  ctr[15] = next & 0xff;
  return ctr;
}

/** @param {Uint8Array} b */
function copy(b) {
  return b.slice();
}

/**
 * Lee un Blob por tramos y los entrega en orden.
 * @param {Blob} blob
 * @param {number} start
 * @param {number} end
 * @param {number} chunk
 * @returns {AsyncGenerator<Uint8Array>}
 */
async function* readBlob(blob, start, end, chunk) {
  for (let pos = start; pos < end; pos += chunk) {
    const stop = Math.min(pos + chunk, end);
    yield new Uint8Array(await blob.slice(pos, stop).arrayBuffer());
  }
}

/**
 * Comprueba la suma md5 final de una copia de un solo archivo.
 * @param {Blob} file
 * @returns {Promise<boolean>}
 */
async function verifyTrailerMd5(file) {
  if (file.size < 16) return false;
  const md5 = new Md5();
  for await (const part of readBlob(file, 0, file.size - 16, CHUNK)) md5.update(part);
  const trailer = new Uint8Array(await file.slice(file.size - 16).arrayBuffer());
  return equal16(md5.digest(), trailer);
}

/**
 * @typedef {object} DecryptResult
 * @property {'single'|'multi'} layout
 * @property {boolean} md5ok      se verificó la suma md5 (solo copia de un archivo)
 * @property {'sqlite'|'zip'} payload
 */

/**
 * Descifra e infla la copia hacia `store`.
 * @param {object} args
 * @param {Blob} args.file         archivo cifrado completo
 * @param {import('./backup-header.js').BackupHeader} args.header
 * @param {Uint8Array} args.rootKey
 * @param {import('../storage/create-store.js').ByteStore} args.store destino del texto plano
 * @param {(done: number, total: number) => void} [args.onProgress] bytes de texto cifrado procesados
 * @returns {Promise<DecryptResult>}
 */
export async function decryptBackupToStore({ file, header, rootKey, store, onProgress }) {
  if (header.passkey || header.keyType === KeyType.E2EE_PASSKEY) {
    throw new AppError(ErrorCode.BACKUP_PASSKEY, 'Copia cifrada con llave de acceso');
  }
  if (header.keyType === KeyType.E2EE_PASSWORD) {
    throw new AppError(ErrorCode.BACKUP_PASSWORD, 'Copia cifrada con contraseña');
  }
  if (header.kind === 'crypt14') {
    throw new AppError(ErrorCode.BACKUP_CRYPT14, 'Copia .crypt14 (no es de extremo a extremo)');
  }

  const key = await deriveBackupKey(rootKey);
  const j0 = deriveJ0(await hashSubkey(key), header.iv);

  // Copia de un solo archivo (msgstore): la md5 final cubre todo menos esos
  // 16 bytes y confirma que el archivo llegó íntegro. Si no cuadra, se trata
  // como multiarchivo (texto cifrado = cuerpo menos la etiqueta GCM final).
  const md5ok = await verifyTrailerMd5(file);
  const layout = md5ok ? 'single' : 'multi';
  const cipherEnd = md5ok ? file.size - 32 : file.size - 16;
  if (cipherEnd <= header.dataOffset) {
    throw new AppError(ErrorCode.BACKUP_CORRUPT, 'La copia no contiene datos cifrados');
  }

  const payload = await inflateCipher({
    file,
    key,
    j0,
    start: header.dataOffset,
    end: cipherEnd,
    store,
    md5ok,
    onProgress,
  });
  return { layout, md5ok, payload };
}

/**
 * Descifra [start,end) en AES-CTR y lo infla (zlib) hacia `store`,
 * validando que el resultado empiece por una base SQLite o un ZIP.
 * @param {object} args
 * @param {Blob} args.file
 * @param {CryptoKey} args.key
 * @param {Uint8Array} args.j0
 * @param {number} args.start
 * @param {number} args.end
 * @param {import('../storage/create-store.js').ByteStore} args.store
 * @param {boolean} args.md5ok
 * @param {(done: number, total: number) => void} [args.onProgress]
 * @returns {Promise<'sqlite'|'zip'>}
 */
async function inflateCipher({ file, key, j0, start, end, store, md5ok, onProgress }) {
  const total = end - start;
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  /** @type {'sqlite'|'zip'|''} */
  let payload = '';
  /** @type {Uint8Array} */
  let sniff = new Uint8Array(0);

  // El lector nunca rechaza hacia fuera: guarda su error para inspeccionarlo
  // tras cerrar o abortar el escritor, de modo que no quede un rechazo suelto.
  /** @type {unknown} */
  let drainError = null;
  const drain = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (payload === '') {
          sniff = concat(sniff, value);
          if (sniff.length >= 16) payload = classifyPayload(sniff);
        }
        store.append(value);
      }
    } catch (err) {
      drainError = err;
    }
  })();

  try {
    let blockIndex = 0;
    let processed = 0;
    for await (const chunk of readBlob(file, start, end, CHUNK)) {
      const counter = /** @type {BufferSource} */ (counterForBlock(j0, blockIndex));
      const clear = await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 32 }, key, /** @type {BufferSource} */ (chunk));
      blockIndex += chunk.length >>> 4; // bloques de 16 bytes consumidos
      await writer.write(new Uint8Array(clear));
      processed += chunk.length;
      if (onProgress) onProgress(processed, total);
    }
    await writer.close();
    await drain;
    if (drainError) throw drainError;
  } catch (err) {
    await writer.abort(err).catch(() => {});
    await drain;
    // zlib falla de inmediato con una clave equivocada; si el archivo estaba
    // íntegro (md5 correcta), la única causa posible es la clave.
    if (payload === '') {
      throw new AppError(md5ok ? ErrorCode.KEY_WRONG : ErrorCode.BACKUP_CORRUPT, describe(err));
    }
    throw new AppError(ErrorCode.BACKUP_CORRUPT, describe(err));
  }

  if (payload === '') {
    if (sniff.length > 0) payload = classifyPayload(sniff);
    if (payload === '') throw new AppError(ErrorCode.KEY_WRONG, 'El contenido descifrado está vacío');
  }
  if (payload === 'zip') {
    throw new AppError(
      ErrorCode.BACKUP_NOT_DATABASE,
      'La copia es incremental o multiarchivo, no una base de datos completa',
    );
  }
  return payload;
}

/** @param {unknown} err */
function describe(err) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * @param {Uint8Array} head
 * @returns {'sqlite'|'zip'|''}
 */
function classifyPayload(head) {
  if (head.length >= 16) {
    let sqlite = true;
    const magic = 'SQLite format 3\u0000';
    for (let i = 0; i < 16; i++) {
      if (head[i] !== magic.charCodeAt(i)) {
        sqlite = false;
        break;
      }
    }
    if (sqlite) return 'sqlite';
  }
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip'; // "PK"
  return '';
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {Uint8Array}
 */
function concat(a, b) {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
