// @ts-check
/**
 * Lector de vCard (.vcf) suficiente para enriquecer nombres: toma FN (o N) y
 * cada TEL de cada tarjeta. Admite plegado de líneas y codificación
 * quoted-printable en el valor.
 * @module contacts/vcard
 */

import { digitsOnly, PhoneIndex } from './phone.js';

/**
 * Deshace el plegado de líneas (una línea de continuación empieza por espacio
 * o tabulador) según RFC 6350.
 * @param {string} text
 * @returns {string[]}
 */
function unfold(text) {
  const rawLines = text.split(/\r\n|\r|\n/);
  /** @type {string[]} */
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * @param {string} value
 * @returns {string}
 */
function decodeQuotedPrintable(value) {
  const soft = value.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' && i + 2 < soft.length) {
      const hex = soft.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(soft.charCodeAt(i));
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return value;
  }
}

/**
 * Separa "PROP;PARAMS:value" en nombre, parámetros y valor.
 * @param {string} line
 */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  let value = line.slice(colon + 1);
  const parts = head.split(';');
  const prop = parts[0].toUpperCase().replace(/\..*$/, ''); // ignora el grupo "item1.TEL"
  const params = parts.slice(1).map((p) => p.toUpperCase());
  if (params.some((p) => p.includes('QUOTED-PRINTABLE'))) value = decodeQuotedPrintable(value);
  return { prop, params, value };
}

/**
 * De "Apellido;Nombre;;;" (campo N) a "Nombre Apellido".
 * @param {string} value
 * @returns {string}
 */
function nameFromN(value) {
  const [family = '', given = '', middle = ''] = value.split(';');
  return [given, middle, family].map((s) => s.trim()).filter(Boolean).join(' ');
}

/**
 * Construye un índice teléfono→nombre a partir del texto de un .vcf.
 * @param {string} text
 * @returns {PhoneIndex<string>}
 */
export function parseVcards(text) {
  /** @type {PhoneIndex<string>} */
  const index = new PhoneIndex(9);
  let fn = '';
  let n = '';
  /** @type {string[]} */
  let tels = [];
  let inCard = false;

  const flush = () => {
    const name = fn || n;
    if (name) for (const tel of tels) index.set(digitsOnly(tel), name);
    fn = '';
    n = '';
    tels = [];
  };

  for (const line of unfold(text)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { prop, value } = parsed;
    if (prop === 'BEGIN' && value.toUpperCase() === 'VCARD') {
      inCard = true;
      fn = '';
      n = '';
      tels = [];
    } else if (prop === 'END' && value.toUpperCase() === 'VCARD') {
      flush();
      inCard = false;
    } else if (!inCard) {
      continue;
    } else if (prop === 'FN') {
      fn = value.trim();
    } else if (prop === 'N') {
      n = nameFromN(value);
    } else if (prop === 'TEL') {
      if (digitsOnly(value)) tels.push(value);
    }
  }
  return index;
}
