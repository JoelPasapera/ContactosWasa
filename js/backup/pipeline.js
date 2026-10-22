// @ts-check
/**
 * Orquesta el proceso completo sin tocar el DOM: abre las copias, extrae los
 * hilos del msgstore, lee la agenda de wa.db, opcionalmente enriquece con un
 * vCard y fusiona todo en el padrón final. Lo usan tanto el Worker como las
 * pruebas en Node.
 * @module backup/pipeline
 */

import { openBackupFile } from './loader.js';
import { WhatsappExtractor } from '../whatsapp/extract.js';
import { readAddressBook } from '../contacts/wa-contacts.js';
import { parseVcards } from '../contacts/vcard.js';
import { buildContacts } from '../contacts/merge.js';
import { AppError, ErrorCode } from '../util/errors.js';

/**
 * @typedef {object} PipelineInput
 * @property {Array<{ blob: Blob, name: string }>} backups copias/bases a procesar
 * @property {Uint8Array|null} rootKey   clave de 32 bytes, o null
 * @property {string} [vcardText]        contenido de un .vcf opcional
 * @property {boolean} [includeGroups]
 * @property {(phase: string, done: number, total: number) => void} [onProgress]
 */

/**
 * @typedef {object} PipelineResult
 * @property {import('../contacts/merge.js').Contact[]} contacts
 * @property {import('../whatsapp/extract.js').ExtractStats|null} stats
 * @property {{ hasMsgstore: boolean, hasAddressBook: boolean, enrichedFromVcard: boolean }} sources
 */

/**
 * @param {PipelineInput} input
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline(input) {
  const report = input.onProgress ?? (() => {});
  /** @type {import('../sqlite/database.js').SqliteDatabase|null} */
  let msgDb = null;
  /** @type {import('../sqlite/database.js').SqliteDatabase|null} */
  let waDb = null;
  /** @type {import('../storage/create-store.js').ByteStore[]} */
  const stores = [];

  try {
    for (const { blob, name } of input.backups) {
      report('abriendo', 0, 1);
      const opened = await openBackupFile({ file: blob, rootKey: input.rootKey, onProgress: report, name });
      stores.push(opened.store);
      if (opened.role === 'msgstore' && !msgDb) msgDb = opened.db;
      else if (opened.role === 'wa' && !waDb) waDb = opened.db;
    }

    if (!msgDb && !waDb) {
      throw new AppError(ErrorCode.NO_WHATSAPP_DATA, 'Ninguno de los archivos es msgstore ni wa.db');
    }

    report('analizando', 0, 1);
    /** @type {import('../whatsapp/extract.js').Thread[]} */
    let threads = [];
    /** @type {import('../whatsapp/extract.js').ExtractStats|null} */
    let stats = null;
    if (msgDb) {
      const extracted = new WhatsappExtractor(msgDb).extract(report);
      threads = extracted.threads;
      stats = extracted.stats;
    }

    const addressBook = waDb ? readAddressBook(waDb) : new Map();
    const vcard = input.vcardText ? parseVcards(input.vcardText) : undefined;

    report('fusionando', 0, 1);
    const contacts = buildContacts({
      threads,
      addressBook,
      vcard,
      includeGroups: input.includeGroups ?? true,
    });

    return {
      contacts,
      stats,
      sources: {
        hasMsgstore: Boolean(msgDb),
        hasAddressBook: addressBook.size > 0,
        enrichedFromVcard: Boolean(vcard),
      },
    };
  } finally {
    // Libera los almacenes temporales (borra los archivos OPFS si se usaron).
    for (const store of stores) await store.dispose().catch(() => {});
  }
}
