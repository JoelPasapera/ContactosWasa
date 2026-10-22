// @ts-check
/**
 * Traduce los códigos de error del dominio a mensajes claros en español para
 * el usuario. Mantiene la capa de lógica libre de textos de interfaz.
 * @module ui/error-messages
 */

import { ErrorCode } from '../util/errors.js';

/** @type {Record<string, { title: string, hint: string }>} */
const MESSAGES = {
  [ErrorCode.KEY_MISSING]: {
    title: 'Falta la clave de cifrado',
    hint: 'Tu copia está cifrada. Escribe los 64 dígitos de tu clave o adjunta el archivo encrypted_backup.key.',
  },
  [ErrorCode.KEY_INVALID]: {
    title: 'La clave no tiene el formato correcto',
    hint: 'Debe ser una secuencia de 64 dígitos hexadecimales (0-9 y a-f). Puedes pegarla con o sin espacios.',
  },
  [ErrorCode.KEY_WRONG]: {
    title: 'La clave no corresponde a esta copia',
    hint: 'El archivo se leyó bien pero la clave no lo descifra. Revisa que sea la clave de 64 dígitos de esta misma cuenta.',
  },
  [ErrorCode.BACKUP_PASSWORD]: {
    title: 'Copia protegida con contraseña',
    hint: 'Esta copia usa una contraseña en lugar de la clave de 64 dígitos. Aquí solo se admite la clave de 64 dígitos.',
  },
  [ErrorCode.BACKUP_PASSKEY]: {
    title: 'Copia protegida con llave de acceso',
    hint: 'Esta copia usa una passkey. Aquí solo se admite la clave de 64 dígitos del cifrado de extremo a extremo.',
  },
  [ErrorCode.BACKUP_CRYPT14]: {
    title: 'Copia en formato antiguo (.crypt14)',
    hint: 'Este formato no usa la clave de 64 dígitos. Genera una copia nueva con el cifrado de extremo a extremo activado.',
  },
  [ErrorCode.BACKUP_NOT_DATABASE]: {
    title: 'La copia no es una base completa',
    hint: 'Parece una copia incremental o multiarchivo. Usa el archivo msgstore.db.crypt15 principal.',
  },
  [ErrorCode.BACKUP_CORRUPT]: {
    title: 'La copia parece dañada o incompleta',
    hint: 'Vuelve a copiar el archivo desde el teléfono; pudo truncarse durante la transferencia.',
  },
  [ErrorCode.NOT_A_BACKUP]: {
    title: 'El archivo no es una copia de WhatsApp',
    hint: 'Espera un archivo .crypt15 o una base .db. Revisa que no te hayas equivocado de archivo.',
  },
  [ErrorCode.NOT_SQLITE]: {
    title: 'El contenido no es una base de datos válida',
    hint: 'Tras descifrar, el contenido no es una base SQLite. Suele indicar una clave equivocada.',
  },
  [ErrorCode.SQLITE_CORRUPT]: {
    title: 'La base de datos está dañada',
    hint: 'La estructura interna es inconsistente. Prueba con otra copia del teléfono.',
  },
  [ErrorCode.NO_WHATSAPP_DATA]: {
    title: 'No se encontraron datos de WhatsApp',
    hint: 'Ninguno de los archivos es msgstore ni wa.db. Revisa qué archivos adjuntaste.',
  },
  [ErrorCode.STORAGE]: {
    title: 'No hay espacio o memoria suficiente',
    hint: 'La copia es muy grande para este dispositivo. Cierra otras pestañas e inténtalo de nuevo.',
  },
  [ErrorCode.UNSUPPORTED_BROWSER]: {
    title: 'Tu navegador no es compatible',
    hint: 'Usa una versión reciente de Chrome, Edge, Firefox o Safari.',
  },
  [ErrorCode.INTERNAL]: {
    title: 'Ocurrió un error inesperado',
    hint: 'Vuelve a intentarlo. Si persiste, prueba con otra copia.',
  },
};

/**
 * @param {string} code
 * @param {string} [file]
 * @returns {{ title: string, hint: string }}
 */
export function describeError(code, file = '') {
  const base = MESSAGES[code] ?? MESSAGES[ErrorCode.INTERNAL];
  if (file) return { title: base.title, hint: `${base.hint} (Archivo: ${file})` };
  return base;
}
