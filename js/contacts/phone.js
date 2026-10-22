// @ts-check
/**
 * Normalización de números para cruzar WhatsApp, la agenda y los vCard.
 * @module contacts/phone
 */

/**
 * Solo los dígitos de una cadena.
 * @param {string} value
 * @returns {string}
 */
export function digitsOnly(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 48 && c <= 57) out += value[i];
  }
  return out;
}

/**
 * Formato de presentación +<dígitos>.
 * @param {string} digits
 * @returns {string}
 */
export function formatPhone(digits) {
  return digits ? `+${digits}` : '';
}

/**
 * Índice tolerante: busca por dígitos completos y, si falla, por los últimos
 * `tail` dígitos (números de agenda guardados sin prefijo de país).
 * @template V
 */
export class PhoneIndex {
  /** @param {number} [tail] */
  constructor(tail = 9) {
    /** @type {Map<string, V>} */
    this.full = new Map();
    /** @type {Map<string, V|null>} */
    this.byTail = new Map();
    this.tail = tail;
  }

  /**
   * @param {string} digits
   * @param {V} value
   */
  set(digits, value) {
    if (!digits) return;
    this.full.set(digits, value);
    if (digits.length >= this.tail) {
      const key = digits.slice(-this.tail);
      // Una cola ambigua (dos números distintos) se marca null y no se usa.
      this.byTail.set(key, this.byTail.has(key) ? null : value);
    }
  }

  /**
   * @param {string} digits
   * @returns {V|undefined}
   */
  get(digits) {
    if (!digits) return undefined;
    const exact = this.full.get(digits);
    if (exact !== undefined) return exact;
    if (digits.length >= this.tail) {
      const loose = this.byTail.get(digits.slice(-this.tail));
      if (loose) return loose;
    }
    return undefined;
  }
}
