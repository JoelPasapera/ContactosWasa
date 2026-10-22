// @ts-check
/**
 * Definición única del padrón exportable: columnas, formato de fechas y
 * conversión de la lista de contactos a filas. La comparten las salidas
 * XLSX, CSV y vCard para no duplicar el esquema.
 * @module export/report
 */

import { ContactType } from '../contacts/merge.js';

/** @typedef {import('../contacts/merge.js').Contact} Contact */

/**
 * Etiquetas legibles por tipo de contacto.
 * @type {Record<string, string>}
 */
const TYPE_LABEL = {
  [ContactType.CONTACT]: 'Contacto',
  [ContactType.GROUP]: 'Grupo',
  [ContactType.HIDDEN]: 'Sin número',
  [ContactType.BROADCAST]: 'Difusión',
  [ContactType.CHANNEL]: 'Canal',
};

/** @type {import('./xlsx.js').XlsxColumn[]} */
export const COLUMNS = [
  { header: 'Nombre', width: 28 },
  { header: 'Teléfono', width: 18 },
  { header: 'Tipo', width: 12 },
  { header: '¿Yo inicié?', width: 12 },
  { header: 'Mensajes', width: 11, numeric: true },
  { header: 'Enviados', width: 11, numeric: true },
  { header: 'Recibidos', width: 11, numeric: true },
  { header: 'Llamadas', width: 10, numeric: true },
  { header: 'Primer mensaje', width: 18 },
  { header: 'Último mensaje', width: 18 },
  { header: 'En agenda', width: 11 },
  { header: 'Origen del nombre', width: 16 },
  { header: 'JID', width: 30 },
];

/**
 * @param {number} ms milisegundos desde época (0 = desconocido)
 * @returns {string} 'AAAA-MM-DD HH:MM' en hora local, o ''
 */
export function formatTimestamp(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  /** @param {number} n */
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * @param {number|null} v
 * @returns {string}
 */
function initiatedLabel(v) {
  if (v === 1) return 'Sí';
  if (v === 0) return 'No';
  return '—';
}

/**
 * @param {Contact} c
 * @returns {Array<string|number>}
 */
export function contactToRow(c) {
  return [
    c.name,
    c.phone,
    TYPE_LABEL[c.type] ?? c.type,
    initiatedLabel(c.initiatedByMe),
    c.messageCount,
    c.sentByMe,
    c.received,
    c.callCount,
    formatTimestamp(c.firstTs),
    formatTimestamp(c.lastTs),
    c.inAddressBook ? 'Sí' : 'No',
    c.nameSource,
    c.jid,
  ];
}

/**
 * @param {Contact[]} contacts
 * @returns {Array<Array<string|number>>}
 */
export function contactsToRows(contacts) {
  return contacts.map(contactToRow);
}

/**
 * @param {Contact[]} contacts
 * @returns {import('./vcard-export.js').VcardEntry[]}
 */
export function contactsToVcards(contacts) {
  return contacts
    .filter((c) => c.phone && c.type === ContactType.CONTACT)
    .map((c) => ({ name: c.name, phone: c.phone }));
}

/** Nombres de las cabeceras para CSV. */
export function headerLabels() {
  return COLUMNS.map((c) => c.header);
}
