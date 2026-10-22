// @ts-check
/**
 * Escritor de vCard 3.0 para volcar el padrón como agenda importable.
 * @module export/vcard-export
 */

/**
 * Escapa un valor de propiedad vCard (RFC 6350 §3.4).
 * @param {string} value
 * @returns {string}
 */
function escapeValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * @typedef {object} VcardEntry
 * @property {string} name
 * @property {string} phone  formato +<dígitos> ('' si no hay)
 */

/**
 * @param {VcardEntry[]} entries
 * @returns {Blob}
 */
export function toVcardBlob(entries) {
  const parts = [];
  for (const entry of entries) {
    if (!entry.phone) continue; // sin número no hay nada que importar
    parts.push('BEGIN:VCARD\r\n');
    parts.push('VERSION:3.0\r\n');
    parts.push(`FN:${escapeValue(entry.name)}\r\n`);
    parts.push(`TEL;TYPE=CELL:${entry.phone}\r\n`);
    parts.push('END:VCARD\r\n');
  }
  return new Blob(parts, { type: 'text/vcard;charset=utf-8' });
}
