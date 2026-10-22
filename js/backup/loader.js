// @ts-check
/**
 * Abre un archivo (copia .crypt15 cifrada o base .db ya descifrada) y lo deja
 * como una base SQLite consultable, eligiendo almacenamiento en memoria u
 * OPFS según el tamaño. Clasifica el rol de la base por sus tablas.
 * @module backup/loader
 */

import { HEADER_PROBE_BYTES, parseBackupHeader } from '../crypto/backup-header.js';
import { decryptBackupToStore } from '../crypto/backup-cipher.js';
import { createStore } from '../storage/create-store.js';
import { SqliteDatabase } from '../sqlite/database.js';
import { isSqlite } from '../sqlite/header.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { readHead } from '../util/bytes.js';

/** Tamaño de lectura al copiar una base ya descifrada hacia el almacén. */
const COPY_CHUNK = 8 * 1024 * 1024;

/**
 * @typedef {'msgstore'|'wa'|'other'} BackupRole
 */

/**
 * @typedef {object} OpenedBackup
 * @property {SqliteDatabase} db
 * @property {import('../storage/create-store.js').ByteStore} store
 * @property {BackupRole} role
 * @property {import('../crypto/backup-header.js').BackupHeader|null} header
 */

/**
 * @param {SqliteDatabase} db
 * @returns {BackupRole}
 */
function classify(db) {
  if (db.hasTable('message') && db.hasTable('chat')) return 'msgstore';
  if (db.hasTable('wa_contacts') || db.hasTable('wa_address_book')) return 'wa';
  return 'other';
}

/**
 * @param {object} args
 * @param {Blob} args.file
 * @param {Uint8Array|null} args.rootKey  32 bytes, o null si no se dio clave
 * @param {(phase: string, done: number, total: number) => void} [args.onProgress]
 * @param {string} [args.name] nombre del archivo para los mensajes de error
 * @returns {Promise<OpenedBackup>}
 */
export async function openBackupFile({ file, rootKey, onProgress, name = '' }) {
  const report = onProgress ?? (() => {});
  const head = await readHead(file, HEADER_PROBE_BYTES);
  const header = parseBackupHeader(head);

  const store = await createStore(file.size, 'db');
  try {
    if (header) {
      if (!rootKey) throw new AppError(ErrorCode.KEY_MISSING, 'La copia está cifrada y falta la clave', { file: name });
      await decryptBackupToStore({
        file,
        header,
        rootKey,
        store,
        onProgress: (done, total) => report('descifrando', done, total),
      });
    } else if (isSqlite(head)) {
      await copyPlainFile(file, store, (done, total) => report('leyendo', done, total));
    } else {
      throw new AppError(ErrorCode.NOT_A_BACKUP, 'No es una copia de WhatsApp ni una base SQLite', { file: name });
    }
    await store.seal();
    const db = new SqliteDatabase(store);
    return { db, store, role: classify(db), header };
  } catch (err) {
    await store.dispose().catch(() => {});
    if (err instanceof AppError && !err.file) err.file = name;
    throw err;
  }
}

/**
 * Copia una base ya descifrada al almacén por tramos.
 * @param {Blob} file
 * @param {import('../storage/create-store.js').ByteStore} store
 * @param {(done: number, total: number) => void} onProgress
 */
async function copyPlainFile(file, store, onProgress) {
  for (let pos = 0; pos < file.size; pos += COPY_CHUNK) {
    const end = Math.min(pos + COPY_CHUNK, file.size);
    store.append(new Uint8Array(await file.slice(pos, end).arrayBuffer()));
    onProgress(end, file.size);
  }
}
