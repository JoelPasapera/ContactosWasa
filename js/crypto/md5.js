// @ts-check
/**
 * MD5 incremental (RFC 1321). WhatsApp lo usa como suma de comprobación de
 * integridad al final de las copias de un solo archivo; no cumple ninguna
 * función de seguridad aquí, solo detecta archivos truncados o dañados.
 * @module crypto/md5
 */

const S = Int32Array.of(
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
);

const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

/** @param {number} x @param {number} c */
function rotl(x, c) {
  return (x << c) | (x >>> (32 - c));
}

export class Md5 {
  constructor() {
    this.a = 0x67452301;
    this.b = 0xefcdab89;
    this.c = 0x98badcfe;
    this.d = 0x10325476;
    this.block = new Uint8Array(64);
    this.view = new DataView(this.block.buffer);
    this.blockLength = 0;
    this.totalLength = 0;
  }

  /** @param {Uint8Array} data */
  update(data) {
    this.totalLength += data.length;
    let src = 0;
    if (this.blockLength > 0) {
      const need = 64 - this.blockLength;
      const take = Math.min(need, data.length);
      this.block.set(data.subarray(0, take), this.blockLength);
      this.blockLength += take;
      src = take;
      if (this.blockLength === 64) {
        this.#transform(this.view, 0);
        this.blockLength = 0;
      }
    }
    for (; src + 64 <= data.length; src += 64) {
      // DataView sobre el buffer de entrada para leer little-endian sin copiar.
      this.#transform(new DataView(data.buffer, data.byteOffset + src, 64), 0);
    }
    if (src < data.length) {
      this.block.set(data.subarray(src), 0);
      this.blockLength = data.length - src;
    }
  }

  /** @returns {Uint8Array} 16 bytes */
  digest() {
    const bitLen = this.totalLength * 8;
    const pad = new Uint8Array(this.blockLength < 56 ? 64 : 128);
    pad.set(this.block.subarray(0, this.blockLength));
    pad[this.blockLength] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, bitLen >>> 0, true);
    dv.setUint32(pad.length - 4, Math.floor(bitLen / 4294967296) >>> 0, true);
    for (let o = 0; o < pad.length; o += 64) this.#transform(dv, o);
    const out = new Uint8Array(16);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, this.a >>> 0, true);
    ov.setUint32(4, this.b >>> 0, true);
    ov.setUint32(8, this.c >>> 0, true);
    ov.setUint32(12, this.d >>> 0, true);
    return out;
  }

  /**
   * @param {DataView} dv
   * @param {number} base
   */
  #transform(dv, base) {
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + dv.getUint32(base + g * 4, true)) | 0;
      b = (b + rotl(sum, S[i])) | 0;
      a = tmp;
    }
    this.a = (this.a + a) | 0;
    this.b = (this.b + b) | 0;
    this.c = (this.c + c) | 0;
    this.d = (this.d + d) | 0;
  }
}

/**
 * @param {Uint8Array} a 16 bytes
 * @param {Uint8Array} b 16 bytes
 * @returns {boolean} comparación en tiempo constante
 */
export function equal16(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < 16; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
