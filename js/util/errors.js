// @ts-check
/**
 * Errores de dominio identificados por código. Los textos para el usuario
 * viven en la capa de interfaz (ui/error-messages.js); aquí solo hay códigos
 * y detalle técnico.
 * @module util/errors
 */

export const ErrorCode = Object.freeze({
  /** Hay copias cifradas y no se dio clave. */
  KEY_MISSING: 'KEY_MISSING',
  /** La clave no tiene 64 dígitos hexadecimales. */
  KEY_INVALID: 'KEY_INVALID',
  /** La clave no descifra la copia. */
  KEY_WRONG: 'KEY_WRONG',
  /** Copia cifrada con contraseña: el servidor custodia la clave. */
  BACKUP_PASSWORD: 'BACKUP_PASSWORD',
  /** Copia cifrada con llave de acceso (passkey). */
  BACKUP_PASSKEY: 'BACKUP_PASSKEY',
  /** Copia .crypt14: cifrado de extremo a extremo desactivado. */
  BACKUP_CRYPT14: 'BACKUP_CRYPT14',
  /** Copia incremental o multiarchivo (ZIP), no una base completa. */
  BACKUP_NOT_DATABASE: 'BACKUP_NOT_DATABASE',
  /** Archivo truncado o dañado. */
  BACKUP_CORRUPT: 'BACKUP_CORRUPT',
  /** El archivo no es una copia de WhatsApp reconocible. */
  NOT_A_BACKUP: 'NOT_A_BACKUP',
  /** El contenido no es una base SQLite. */
  NOT_SQLITE: 'NOT_SQLITE',
  /** Estructura SQLite inconsistente. */
  SQLITE_CORRUPT: 'SQLITE_CORRUPT',
  /** Ninguna de las bases es msgstore ni wa.db. */
  NO_WHATSAPP_DATA: 'NO_WHATSAPP_DATA',
  /** Falta almacenamiento o memoria. */
  STORAGE: 'STORAGE',
  /** El navegador no tiene las API necesarias. */
  UNSUPPORTED_BROWSER: 'UNSUPPORTED_BROWSER',
  /** Fallo no previsto. */
  INTERNAL: 'INTERNAL',
});

/** @typedef {typeof ErrorCode[keyof typeof ErrorCode]} ErrorCodeValue */

export class AppError extends Error {
  /**
   * @param {ErrorCodeValue} code
   * @param {string} [detail] detalle técnico (no se traduce)
   * @param {{ file?: string }} [context]
   */
  constructor(code, detail = '', context = {}) {
    super(detail || code);
    this.name = 'AppError';
    /** @type {ErrorCodeValue} */
    this.code = code;
    this.detail = detail;
    this.file = context.file ?? '';
  }
}

/**
 * Forma serializable para cruzar el límite del Worker.
 * @typedef {{ code: ErrorCodeValue, detail: string, file: string }} SerializedError
 */

/**
 * @param {unknown} err
 * @returns {SerializedError}
 */
export function serializeError(err) {
  if (err instanceof AppError) return { code: err.code, detail: err.detail, file: err.file };
  if (err instanceof Error && (err.name === 'QuotaExceededError' || err.name === 'NotReadableError')) {
    return { code: ErrorCode.STORAGE, detail: `${err.name}: ${err.message}`, file: '' };
  }
  if (err instanceof RangeError && /allocation|memory|Array buffer/i.test(err.message)) {
    return { code: ErrorCode.STORAGE, detail: err.message, file: '' };
  }
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { code: ErrorCode.INTERNAL, detail, file: '' };
}
