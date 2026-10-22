// @ts-check
/**
 * CRC-32 (polinomio IEEE 0xEDB88320) con tabla precomputada, para ZIP.
 * @module export/crc32
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * CRC-32 incremental.
 * @param {Uint8Array} data
 * @param {number} [crc] valor previo (para continuar)
 * @returns {number} CRC sin signo de 32 bits
 */
export function crc32(data, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
