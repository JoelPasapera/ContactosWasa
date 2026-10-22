// @ts-check
/**
 * Lector mínimo del formato binario de Protocol Buffers, sin esquema.
 * Basta para la cabecera de las copias de WhatsApp.
 * @see https://protobuf.dev/programming-guides/encoding/
 * @module crypto/protobuf
 */

export const WireType = Object.freeze({ VARINT: 0, I64: 1, LEN: 2, I32: 5 });

/**
 * @typedef {object} ProtoField
 * @property {number} field número de campo
 * @property {number} wire  tipo de cable
 * @property {number} int   valor si wire = VARINT (exacto hasta 2^53)
 * @property {Uint8Array} bytes contenido si wire = LEN/I64/I32
 */

const EMPTY = new Uint8Array(0);

/**
 * Varint de protobuf (little-endian base 128).
 * @param {Uint8Array} buf
 * @param {{ pos: number }} cur
 * @returns {number}
 */
export function readProtoVarint(buf, cur) {
  let result = 0;
  let multiplier = 1;
  for (let i = 0; i < 10; i++) {
    if (cur.pos >= buf.length) throw new RangeError('Varint truncado');
    const byte = buf[cur.pos++];
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return result;
    multiplier *= 128;
  }
  throw new RangeError('Varint demasiado largo');
}

/**
 * @param {Uint8Array} buf
 * @param {{ pos: number }} cur
 * @param {number} length
 */
function take(buf, cur, length) {
  if (length < 0 || cur.pos + length > buf.length) throw new RangeError('Campo truncado');
  const out = buf.subarray(cur.pos, cur.pos + length);
  cur.pos += length;
  return out;
}

/**
 * Decodifica todos los campos de primer nivel de un mensaje.
 * @param {Uint8Array} buf
 * @returns {ProtoField[]}
 */
export function decodeMessage(buf) {
  const cur = { pos: 0 };
  /** @type {ProtoField[]} */
  const fields = [];
  while (cur.pos < buf.length) {
    const key = readProtoVarint(buf, cur);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field < 1) throw new RangeError('Número de campo inválido');
    switch (wire) {
      case WireType.VARINT:
        fields.push({ field, wire, int: readProtoVarint(buf, cur), bytes: EMPTY });
        break;
      case WireType.I64:
        fields.push({ field, wire, int: 0, bytes: take(buf, cur, 8) });
        break;
      case WireType.LEN:
        fields.push({ field, wire, int: 0, bytes: take(buf, cur, readProtoVarint(buf, cur)) });
        break;
      case WireType.I32:
        fields.push({ field, wire, int: 0, bytes: take(buf, cur, 4) });
        break;
      default:
        throw new RangeError(`Tipo de cable no soportado: ${wire}`);
    }
  }
  return fields;
}

/**
 * Primer campo con ese número y tipo de cable, o undefined.
 * @param {ProtoField[]} fields
 * @param {number} field
 * @param {number} wire
 */
export function findField(fields, field, wire) {
  return fields.find((f) => f.field === field && f.wire === wire);
}
