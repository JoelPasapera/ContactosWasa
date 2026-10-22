// Generador de fixtures SOLO para pruebas: crea bases msgstore/wa sintéticas
// con el esquema real de WhatsApp 2.26 (usando node:sqlite) y las cifra a
// .crypt15, además de calcular por construcción los valores esperados.
// No contiene datos de ninguna persona real. No forma parte de la aplicación.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { encryptCrypt15 } from './crypt15-encrypt.mjs';

// DDL real de WhatsApp 2.26 para las tablas que usa la aplicación.
const DDL_MSG = {
  jid: 'CREATE TABLE jid (_id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, server TEXT NOT NULL, agent INTEGER, type INTEGER, raw_string TEXT, device INTEGER)',
  chat: 'CREATE TABLE chat (_id INTEGER PRIMARY KEY AUTOINCREMENT, jid_row_id INTEGER UNIQUE, hidden INTEGER, subject TEXT, created_timestamp INTEGER, display_message_row_id INTEGER, sort_timestamp INTEGER)',
  message:
    'CREATE TABLE message (_id INTEGER PRIMARY KEY AUTOINCREMENT, chat_row_id INTEGER NOT NULL, from_me INTEGER NOT NULL, key_id TEXT NOT NULL, sender_jid_row_id INTEGER, status INTEGER, timestamp INTEGER, message_type INTEGER, text_data TEXT, sort_id INTEGER NOT NULL DEFAULT 0)',
  call_log:
    'CREATE TABLE call_log (_id INTEGER PRIMARY KEY AUTOINCREMENT, jid_row_id INTEGER, from_me INTEGER, call_id TEXT, timestamp INTEGER, video_call INTEGER, duration INTEGER, call_result INTEGER, group_jid_row_id INTEGER NOT NULL DEFAULT 0)',
  jid_map: 'CREATE TABLE jid_map (lid_row_id INTEGER PRIMARY KEY NOT NULL, jid_row_id INTEGER NOT NULL, sort_id INTEGER)',
  lid_display_name: 'CREATE TABLE lid_display_name (lid_row_id INTEGER PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, username TEXT)',
  group_participant_user:
    'CREATE TABLE group_participant_user (_id INTEGER PRIMARY KEY AUTOINCREMENT, group_jid_row_id INTEGER NOT NULL, user_jid_row_id INTEGER NOT NULL, rank INTEGER)',
  message_system: 'CREATE TABLE message_system (message_row_id INTEGER PRIMARY KEY, action_type INTEGER NOT NULL)',
  message_system_group: 'CREATE TABLE message_system_group (message_row_id INTEGER PRIMARY KEY, is_me_joined INTEGER)',
};
const DDL_WA = {
  wa_contacts:
    'CREATE TABLE wa_contacts(_id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT NOT NULL, is_whatsapp_user BOOLEAN NOT NULL, number TEXT, display_name TEXT, given_name TEXT, family_name TEXT, wa_name TEXT, sort_name TEXT, nickname TEXT)',
};

/** PRNG determinista (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string} dir
 * @param {number} scale número de contactos de chat privado
 */
export function generate(dir, scale = 1200) {
  mkdirSync(dir, { recursive: true });
  const rand = rng(1234);
  const ri = (n) => Math.floor(rand() * n);

  const msg = new DatabaseSync(`${dir}/syn-msgstore.db`);
  msg.exec('PRAGMA page_size=4096; PRAGMA auto_vacuum=1;');
  for (const sql of Object.values(DDL_MSG)) msg.exec(sql);

  const insJid = msg.prepare('INSERT INTO jid(_id,user,server,agent,type,raw_string,device) VALUES(?,?,?,?,?,?,0)');
  const insChat = msg.prepare('INSERT INTO chat(_id,jid_row_id,hidden,subject,created_timestamp) VALUES(?,?,0,?,?)');
  const insMsg = msg.prepare(
    'INSERT INTO message(_id,chat_row_id,from_me,key_id,sender_jid_row_id,status,timestamp,message_type,text_data) VALUES(?,?,?,?,?,?,?,?,?)',
  );
  const insCall = msg.prepare('INSERT INTO call_log(_id,jid_row_id,from_me,call_id,timestamp,video_call,duration,call_result) VALUES(?,?,?,?,?,?,?,?)');
  const insMap = msg.prepare('INSERT INTO jid_map(lid_row_id,jid_row_id,sort_id) VALUES(?,?,?)');
  const insLid = msg.prepare('INSERT INTO lid_display_name(lid_row_id,display_name,username) VALUES(?,?,?)');
  const insGpu = msg.prepare('INSERT INTO group_participant_user(group_jid_row_id,user_jid_row_id) VALUES(?,?)');
  const insSys = msg.prepare('INSERT INTO message_system(message_row_id,action_type) VALUES(?,?)');
  const insSysG = msg.prepare('INSERT INTO message_system_group(message_row_id,is_me_joined) VALUES(?,1)');

  insJid.run(1, '51999000000', 's.whatsapp.net', 0, 0, '51999000000@s.whatsapp.net');
  let nextJid = 2;
  let nextChat = 1;
  let nextMsg = 1;
  let nextCall = 1;
  const contacts = []; // { chatJid, phone }
  let initMePm = 0;
  let initThemPm = 0;
  let pmMsgs = 0;

  for (let i = 0; i < scale; i++) {
    const phone = `519${String(80000000 + i).padStart(8, '0')}`;
    const lidBased = i % 4 === 0;
    let chatJid;
    if (lidBased) {
      const lidUser = String(100000000000000 + i);
      insJid.run(nextJid, lidUser, 'lid', 0, 0, `${lidUser}@lid`);
      const lidRow = nextJid++;
      insJid.run(nextJid, phone, 's.whatsapp.net', 0, 0, `${phone}@s.whatsapp.net`);
      const pnRow = nextJid++;
      insMap.run(lidRow, pnRow, i);
      insLid.run(lidRow, `Contacto ${i}`, `user${i}`);
      chatJid = lidRow;
    } else {
      insJid.run(nextJid, phone, 's.whatsapp.net', 0, 0, `${phone}@s.whatsapp.net`);
      chatJid = nextJid++;
    }
    contacts.push({ chatJid, phone });
    insChat.run(nextChat, chatJid, null, 1700000000000 + i * 100000);
    const chatId = nextChat++;
    const startedByMe = i % 3 !== 0;
    const n = 1 + ri(6);
    const baseTs = 1700000000000 + i * 100000;
    for (let k = 0; k < n; k++) {
      const frm = startedByMe === (k % 2 === 0) ? 1 : 0;
      insMsg.run(nextMsg++, chatId, frm, `KEY${i}_${k}`, frm ? null : chatJid, 13, baseTs + k * 1000, 0, `msg ${k} chat ${i}`);
      pmMsgs++;
    }
    if (startedByMe) initMePm++;
    else initThemPm++;
  }

  const nGroups = Math.max(2, Math.floor(scale / 10));
  let initMeAll = initMePm;
  let initThemAll = initThemPm;
  for (let g = 0; g < nGroups; g++) {
    const gid = `1203630${String(g).padStart(10, '0')}`;
    insJid.run(nextJid, gid, 'g.us', 0, 1, `${gid}@g.us`);
    const grow = nextJid++;
    insChat.run(nextChat, grow, `Grupo ${g}`, 1700500000000 + g);
    const gchat = nextChat++;
    const members = [contacts[ri(contacts.length)], contacts[ri(contacts.length)]];
    for (const m of members) insGpu.run(grow, m.chatJid);
    const startedByMe = g % 2 === 0;
    const baseTs = 1700500000000 + g * 100000;
    const n = 1 + ri(5);
    for (let k = 0; k < n; k++) {
      const frm = k === 0 ? (startedByMe ? 1 : 0) : ri(2);
      insMsg.run(nextMsg++, gchat, frm, `G${g}_${k}`, frm ? null : members[0].chatJid, 13, baseTs + k * 1000, 0, `g${g} msg${k}`);
    }
    insMsg.run(nextMsg, gchat, 0, `SYS${g}`, null, 6, baseTs - 1000, 7, null);
    insSys.run(nextMsg, 4);
    insSysG.run(nextMsg);
    nextMsg++;
    if (startedByMe) initMeAll++;
    else initThemAll++;
  }

  for (let i = 0; i < Math.max(1, Math.floor(scale / 2)); i++) {
    const c = contacts[i];
    insCall.run(nextCall, c.chatJid, ri(2), `CALL${nextCall}`, 1700900000000 + nextCall * 1000, ri(2), ri(600), 5);
    nextCall++;
  }
  msg.close();

  const wa = new DatabaseSync(`${dir}/syn-wa.db`);
  wa.exec('PRAGMA page_size=4096;');
  for (const sql of Object.values(DDL_WA)) wa.exec(sql);
  const insWa = wa.prepare('INSERT INTO wa_contacts(jid,is_whatsapp_user,number,display_name,given_name,family_name,wa_name,sort_name) VALUES(?,?,?,?,?,?,?,?)');
  let waPhones = 0;
  for (let i = 0; i < scale; i++) {
    if (i % 5 === 2) continue;
    const phone = `519${String(80000000 + i).padStart(8, '0')}`;
    insWa.run(`${phone}@s.whatsapp.net`, 1, `+${phone}`, `Nombre${i} Apellido${i}`, `Nombre${i}`, `Apellido${i}`, i % 3 === 0 ? `WA${i}` : null, `Nombre${i} Apellido${i}`);
    waPhones++;
  }
  wa.close();

  return {
    scale,
    expected: {
      pmContacts: scale,
      groups: nGroups,
      unionContacts: scale, // toda persona con chat; wa.db es subconjunto
      waPhones,
      initMePm,
      initThemPm,
      initMeAll,
      initThemAll,
      pmMsgs,
      totalWithGroups: scale + nGroups,
    },
  };
}

/**
 * Genera y cifra los fixtures y escribe expected.json.
 * @param {string} dir
 * @param {Uint8Array} rootKey
 * @param {number} [scale]
 */
export async function generateEncrypted(dir, rootKey, scale = 1200) {
  const { expected } = generate(dir, scale);
  const msgPlain = new Uint8Array(readFileSync(`${dir}/syn-msgstore.db`));
  const waPlain = new Uint8Array(readFileSync(`${dir}/syn-wa.db`));
  writeFileSync(`${dir}/syn-msgstore.db.crypt15`, await encryptCrypt15(msgPlain, rootKey, { msgstore: true }));
  writeFileSync(`${dir}/syn-wa.db.crypt15`, await encryptCrypt15(waPlain, rootKey, { msgstore: false }));
  writeFileSync(`${dir}/expected.json`, JSON.stringify(expected, null, 2));
  return expected;
}
