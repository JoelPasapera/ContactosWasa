// Lector ZIP mínimo SOLO para pruebas: recorre cabeceras locales y descomprime.
// Sirve para verificar el ZIP y el XLSX que produce la aplicación.
import { inflateRawSync } from 'node:zlib';

/**
 * @param {Uint8Array} buf
 * @returns {Map<string, Uint8Array>}
 */
export function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  const out = new Map();
  let o = 0;
  while (o + 4 <= buf.length && dv.getUint32(o, true) === 0x04034b50) {
    const method = dv.getUint16(o + 8, true);
    const compSize = dv.getUint32(o + 18, true);
    const nameLen = dv.getUint16(o + 26, true);
    const extraLen = dv.getUint16(o + 28, true);
    const nameStart = o + 30;
    const name = dec.decode(buf.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw.slice());
    o = dataStart + compSize;
  }
  return out;
}
