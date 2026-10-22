// @ts-check
/**
 * Multiplicación en GF(2^128) y GHASH según NIST SP 800-38D (GCM).
 * Solo se usa para derivar el bloque contador inicial J0 cuando el IV no
 * mide 12 bytes (las copias .crypt15 usan IV de 16 bytes); el cifrado en
 * sí lo hace WebCrypto en modo CTR.
 * Representación: 4 palabras de 32 bits big-endian (w0 = bits más altos).
 * @module crypto/ghash
 */

/** Polinomio de reducción R = 11100001 || 0^120. */
const R0 = 0xe1000000;

/**
 * @param {Uint8Array} b
 * @param {number} o
 * @returns {Uint32Array}
 */
function loadBlock(b, o) {
  const w = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    const p = o + 4 * i;
    w[i] = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  }
  return w;
}

/**
 * @param {Uint32Array} w
 * @returns {Uint8Array}
 */
function storeBlock(w) {
  const out = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    out[4 * i] = w[i] >>> 24;
    out[4 * i + 1] = (w[i] >>> 16) & 0xff;
    out[4 * i + 2] = (w[i] >>> 8) & 0xff;
    out[4 * i + 3] = w[i] & 0xff;
  }
  return out;
}

/**
 * Z = X · Y en GF(2^128) (algoritmo 1 de SP 800-38D).
 * @param {Uint32Array} x
 * @param {Uint32Array} y
 * @returns {Uint32Array}
 */
export function gfMultiply(x, y) {
  let z0 = 0;
  let z1 = 0;
  let z2 = 0;
  let z3 = 0;
  let v0 = y[0];
  let v1 = y[1];
  let v2 = y[2];
  let v3 = y[3];
  for (let i = 0; i < 128; i++) {
    if ((x[i >>> 5] >>> (31 - (i & 31))) & 1) {
      z0 ^= v0;
      z1 ^= v1;
      z2 ^= v2;
      z3 ^= v3;
    }
    const carry = v3 & 1;
    v3 = (v3 >>> 1) | (v2 << 31);
    v2 = (v2 >>> 1) | (v1 << 31);
    v1 = (v1 >>> 1) | (v0 << 31);
    v0 >>>= 1;
    if (carry) v0 ^= R0;
  }
  return Uint32Array.of(z0, z1, z2, z3);
}

/**
 * GHASH_H(X) para X de longitud múltiplo de 16 bytes.
 * @param {Uint8Array} hashKey H = AES_K(0^128)
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function ghash(hashKey, data) {
  if (data.length % 16 !== 0) throw new RangeError('GHASH requiere bloques completos');
  const h = loadBlock(hashKey, 0);
  /** @type {Uint32Array} */
  let y = new Uint32Array(4);
  for (let off = 0; off < data.length; off += 16) {
    const x = loadBlock(data, off);
    for (let i = 0; i < 4; i++) x[i] ^= y[i];
    y = gfMultiply(x, h);
  }
  return storeBlock(y);
}

/**
 * Bloque contador inicial J0 de GCM para un IV de cualquier longitud.
 * @param {Uint8Array} hashKey H = AES_K(0^128)
 * @param {Uint8Array} iv
 * @returns {Uint8Array}
 */
export function deriveJ0(hashKey, iv) {
  if (iv.length === 12) {
    const j0 = new Uint8Array(16);
    j0.set(iv);
    j0[15] = 1;
    return j0;
  }
  const padded = Math.ceil(iv.length / 16) * 16;
  const input = new Uint8Array(padded + 16);
  input.set(iv);
  const bits = iv.length * 8;
  const view = new DataView(input.buffer);
  view.setUint32(padded + 8, Math.floor(bits / 4294967296));
  view.setUint32(padded + 12, bits >>> 0);
  return ghash(hashKey, input);
}
