// Suite autocontenida: no requiere Python ni archivos externos. Genera copias
// .crypt15 sintéticas con el esquema real de WhatsApp 2.26, corre toda la
// tubería y valida el resultado (incluido el lector SQLite propio contra el
// node:sqlite incorporado) y los exportadores.
//
//   node tests/node/run.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { generateEncrypted } from '../fixtures/generate.mjs';
import { unzip } from '../fixtures/unzip.mjs';
import { runPipeline } from '../../js/backup/pipeline.js';
import { SqliteDatabase } from '../../js/sqlite/database.js';
import { MemoryStore } from '../../js/storage/memory-store.js';
import { WhatsappExtractor } from '../../js/whatsapp/extract.js';
import { ContactType } from '../../js/contacts/merge.js';
import { bytesToHex } from '../../js/util/bytes.js';
import { buildXlsx } from '../../js/export/xlsx.js';
import { toCsvBlob } from '../../js/export/csv.js';
import { toVcardBlob } from '../../js/export/vcard-export.js';
import { createZip } from '../../js/export/zip.js';
import { COLUMNS, contactsToRows, contactsToVcards, headerLabels } from '../../js/export/report.js';

let passed = 0;
function ok(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

const dir = mkdtempSync(join(tmpdir(), 'padron-test-'));
const rootKey = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
const scale = Number(process.env.SCALE || 1200);

console.log(`Generando fixtures cifrados (escala ${scale}) en ${dir}…`);
const expected = await generateEncrypted(dir, rootKey, scale);
const bytes = (p) => new Uint8Array(readFileSync(p));
const blobOf = (p) => new Blob([bytes(p)]);

// --- 1) Lector SQLite propio contra node:sqlite (oráculo incorporado) ---
console.log('Lector SQLite desde cero vs node:sqlite:');
{
  const store = new MemoryStore();
  store.append(bytes(`${dir}/syn-msgstore.db`));
  const mine = new SqliteDatabase(store);
  const oracle = new DatabaseSync(`${dir}/syn-msgstore.db`);
  for (const table of ['jid', 'message', 'chat', 'call_log', 'jid_map']) {
    let n = 0;
    const t = mine.table(table);
    t.scan(t.project(['_id', 'lid_row_id']), () => n++);
    const truth = oracle.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
    assert.equal(n, truth, `conteo de ${table}`);
  }
  // Suma de timestamps (enteros de 8 bytes) idéntica.
  let tsSum = 0n;
  const m = mine.table('message');
  m.scan(m.project(['timestamp']), (r) => (tsSum += BigInt(r.num(0))));
  const truthTs = BigInt(oracle.prepare('SELECT COALESCE(SUM(timestamp),0) s FROM message').get().s);
  assert.equal(tsSum, truthTs, 'suma de timestamps');
  oracle.close();
  ok('conteos y agregados coinciden con node:sqlite');
}

// --- 2) Extracción directa sobre la base en claro ---
console.log('Extracción e iniciador de conversación:');
{
  const store = new MemoryStore();
  store.append(bytes(`${dir}/syn-msgstore.db`));
  const { threads, stats } = new WhatsappExtractor(new SqliteDatabase(store)).extract();
  const pm = threads.filter((t) => t.kind === 'user' && t.messageCount > 0);
  assert.equal(pm.filter((t) => t.initiatedByMe === 1).length, expected.initMePm, 'iniciadas por mí (chats privados)');
  assert.equal(pm.filter((t) => t.initiatedByMe === 0).length, expected.initThemPm, 'iniciadas por el contacto');
  assert.equal(threads.filter((t) => t.kind === 'group').length, expected.groups, 'grupos');
  assert.ok(stats.messageCount === expected.pmMsgs + stats.systemMessageCount * 0 + groupMsgs(threads), 'mensajes contados');
  ok(`iniciador correcto (${expected.initMePm} yo / ${expected.initThemPm} ellos en privados)`);
}
function groupMsgs(threads) {
  return threads.filter((t) => t.kind === 'group').reduce((n, t) => n + t.messageCount, 0);
}

// --- 3) Tubería completa desde los .crypt15 CIFRADOS + clave ---
console.log('Tubería completa (descifrar → leer → extraer → fusionar):');
const { contacts, sources } = await runPipeline({
  backups: [
    { blob: blobOf(`${dir}/syn-msgstore.db.crypt15`), name: 'msgstore.db.crypt15' },
    { blob: blobOf(`${dir}/syn-wa.db.crypt15`), name: 'wa.db.crypt15' },
  ],
  rootKey,
  includeGroups: true,
});
const persons = contacts.filter((c) => c.type === ContactType.CONTACT);
assert.equal(persons.length, expected.unionContacts, 'personas = unión chat ∪ agenda');
assert.equal(persons.filter((c) => c.initiatedByMe === 1).length, expected.initMePm, 'padrón: iniciadas por mí');
assert.equal(persons.filter((c) => c.inAddressBook).length, expected.waPhones, 'en agenda');
assert.equal(persons.filter((c) => c.nameSource === 'agenda').length, expected.waPhones, 'nombres desde la agenda');
assert.ok(sources.hasMsgstore && sources.hasAddressBook, 'roles detectados');
for (const c of persons) assert.equal(c.received, c.messageCount - c.sentByMe, 'recibidos = total - enviados');
ok(`${persons.length} personas, ${expected.groups} grupos, descifrado y fusión correctos`);

// --- 4) Clave equivocada ---
{
  const bad = rootKey.slice();
  bad[0] ^= 0xff;
  let code = '';
  try {
    await runPipeline({ backups: [{ blob: blobOf(`${dir}/syn-msgstore.db.crypt15`), name: 'm.crypt15' }], rootKey: bad });
  } catch (e) {
    code = e.code;
  }
  assert.equal(code, 'KEY_WRONG', 'clave equivocada detectada');
  ok('clave equivocada → KEY_WRONG');
}

// --- 5) Exportadores (XLSX/CSV/VCF/ZIP) validados releyéndolos ---
console.log('Exportadores:');
{
  const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const rows = contactsToRows(sorted);

  const xlsxBuf = new Uint8Array(await (await buildXlsx({ sheetName: 'Contactos', columns: COLUMNS, rows })).arrayBuffer());
  const xParts = unzip(xlsxBuf);
  assert.ok(xParts.has('xl/worksheets/sheet1.xml'), 'xlsx tiene la hoja');
  const sheet = new TextDecoder().decode(xParts.get('xl/worksheets/sheet1.xml'));
  const rowCount = (sheet.match(/<row /g) || []).length;
  assert.equal(rowCount, rows.length + 1, 'xlsx: filas + cabecera');
  assert.ok(sheet.includes('autoFilter') && new TextDecoder().decode(xParts.get('[Content_Types].xml')).includes('sheet.main'), 'xlsx bien formado');
  ok(`xlsx: ${rowCount} filas (releído con un unzip propio)`);

  const csvBytes = new Uint8Array(await toCsvBlob(headerLabels(), rows).arrayBuffer());
  assert.ok(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, 'csv con BOM UTF-8');
  const csv = new TextDecoder().decode(csvBytes); // TextDecoder descarta el BOM al decodificar
  assert.equal(csv.trim().split(/\r\n/).length, rows.length + 1, 'csv: líneas correctas');
  ok('csv: BOM y conteo de líneas correctos');

  const vcf = await (await Promise.resolve(toVcardBlob(contactsToVcards(sorted)))).text();
  const cards = (vcf.match(/BEGIN:VCARD/g) || []).length;
  assert.equal(cards, (vcf.match(/END:VCARD/g) || []).length, 'vcf: BEGIN/END equilibrados');
  assert.equal(cards, contactsToVcards(sorted).length, 'vcf: una tarjeta por contacto con número');
  ok(`vcf: ${cards} tarjetas`);

  const zipBuf = new Uint8Array(
    await (await createZip([{ name: 'a.csv', data: new TextEncoder().encode(csv) }, { name: 'b.txt', data: new TextEncoder().encode('hola') }])).arrayBuffer(),
  );
  const zParts = unzip(zipBuf);
  assert.ok(zParts.has('a.csv') && zParts.has('b.txt'), 'zip: entradas presentes');
  assert.equal(new TextDecoder().decode(zParts.get('b.txt')), 'hola', 'zip: contenido intacto');
  ok('zip: entradas y contenido correctos');
}

console.log(`\nclave de prueba usada: ${bytesToHex(rootKey)}`);
console.log(`\n✅ ${passed} comprobaciones pasaron.`);
