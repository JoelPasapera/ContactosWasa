// Construye los archivos de EJEMPLO de la demostración guiada y los embebe en
// js/demo/demo-data.js. Herramienta de desarrollo (no se ejecuta en la app).
//
//   node tools/build-demo.mjs
//
// Los datos son ficticios: nombres inventados con el sufijo "(ejemplo)" y
// números del rango +1 202 555 0100–0199, reservado para ficción, de modo que
// ningún número pertenece a una persona real.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DDL_MSG, DDL_WA } from '../tests/fixtures/generate.mjs';
import { encryptCrypt15 } from '../tests/fixtures/crypt15-encrypt.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 29 + 7) & 0xff);

const DAY = 86400000;
const T0 = Date.UTC(2023, 2, 6, 15, 0, 0); // marzo 2023

/** @param {number} n 0..99 → número ficticio +1 202 555 01nn */
const phoneOf = (n) => `120255501${String(n).padStart(2, '0')}`;

/**
 * Guion de la demostración. starter: 'yo' | 'ellos' | null (sin chat).
 * agenda: si aparece con nombre en wa.db. sysFirst: el chat empieza con un
 * aviso de sistema (que no cuenta para decidir quién inició).
 */
const PEOPLE = [
  ['Ana', 'yo', true, 18, 2],
  ['Bruno', 'ellos', true, 9, 1],
  ['Camila', 'yo', true, 34, 4],
  ['Diego', 'yo', true, 6, 0],
  ['Elena', 'ellos', true, 22, 3],
  ['Fabián', 'yo', true, 3, 0],
  ['Gabriela', 'ellos', true, 41, 5],
  ['Héctor', 'yo', true, 12, 1],
  ['Isabel', 'yo', true, 27, 0],
  ['Jorge', 'ellos', true, 5, 0],
  ['Karen', 'yo', true, 15, 2],
  ['Luis', 'ellos', true, 8, 1],
  ['Mariana', 'yo', true, 30, 3],
  ['Nicolás', 'ellos', true, 2, 0],
  ['Olga', 'yo', true, 11, 0],
  ['Pablo', 'yo', true, 19, 2],
  ['Rocío', 'ellos', true, 7, 0],
  ['Sergio', 'yo', true, 4, 1],
  ['Tatiana', 'ellos', true, 16, 0],
  ['Víctor', 'yo', true, 9, 0],
  ['Ximena', 'ellos', false, 6, 0], // con chat pero sin nombre en la agenda
  ['Yolanda', 'yo', false, 3, 0], // con chat pero sin nombre en la agenda
  ['Zoe', null, true, 0, 0], // en la agenda, nunca escribieron
  ['Adrián', null, true, 0, 0],
  ['Beatriz', null, true, 0, 0],
  ['César', null, true, 0, 0],
].map(([name, starter, agenda, messages, calls], i) => ({
  name: `${name} (ejemplo)`,
  starter: /** @type {'yo'|'ellos'|null} */ (starter),
  agenda: /** @type {boolean} */ (agenda),
  messages: /** @type {number} */ (messages),
  calls: /** @type {number} */ (calls),
  phone: phoneOf(i),
  sysFirst: i % 4 === 1,
}));

function build(dir) {
  const msg = new DatabaseSync(`${dir}/msgstore.db`);
  msg.exec('PRAGMA page_size=4096;');
  for (const sql of Object.values(DDL_MSG)) msg.exec(sql);
  const insJid = msg.prepare('INSERT INTO jid(_id,user,server,agent,type,raw_string,device) VALUES(?,?,?,0,?,?,0)');
  const insChat = msg.prepare('INSERT INTO chat(_id,jid_row_id,hidden,subject,created_timestamp) VALUES(?,?,0,?,?)');
  const insMsg = msg.prepare(
    'INSERT INTO message(_id,chat_row_id,from_me,key_id,sender_jid_row_id,status,timestamp,message_type,text_data) VALUES(?,?,?,?,?,?,?,?,?)',
  );
  const insSys = msg.prepare('INSERT INTO message_system(message_row_id,action_type) VALUES(?,?)');
  const insCall = msg.prepare('INSERT INTO call_log(jid_row_id,from_me,call_id,timestamp,video_call,duration,call_result) VALUES(?,?,?,?,?,?,5)');
  const insGpu = msg.prepare('INSERT INTO group_participant_user(group_jid_row_id,user_jid_row_id) VALUES(?,?)');
  const insLid = msg.prepare('INSERT INTO lid_display_name(lid_row_id,display_name,username) VALUES(?,?,NULL)');

  let jidId = 1;
  let chatId = 1;
  let msgId = 1;
  const jidOf = new Map();

  for (const [i, p] of PEOPLE.entries()) {
    insJid.run(jidId, p.phone, 's.whatsapp.net', 0, `${p.phone}@s.whatsapp.net`);
    jidOf.set(p.name, jidId);
    const jid = jidId++;
    if (!p.starter) continue;
    const start = T0 + i * 23 * DAY;
    insChat.run(chatId, jid, null, start);
    const chat = chatId++;
    if (p.sysFirst) {
      // Aviso de cifrado anterior al primer mensaje: no debe contar como inicio.
      insMsg.run(msgId, chat, 0, `S${i}`, null, 6, start - 60000, 7, null);
      insSys.run(msgId++, 19);
    }
    const firstFromMe = p.starter === 'yo' ? 1 : 0;
    for (let k = 0; k < p.messages; k++) {
      const fromMe = k === 0 ? firstFromMe : (i + k) % 3 === 0 ? firstFromMe : 1 - firstFromMe;
      insMsg.run(msgId++, chat, fromMe, `M${i}_${k}`, fromMe ? null : jid, 13, start + k * 3 * 3600000, 0, `mensaje ${k + 1}`);
    }
    for (let c = 0; c < p.calls; c++) {
      insCall.run(jid, (i + c) % 2, `C${i}_${c}`, start + (c + 1) * 2 * DAY, c % 2, 60 + c * 45);
    }
  }

  // Contacto que WhatsApp solo conoce por identificador oculto (LID), sin número.
  insJid.run(jidId, '208830000000123', 'lid', 0, '208830000000123@lid');
  insLid.run(jidId, 'Contacto oculto (ejemplo)');
  insChat.run(chatId, jidId, null, T0 + 400 * DAY);
  insMsg.run(msgId++, chatId, 0, 'L1', jidId, 13, T0 + 400 * DAY, 0, 'hola');
  insMsg.run(msgId++, chatId, 1, 'L2', null, 13, T0 + 400 * DAY + 60000, 0, 'hola, ¿quién eres?');
  jidId++;
  chatId++;

  // Dos grupos de ejemplo.
  const groups = [
    ['Familia (ejemplo)', 1, ['Ana (ejemplo)', 'Camila (ejemplo)', 'Héctor (ejemplo)']],
    ['Trabajo (ejemplo)', 0, ['Bruno (ejemplo)', 'Elena (ejemplo)', 'Gabriela (ejemplo)', 'Luis (ejemplo)']],
  ];
  for (const [g, [subject, iStarted, members]] of groups.entries()) {
    const gid = `12036300000000${g}`;
    insJid.run(jidId, gid, 'g.us', 1, `${gid}@g.us`);
    const gj = jidId++;
    const start = T0 + (200 + g * 90) * DAY;
    insChat.run(chatId, gj, subject, start);
    const chat = chatId++;
    for (const m of members) insGpu.run(gj, jidOf.get(m));
    for (let k = 0; k < 12; k++) {
      const fromMe = k === 0 ? iStarted : k % 3 === 0 ? 1 : 0;
      const sender = fromMe ? null : jidOf.get(members[k % members.length]);
      insMsg.run(msgId++, chat, fromMe, `G${g}_${k}`, sender, 13, start + k * 7200000, 0, `mensaje de grupo ${k + 1}`);
    }
  }
  msg.close();

  const wa = new DatabaseSync(`${dir}/wa.db`);
  wa.exec('PRAGMA page_size=4096;');
  for (const sql of Object.values(DDL_WA)) wa.exec(sql);
  const insWa = wa.prepare(
    'INSERT INTO wa_contacts(jid,is_whatsapp_user,number,display_name,given_name,family_name,sort_name) VALUES(?,1,?,?,?,?,?)',
  );
  for (const p of PEOPLE) {
    if (!p.agenda) continue;
    const given = p.name.replace(' (ejemplo)', '');
    insWa.run(`${p.phone}@s.whatsapp.net`, `+${p.phone}`, p.name, given, '(ejemplo)', p.name);
  }
  wa.close();
}

/** Valores que la demostración debe mostrar (para la prueba de navegador). */
function expectedSummary() {
  const withChat = PEOPLE.filter((p) => p.starter);
  const groupsMe = 1;
  const groupsThem = 1;
  return {
    total: PEOPLE.length + 1 /* oculto */ + 2 /* grupos */,
    initiatedByMe: withChat.filter((p) => p.starter === 'yo').length + groupsMe,
    initiatedByThem: withChat.filter((p) => p.starter === 'ellos').length + 1 /* oculto */ + groupsThem,
    inBook: PEOPLE.filter((p) => p.agenda).length,
    groups: 2,
  };
}

const work = mkdtempSync(join(tmpdir(), 'padron-demo-'));
build(work);
const msgstore = await encryptCrypt15(new Uint8Array(readFileSync(`${work}/msgstore.db`)), DEMO_KEY, { msgstore: true });
const waDb = await encryptCrypt15(new Uint8Array(readFileSync(`${work}/wa.db`)), DEMO_KEY, { msgstore: false });
const hex = Buffer.from(DEMO_KEY).toString('hex');

const out = `// @ts-check
/**
 * Datos de EJEMPLO para la demostración guiada. Son ficticios: nombres
 * inventados y números del rango +1 202 555 0100–0199, reservado para ficción.
 * Archivo generado por tools/build-demo.mjs; no editar a mano.
 * @module demo/demo-data
 */

/** Clave de 64 dígitos de los archivos de ejemplo (pública a propósito). */
export const DEMO_KEY_HEX = '${hex}';

/** @type {ReadonlyArray<{ name: string, base64: string }>} */
export const DEMO_FILES = [
  { name: 'msgstore.db.crypt15', base64: '${Buffer.from(msgstore).toString('base64')}' },
  { name: 'wa.db.crypt15', base64: '${Buffer.from(waDb).toString('base64')}' },
];
`;
mkdirSync(join(ROOT, 'js/demo'), { recursive: true });
writeFileSync(join(ROOT, 'js/demo/demo-data.js'), out);
writeFileSync(join(ROOT, 'tests/fixtures/demo-expected.json'), JSON.stringify({ keyHex: hex, ...expectedSummary() }, null, 2) + '\n');
console.log(
  `demo: msgstore ${msgstore.length} B, wa ${waDb.length} B, módulo ${out.length} B; esperado`,
  JSON.stringify(expectedSummary()),
);
