// @ts-check
/**
 * Extracción del dominio a partir de la base msgstore descifrada: índice de
 * JID, resolución LID→número, hilos de conversación por chat, quién inició
 * cada conversación y agregados de mensajes y llamadas.
 * @module whatsapp/extract
 */

import { RowidSet } from '../util/rowid-set.js';
import { classifyServer, JidKind, splitJid, userToPhone } from './jid.js';

/**
 * @typedef {object} JidInfo
 * @property {number} rowId
 * @property {string} raw
 * @property {string} user
 * @property {string} server
 * @property {import('./jid.js').JidKindValue} kind
 * @property {string} phone cadena vacía si no es un número
 */

/**
 * @typedef {object} Thread
 * @property {number} chatRowId
 * @property {import('./jid.js').JidKindValue} kind
 * @property {string} phone            número resuelto, '' si se desconoce
 * @property {string} jidRaw           identidad resuelta (JID de número si se resolvió)
 * @property {string} lidName          nombre mostrado para contactos solo-LID
 * @property {string} subject          asunto del grupo ('' en chat privado)
 * @property {number} groupMembers
 * @property {number} messageCount
 * @property {number} sentByMe
 * @property {number} firstTs
 * @property {number} lastTs
 * @property {number|null} initiatedByMe 1, 0 o null si no hay mensaje conversacional
 * @property {number} callCount
 * @property {number} callsByMe
 */

/**
 * @typedef {object} ExtractStats
 * @property {number} jidCount
 * @property {number} chatCount
 * @property {number} messageCount
 * @property {number} systemMessageCount
 * @property {number} callCount
 */

export class WhatsappExtractor {
  /**
   * @param {import('../sqlite/database.js').SqliteDatabase} db msgstore
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {(phase: string, done: number, total: number) => void} [onProgress]
   * @returns {{ threads: Thread[], stats: ExtractStats }}
   */
  extract(onProgress) {
    const report = onProgress ?? (() => {});
    const jidIndex = this.#readJidIndex();
    const jidMap = this.#readJidMap();
    const lidNames = this.#readLidNames();
    const groupMembers = this.#readGroupMemberCounts();
    const chats = this.#readChats();
    const systemMsgs = this.#readSystemMessages();
    const { perChat, messageCount } = this.#scanMessages(systemMsgs, report);
    const callsByJid = this.#readCalls();

    const threads = this.#buildThreads({
      jidIndex,
      jidMap,
      lidNames,
      groupMembers,
      chats,
      perChat,
      callsByJid,
    });

    return {
      threads,
      stats: {
        jidCount: jidIndex.size,
        chatCount: chats.size,
        messageCount,
        systemMessageCount: systemMsgs.count,
        callCount: countCalls(callsByJid),
      },
    };
  }

  /** @returns {Map<number, JidInfo>} */
  #readJidIndex() {
    const table = this.db.table('jid');
    /** @type {Map<number, JidInfo>} */
    const index = new Map();
    if (!table) return index;
    const proj = table.project(['_id', 'user', 'server', 'raw_string']);
    table.scan(proj, (row) => {
      const rowId = row.num(0);
      if (!(rowId > 0)) return;
      let user = row.text(1) ?? '';
      let server = row.text(2) ?? '';
      const raw = row.text(3) ?? (user && server ? `${user}@${server}` : user);
      if (!server && raw) {
        const parts = splitJid(raw);
        user = parts.user;
        server = parts.server;
      }
      const kind = classifyServer(server, user);
      index.set(rowId, { rowId, raw, user, server, kind, phone: userToPhone(user, kind) });
    });
    return index;
  }

  /**
   * lid_row_id (alias de rowid) → jid_row_id (fila del JID de número).
   * @returns {Map<number, number>}
   */
  #readJidMap() {
    const table = this.db.table('jid_map');
    /** @type {Map<number, number>} */
    const map = new Map();
    if (!table) return map;
    const proj = table.project(['lid_row_id', 'jid_row_id']);
    table.scan(proj, (row) => {
      const lid = row.num(0);
      const jid = row.num(1);
      if (lid > 0 && jid > 0) map.set(lid, jid);
    });
    return map;
  }

  /** @returns {Map<number, string>} lid_row_id → nombre mostrado */
  #readLidNames() {
    const table = this.db.table('lid_display_name');
    /** @type {Map<number, string>} */
    const map = new Map();
    if (!table) return map;
    const proj = table.project(['lid_row_id', 'display_name']);
    table.scan(proj, (row) => {
      const lid = row.num(0);
      const name = row.text(1);
      if (lid > 0 && name) map.set(lid, name);
    });
    return map;
  }

  /** @returns {Map<number, number>} group_jid_row_id → nº de participantes */
  #readGroupMemberCounts() {
    const table = this.db.table('group_participant_user');
    /** @type {Map<number, number>} */
    const counts = new Map();
    if (!table) return counts;
    const proj = table.project(['group_jid_row_id']);
    table.scan(proj, (row) => {
      const g = row.num(0);
      if (g > 0) counts.set(g, (counts.get(g) ?? 0) + 1);
    });
    return counts;
  }

  /** @returns {Map<number, { jidRowId: number, subject: string }>} */
  #readChats() {
    const table = this.db.table('chat');
    /** @type {Map<number, { jidRowId: number, subject: string }>} */
    const chats = new Map();
    if (!table) return chats;
    const proj = table.project(['_id', 'jid_row_id', 'subject']);
    table.scan(proj, (row) => {
      const id = row.num(0);
      const jidRowId = row.num(1);
      if (id > 0 && jidRowId > 0) chats.set(id, { jidRowId, subject: row.text(2) ?? '' });
    });
    return chats;
  }

  /** @returns {RowidSet} _id de los mensajes de sistema/notificación */
  #readSystemMessages() {
    const set = new RowidSet();
    const table = this.db.table('message_system');
    if (table) {
      const proj = table.project(['message_row_id']);
      table.scan(proj, (row) => set.add(row.num(0)));
    }
    return set;
  }

  /**
   * Recorre `message` una sola vez y agrega por chat. Un mensaje cuenta como
   * conversacional si no es un mensaje de sistema.
   * @param {RowidSet} systemMsgs
   * @param {(phase: string, done: number, total: number) => void} report
   */
  #scanMessages(systemMsgs, report) {
    const table = this.db.table('message');
    /** @type {Map<number, ChatAgg>} */
    const perChat = new Map();
    let messageCount = 0;
    if (!table) return { perChat, messageCount };
    const proj = table.project(['_id', 'chat_row_id', 'from_me', 'timestamp']);
    const total = this.db.pageCount;
    let leaves = 0;
    table.scan(
      proj,
      (row) => {
        const id = row.num(0);
        if (systemMsgs.has(id)) return;
        const chatId = row.num(1);
        if (!(chatId > 0)) return;
        const fromMe = row.num(2) === 1 ? 1 : 0;
        const ts = row.num(3) || 0;
        messageCount++;
        let agg = perChat.get(chatId);
        if (agg === undefined) {
          agg = new ChatAgg();
          perChat.set(chatId, agg);
        }
        agg.add(id, ts, fromMe);
      },
      () => report('messages', Math.min(++leaves, total), total),
    );
    return { perChat, messageCount };
  }

  /** @returns {Map<number, { count: number, byMe: number }>} jid_row_id → llamadas */
  #readCalls() {
    const table = this.db.table('call_log');
    /** @type {Map<number, { count: number, byMe: number }>} */
    const calls = new Map();
    if (!table) return calls;
    const proj = table.project(['jid_row_id', 'from_me']);
    table.scan(proj, (row) => {
      const jid = row.num(0);
      if (!(jid > 0)) return;
      let agg = calls.get(jid);
      if (!agg) {
        agg = { count: 0, byMe: 0 };
        calls.set(jid, agg);
      }
      agg.count++;
      if (row.num(1) === 1) agg.byMe++;
    });
    return calls;
  }

  /**
   * @param {object} src
   * @param {Map<number, JidInfo>} src.jidIndex
   * @param {Map<number, number>} src.jidMap
   * @param {Map<number, string>} src.lidNames
   * @param {Map<number, number>} src.groupMembers
   * @param {Map<number, { jidRowId: number, subject: string }>} src.chats
   * @param {Map<number, ChatAgg>} src.perChat
   * @param {Map<number, { count: number, byMe: number }>} src.callsByJid
   * @returns {Thread[]}
   */
  #buildThreads({ jidIndex, jidMap, lidNames, groupMembers, chats, perChat, callsByJid }) {
    /** @type {Thread[]} */
    const threads = [];
    /** jid_row_id (chat y número resuelto) ya cubiertos, para las llamadas sueltas. */
    const seenJidRows = new Set();

    for (const [chatRowId, chat] of chats) {
      const chatJidRowId = chat.jidRowId;
      const pnRowId = jidMap.get(chatJidRowId);
      const chatJid = jidIndex.get(chatJidRowId);
      const resolved = pnRowId !== undefined ? jidIndex.get(pnRowId) : chatJid;
      const kind = resolved?.kind ?? chatJid?.kind ?? JidKind.OTHER;

      const agg = perChat.get(chatRowId) ?? ChatAgg.empty;
      const callChat = callsByJid.get(chatJidRowId);
      const callPn = pnRowId !== undefined ? callsByJid.get(pnRowId) : undefined;
      const callCount = (callChat?.count ?? 0) + (callPn?.count ?? 0);
      const callsByMe = (callChat?.byMe ?? 0) + (callPn?.byMe ?? 0);

      seenJidRows.add(chatJidRowId);
      if (pnRowId !== undefined) seenJidRows.add(pnRowId);

      threads.push({
        chatRowId,
        kind,
        phone: resolved?.phone ?? '',
        jidRaw: resolved?.raw ?? chatJid?.raw ?? '',
        lidName: lidNames.get(chatJidRowId) ?? '',
        subject: chat.subject,
        groupMembers: groupMembers.get(chatJidRowId) ?? 0,
        messageCount: agg.count,
        sentByMe: agg.sentByMe,
        firstTs: agg.firstTs === Infinity ? 0 : agg.firstTs,
        lastTs: agg.lastTs,
        initiatedByMe: agg.count === 0 ? null : agg.firstFromMe,
        callCount,
        callsByMe,
      });
    }

    // Contactos que solo aparecen en el registro de llamadas (sin chat).
    for (const [jidRowId, call] of callsByJid) {
      if (seenJidRows.has(jidRowId)) continue;
      const pnRowId = jidMap.get(jidRowId);
      const info = pnRowId !== undefined ? jidIndex.get(pnRowId) : jidIndex.get(jidRowId);
      if (!info) continue;
      threads.push({
        chatRowId: -jidRowId,
        kind: info.kind,
        phone: info.phone,
        jidRaw: info.raw,
        lidName: lidNames.get(jidRowId) ?? '',
        subject: '',
        groupMembers: 0,
        messageCount: 0,
        sentByMe: 0,
        firstTs: 0,
        lastTs: 0,
        initiatedByMe: null,
        callCount: call.count,
        callsByMe: call.byMe,
      });
    }
    return threads;
  }
}

/**
 * @param {Map<number, { count: number, byMe: number }>} callsByJid
 * @returns {number}
 */
function countCalls(callsByJid) {
  let n = 0;
  for (const c of callsByJid.values()) n += c.count;
  return n;
}

/** Acumulador mutable por chat; evita asignaciones en el bucle de mensajes. */
class ChatAgg {
  constructor() {
    this.count = 0;
    this.sentByMe = 0;
    this.firstTs = Infinity;
    this.firstId = Infinity;
    this.firstFromMe = 0;
    this.lastTs = 0;
  }

  /**
   * @param {number} id
   * @param {number} ts
   * @param {number} fromMe
   */
  add(id, ts, fromMe) {
    this.count++;
    this.sentByMe += fromMe;
    if (ts < this.firstTs || (ts === this.firstTs && id < this.firstId)) {
      this.firstTs = ts;
      this.firstId = id;
      this.firstFromMe = fromMe;
    }
    if (ts > this.lastTs) this.lastTs = ts;
  }
}

/** Agregado vacío reutilizable para chats sin mensajes. */
ChatAgg.empty = new ChatAgg();
