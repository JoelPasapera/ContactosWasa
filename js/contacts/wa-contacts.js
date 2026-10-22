// @ts-check
/**
 * Nombres de contacto desde wa.db (la "agenda" sincronizada por WhatsApp):
 * tablas wa_contacts y wa_address_book.
 * @module contacts/wa-contacts
 */

import { digitsOnly } from './phone.js';
import { splitJid } from '../whatsapp/jid.js';

/**
 * @typedef {object} AddressEntry
 * @property {string} name      mejor nombre disponible
 * @property {string} number    número tal como lo guarda la agenda
 * @property {boolean} isWhatsapp
 */

/**
 * @param {string|null} display
 * @param {string|null} given
 * @param {string|null} family
 * @param {string|null} waName
 * @param {string|null} nickname
 * @returns {string}
 */
function bestName(display, given, family, waName, nickname) {
  if (display && display.trim()) return display.trim();
  const full = [given, family].filter((p) => p && p.trim()).join(' ').trim();
  if (full) return full;
  if (nickname && nickname.trim()) return nickname.trim();
  if (waName && waName.trim()) return waName.trim();
  return '';
}

/**
 * Lee la agenda de una base wa.db. Devuelve un índice dígitos→entrada.
 * @param {import('../sqlite/database.js').SqliteDatabase} db
 * @returns {Map<string, AddressEntry>}
 */
export function readAddressBook(db) {
  /** @type {Map<string, AddressEntry>} */
  const out = new Map();

  const contacts = db.table('wa_contacts');
  if (contacts) {
    const cols = ['jid', 'is_whatsapp_user', 'number', 'display_name', 'given_name', 'family_name', 'wa_name', 'nickname', 'sort_name'];
    const proj = contacts.project(cols);
    contacts.scan(proj, (row) => {
      const jid = row.text(0) ?? '';
      const digits = contactDigits(jid, row.text(2));
      if (!digits) return;
      const name = bestName(row.text(3), row.text(4), row.text(5), row.text(6), row.text(7)) || (row.text(8) ?? '');
      const entry = {
        name,
        number: row.text(2) ?? '',
        isWhatsapp: row.num(1) === 1,
      };
      mergeEntry(out, digits, entry);
    });
  }

  const book = db.table('wa_address_book');
  if (book) {
    const cols = ['jid', 'is_whatsapp_user', 'number', 'display_name', 'given_name', 'family_name', 'nickname'];
    const proj = book.project(cols);
    book.scan(proj, (row) => {
      const digits = contactDigits(row.text(0) ?? '', row.text(2));
      if (!digits) return;
      const name = bestName(row.text(3), row.text(4), row.text(5), null, row.text(6));
      mergeEntry(out, digits, { name, number: row.text(2) ?? '', isWhatsapp: row.num(1) === 1 });
    });
  }
  return out;
}

/**
 * Prefiere una entrada con nombre sobre una sin él.
 * @param {Map<string, AddressEntry>} map
 * @param {string} digits
 * @param {AddressEntry} entry
 */
function mergeEntry(map, digits, entry) {
  const prev = map.get(digits);
  if (!prev) {
    map.set(digits, entry);
    return;
  }
  map.set(digits, {
    name: prev.name || entry.name,
    number: prev.number || entry.number,
    isWhatsapp: prev.isWhatsapp || entry.isWhatsapp,
  });
}

/**
 * Dígitos del contacto: del JID si es un número, si no del campo "number".
 * @param {string} jid
 * @param {string|null} number
 * @returns {string}
 */
function contactDigits(jid, number) {
  const { user, server } = splitJid(jid);
  if (server === 's.whatsapp.net' || server === 'c.us') {
    const d = digitsOnly(user);
    if (d) return d;
  }
  return number ? digitsOnly(number) : '';
}
