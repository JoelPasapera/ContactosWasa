// @ts-check
/**
 * Interpretación de los JID (identificadores) de WhatsApp.
 *
 *   51999888777@s.whatsapp.net   contacto (número internacional sin +)
 *   120363XXXXXXXXXXXXX@g.us      grupo
 *   123456789012345@lid          identificador oculto (sin número visible)
 *   status@broadcast             estados
 *   ...@broadcast                lista de difusión
 *   ...@newsletter               canal
 * @module whatsapp/jid
 */

export const JidKind = Object.freeze({
  USER: 'user',
  GROUP: 'group',
  LID: 'lid',
  BROADCAST: 'broadcast',
  STATUS: 'status',
  NEWSLETTER: 'newsletter',
  OTHER: 'other',
});

/** @typedef {typeof JidKind[keyof typeof JidKind]} JidKindValue */

/**
 * @param {string} server parte tras la @
 * @param {string} user    parte antes de la @
 * @returns {JidKindValue}
 */
export function classifyServer(server, user) {
  switch (server) {
    case 's.whatsapp.net':
    case 'c.us':
      return JidKind.USER;
    case 'g.us':
      return JidKind.GROUP;
    case 'lid':
      return JidKind.LID;
    case 'newsletter':
      return JidKind.NEWSLETTER;
    case 'broadcast':
      return user === 'status' ? JidKind.STATUS : JidKind.BROADCAST;
    default:
      return JidKind.OTHER;
  }
}

/**
 * Número en formato +<dígitos> si el usuario es un número de teléfono.
 * Un usuario que no es solo dígitos (p. ej. un LID) devuelve cadena vacía.
 * @param {string} user
 * @param {JidKindValue} kind
 * @returns {string}
 */
export function userToPhone(user, kind) {
  if (kind !== JidKind.USER) return '';
  // El "device" o "agent" puede venir como 51999...:3 o 51999....0; nos
  // quedamos con la parte anterior a ':' o '.'.
  const base = user.split(/[.:]/, 1)[0];
  return /^[0-9]{5,16}$/.test(base) ? `+${base}` : '';
}

/**
 * Divide un raw_string "user@server" en sus dos partes.
 * @param {string} raw
 * @returns {{ user: string, server: string }}
 */
export function splitJid(raw) {
  const at = raw.lastIndexOf('@');
  if (at < 0) return { user: raw, server: '' };
  return { user: raw.slice(0, at), server: raw.slice(at + 1) };
}
