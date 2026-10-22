// Cifrador .crypt15 SOLO para pruebas: produce copias cifradas de juguete con
// la misma estructura que WhatsApp, para alimentar al descifrador real.
// No forma parte de la aplicación.
import { deflateSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { Md5 } from '../../js/crypto/md5.js';

function varint(n) {
  const out = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Uint8Array.from(out);
}
const tag = (field, wt) => varint((field << 3) | wt);
function len(field, payload) {
  return concat(tag(field, 2), varint(payload.length), payload);
}
function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/**
 * Deriva la clave igual que la app (HKDF-SHA256) y cifra con AES-256-GCM.
 * @param {Uint8Array} plain
 * @param {Uint8Array} rootKey 32 bytes
 * @param {{ msgstore?: boolean, appVersion?: string }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function encryptCrypt15(plain, rootKey, opts = {}) {
  const compressed = new Uint8Array(deflateSync(plain, { level: 9 }));
  const hkdf = await webcrypto.subtle.importKey('raw', rootKey, 'HKDF', false, ['deriveBits']);
  const rawKey = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('backup encryption') },
    hkdf,
    256,
  );
  const key = await webcrypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = Uint8Array.from({ length: 16 }, (_, i) => i);
  const ctTag = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, compressed));

  const e2ee = len(1, iv);
  const appVersion = new TextEncoder().encode(opts.appVersion ?? '2.26.34.7');
  let meta = concat(tag(1, 2), varint(appVersion.length), appVersion);
  const jidSuffix = new TextEncoder().encode('00');
  meta = concat(meta, tag(3, 2), varint(jidSuffix.length), jidSuffix, tag(4, 0), varint(1));
  if (opts.msgstore !== false) {
    const flags = [...Array(33).keys()].map((i) => i + 5).concat(39);
    for (const f of flags) meta = concat(meta, tag(f, 0), varint(1));
  }
  const header = concat(tag(1, 0), varint(1), len(3, e2ee), len(4, meta), tag(6, 0), varint(3));
  const body = concat(varint(header.length), header, ctTag);
  const md5 = new Md5();
  md5.update(body);
  return concat(body, md5.digest());
}
