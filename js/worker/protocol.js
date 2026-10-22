// @ts-check
/**
 * Contrato de mensajes entre la interfaz y el Worker de procesamiento.
 * Define constantes y ayudantes; no contiene lógica.
 * @module worker/protocol
 */

export const RequestType = Object.freeze({ PROCESS: 'process' });
export const ResponseType = Object.freeze({ PROGRESS: 'progress', DONE: 'done', ERROR: 'error' });

/**
 * @typedef {object} ProcessRequest
 * @property {'process'} type
 * @property {Array<{ blob: Blob, name: string }>} backups
 * @property {string} keyText        clave de 64 dígitos ('' si no se da)
 * @property {Uint8Array|null} keyFileBytes bytes de encrypted_backup.key, o null
 * @property {string} vcardText      contenido de .vcf ('' si no se da)
 * @property {boolean} includeGroups
 */

/**
 * @typedef {object} ProgressResponse
 * @property {'progress'} type
 * @property {string} phase
 * @property {number} done
 * @property {number} total
 */

/**
 * @typedef {object} DoneResponse
 * @property {'done'} type
 * @property {import('../contacts/merge.js').Contact[]} contacts
 * @property {import('../whatsapp/extract.js').ExtractStats|null} stats
 * @property {{ hasMsgstore: boolean, hasAddressBook: boolean, enrichedFromVcard: boolean }} sources
 */

/**
 * @typedef {object} ErrorResponse
 * @property {'error'} type
 * @property {string} code
 * @property {string} detail
 * @property {string} file
 */
