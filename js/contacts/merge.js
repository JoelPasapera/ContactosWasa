// @ts-check
/**
 * Fusión del padrón final: cruza los hilos del msgstore con la agenda de
 * wa.db y, si se aporta, un vCard. Produce la lista de contactos con el
 * nombre más fiable disponible, de quién partió cada conversación y los
 * agregados de mensajes y llamadas.
 * @module contacts/merge
 */

import { JidKind } from '../whatsapp/jid.js';
import { digitsOnly, formatPhone } from './phone.js';

export const ContactType = Object.freeze({
  CONTACT: 'contacto',
  GROUP: 'grupo',
  HIDDEN: 'oculto', // solo LID, sin número visible
  BROADCAST: 'difusión',
  CHANNEL: 'canal',
});

export const NameSource = Object.freeze({
  ADDRESS_BOOK: 'agenda',
  VCARD: 'vcard',
  WHATSAPP: 'whatsapp',
  SUBJECT: 'asunto',
  NUMBER: 'numero',
  UNKNOWN: 'desconocido',
});

/**
 * @typedef {object} Contact
 * @property {string} name
 * @property {string} nameSource
 * @property {string} phone        formato +<dígitos> ('' si oculto/grupo)
 * @property {string} jid
 * @property {string} type         uno de ContactType
 * @property {boolean} hasChat
 * @property {boolean} inAddressBook
 * @property {number|null} initiatedByMe 1, 0 o null
 * @property {number} messageCount
 * @property {number} sentByMe
 * @property {number} received
 * @property {number} firstTs
 * @property {number} lastTs
 * @property {number} callCount
 * @property {number} callsByMe
 * @property {number} groupMembers
 */

/**
 * @param {import('../whatsapp/jid.js').JidKindValue} kind
 * @returns {string}
 */
function typeOf(kind) {
  switch (kind) {
    case JidKind.GROUP:
      return ContactType.GROUP;
    case JidKind.LID:
      return ContactType.HIDDEN;
    case JidKind.BROADCAST:
      return ContactType.BROADCAST;
    case JidKind.NEWSLETTER:
      return ContactType.CHANNEL;
    default:
      return ContactType.CONTACT;
  }
}

/**
 * Clave de deduplicación: por número cuando existe, si no por JID.
 * @param {string} phoneDigits
 * @param {string} jidRaw
 */
function keyFor(phoneDigits, jidRaw) {
  return phoneDigits ? `p:${phoneDigits}` : `j:${jidRaw}`;
}

/**
 * @param {object} args
 * @param {import('../whatsapp/extract.js').Thread[]} args.threads
 * @param {Map<string, import('./wa-contacts.js').AddressEntry>} [args.addressBook]
 * @param {import('./phone.js').PhoneIndex<string>} [args.vcard]
 * @param {boolean} [args.includeGroups]
 * @param {boolean} [args.includeStatusBroadcast]
 * @returns {Contact[]}
 */
export function buildContacts({ threads, addressBook, vcard, includeGroups = true }) {
  const book = addressBook ?? new Map();
  /** @type {Map<string, Contact>} */
  const byKey = new Map();

  for (const t of threads) {
    const type = typeOf(t.kind);
    if (type === ContactType.GROUP && !includeGroups) continue;
    if (t.kind === JidKind.STATUS || t.kind === JidKind.OTHER) continue;

    const phoneDigits = digitsOnly(t.phone);
    const key = keyFor(phoneDigits, t.jidRaw || String(t.chatRowId));
    const agendaEntry = phoneDigits ? book.get(phoneDigits) : undefined;
    const vcardName = phoneDigits && vcard ? vcard.get(phoneDigits) : undefined;
    const resolved = resolveName({ type, subject: t.subject, lidName: t.lidName, phoneDigits, agendaEntry, vcardName });

    const contact = {
      name: resolved.name,
      nameSource: resolved.source,
      phone: formatPhone(phoneDigits),
      jid: t.jidRaw,
      type,
      hasChat: t.chatRowId >= 0,
      inAddressBook: Boolean(agendaEntry),
      initiatedByMe: t.initiatedByMe,
      messageCount: t.messageCount,
      sentByMe: t.sentByMe,
      received: t.messageCount - t.sentByMe,
      firstTs: t.firstTs,
      lastTs: t.lastTs,
      callCount: t.callCount,
      callsByMe: t.callsByMe,
      groupMembers: t.groupMembers,
    };
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeThreadIntoContact(prev, contact) : contact);
  }

  // Contactos de la agenda que usan WhatsApp pero no tienen chat ni llamadas.
  for (const [digits, entry] of book) {
    if (!entry.isWhatsapp) continue;
    const key = keyFor(digits, '');
    if (byKey.has(key)) continue;
    byKey.set(key, {
      name: entry.name || formatPhone(digits),
      nameSource: entry.name ? NameSource.ADDRESS_BOOK : NameSource.NUMBER,
      phone: formatPhone(digits),
      jid: `${digits}@s.whatsapp.net`,
      type: ContactType.CONTACT,
      hasChat: false,
      inAddressBook: true,
      initiatedByMe: null,
      messageCount: 0,
      sentByMe: 0,
      received: 0,
      firstTs: 0,
      lastTs: 0,
      callCount: 0,
      callsByMe: 0,
      groupMembers: 0,
    });
  }

  return [...byKey.values()];
}

/**
 * Elige el mejor nombre y de dónde sale.
 * @param {object} a
 * @param {string} a.type
 * @param {string} a.subject
 * @param {string} a.lidName
 * @param {string} a.phoneDigits
 * @param {import('./wa-contacts.js').AddressEntry|undefined} a.agendaEntry
 * @param {string|undefined} a.vcardName
 * @returns {{ name: string, source: string }}
 */
function resolveName({ type, subject, lidName, phoneDigits, agendaEntry, vcardName }) {
  if (type === ContactType.GROUP) {
    return { name: subject || 'Grupo sin nombre', source: NameSource.SUBJECT };
  }
  if (agendaEntry && agendaEntry.name) return { name: agendaEntry.name, source: NameSource.ADDRESS_BOOK };
  if (vcardName) return { name: vcardName, source: NameSource.VCARD };
  if (lidName) return { name: lidName, source: NameSource.WHATSAPP };
  if (phoneDigits) return { name: formatPhone(phoneDigits), source: NameSource.NUMBER };
  return { name: 'Contacto oculto', source: NameSource.UNKNOWN };
}

/**
 * Combina dos entradas con la misma clave (p. ej. chat + llamadas sueltas).
 * @param {Contact} a
 * @param {Contact} b
 * @returns {Contact}
 */
function mergeThreadIntoContact(a, b) {
  const better = rankSource(b.nameSource) < rankSource(a.nameSource) ? b : a;
  return {
    ...a,
    name: better.name,
    nameSource: better.nameSource,
    hasChat: a.hasChat || b.hasChat,
    inAddressBook: a.inAddressBook || b.inAddressBook,
    initiatedByMe: a.initiatedByMe ?? b.initiatedByMe,
    messageCount: a.messageCount + b.messageCount,
    sentByMe: a.sentByMe + b.sentByMe,
    received: a.received + b.received,
    firstTs: minPositive(a.firstTs, b.firstTs),
    lastTs: Math.max(a.lastTs, b.lastTs),
    callCount: a.callCount + b.callCount,
    callsByMe: a.callsByMe + b.callsByMe,
    groupMembers: Math.max(a.groupMembers, b.groupMembers),
  };
}

/** @param {string} source */
function rankSource(source) {
  /** @type {string[]} */
  const order = [NameSource.ADDRESS_BOOK, NameSource.VCARD, NameSource.WHATSAPP, NameSource.SUBJECT, NameSource.NUMBER, NameSource.UNKNOWN];
  const i = order.indexOf(source);
  return i < 0 ? order.length : i;
}

/** @param {number} a @param {number} b */
function minPositive(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Math.min(a, b);
}
