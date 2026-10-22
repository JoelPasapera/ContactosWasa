// @ts-check
/**
 * Analizador mínimo de sentencias CREATE TABLE: extrae columnas en orden,
 * la columna alias de rowid (INTEGER PRIMARY KEY), columnas generadas
 * virtuales (no ocupan lugar en el registro) y valores DEFAULT literales
 * (necesarios para filas antiguas escritas antes de un ALTER TABLE ADD COLUMN).
 * @module sqlite/schema-sql
 */

/**
 * @typedef {object} ColumnDef
 * @property {string} name          nombre tal como aparece
 * @property {string} key           nombre en minúsculas (búsquedas)
 * @property {string} type          tipo declarado en mayúsculas
 * @property {number} recordIndex   posición en el registro (-1 si es virtual)
 * @property {boolean} rowidAlias   true si es INTEGER PRIMARY KEY
 * @property {number|string|null} defaultValue
 */

/**
 * @typedef {object} ParsedTable
 * @property {ColumnDef[]} columns
 * @property {boolean} withoutRowid
 * @property {boolean} virtual      CREATE VIRTUAL TABLE (sin B-tree propio)
 */

/** @typedef {{ t: 'id'|'qid'|'str'|'num'|'blob'|'p', v: string }} Token */

const CONSTRAINT_WORDS = new Set([
  'CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK', 'DEFAULT',
  'COLLATE', 'REFERENCES', 'GENERATED', 'AS',
]);
const TABLE_CONSTRAINT_WORDS = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN']);

/**
 * @param {string} sql
 * @returns {Token[]}
 */
export function tokenize(sql) {
  /** @type {Token[]} */
  const out = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const code = sql.charCodeAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i++;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const r = readQuoted(sql, i, c);
      out.push({ t: c === "'" ? 'str' : 'qid', v: r.value });
      i = r.next;
    } else if (c === '[') {
      const end = sql.indexOf(']', i + 1);
      out.push({ t: 'qid', v: sql.slice(i + 1, end < 0 ? n : end) });
      i = end < 0 ? n : end + 1;
    } else if ((c === 'x' || c === 'X') && sql[i + 1] === "'") {
      const r = readQuoted(sql, i + 1, "'");
      out.push({ t: 'blob', v: r.value });
      i = r.next;
    } else if ((code >= 48 && code <= 57) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      let j = i;
      if (c === '0' && (sql[i + 1] === 'x' || sql[i + 1] === 'X')) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(sql[j])) j++;
      } else {
        while (j < n && /[0-9.]/.test(sql[j])) j++;
        if (sql[j] === 'e' || sql[j] === 'E') {
          j++;
          if (sql[j] === '+' || sql[j] === '-') j++;
          while (j < n && /[0-9]/.test(sql[j])) j++;
        }
      }
      out.push({ t: 'num', v: sql.slice(i, j) });
      i = j;
    } else if (isIdentStart(code)) {
      let j = i + 1;
      while (j < n && isIdentPart(sql.charCodeAt(j))) j++;
      out.push({ t: 'id', v: sql.slice(i, j) });
      i = j;
    } else {
      out.push({ t: 'p', v: c });
      i++;
    }
  }
  return out;
}

/** @param {number} code */
function isIdentStart(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code > 127;
}

/** @param {number} code */
function isIdentPart(code) {
  return isIdentStart(code) || (code >= 48 && code <= 57) || code === 36;
}

/**
 * Lee un literal entre comillas con escape por duplicación.
 * @param {string} sql
 * @param {number} start índice de la comilla de apertura
 * @param {string} quote
 */
function readQuoted(sql, start, quote) {
  let i = start + 1;
  let value = '';
  for (;;) {
    const end = sql.indexOf(quote, i);
    if (end < 0) return { value: value + sql.slice(i), next: sql.length };
    value += sql.slice(i, end);
    if (sql[end + 1] === quote) {
      value += quote;
      i = end + 2;
    } else {
      return { value, next: end + 1 };
    }
  }
}

/**
 * @param {Token | undefined} tok
 * @returns {string}
 */
function upper(tok) {
  return tok && tok.t === 'id' ? tok.v.toUpperCase() : '';
}

/**
 * Índice del token que cierra el paréntesis abierto en `open`.
 * @param {Token[]} toks
 * @param {number} open
 */
function matchParen(toks, open) {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'p') continue;
    if (t.v === '(') depth++;
    else if (t.v === ')' && --depth === 0) return i;
  }
  return toks.length - 1;
}

/**
 * Divide por comas de nivel cero.
 * @param {Token[]} toks
 * @returns {Token[][]}
 */
function splitTopLevel(toks) {
  /** @type {Token[][]} */
  const parts = [];
  /** @type {Token[]} */
  let cur = [];
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'p' && t.v === '(') depth++;
    if (t.t === 'p' && t.v === ')') depth--;
    if (t.t === 'p' && t.v === ',' && depth === 0) {
      parts.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/**
 * Valor literal de una cláusula DEFAULT a partir del token `j`.
 * @param {Token[]} toks
 * @param {number} j
 * @returns {{ value: number|string|null, next: number }}
 */
function readDefault(toks, j) {
  let sign = 1;
  let t = toks[j];
  if (t && t.t === 'p' && (t.v === '-' || t.v === '+')) {
    if (t.v === '-') sign = -1;
    t = toks[++j];
  }
  if (!t) return { value: null, next: j };
  if (t.t === 'p' && t.v === '(') {
    const close = matchParen(toks, j);
    const inner = toks.slice(j + 1, close);
    // Expresión simple entre paréntesis: "(0)" o "('x')".
    if (inner.length === 1 && (inner[0].t === 'num' || inner[0].t === 'str')) {
      const v = inner[0].t === 'num' ? sign * Number(inner[0].v) : inner[0].v;
      return { value: v, next: close + 1 };
    }
    return { value: null, next: close + 1 };
  }
  if (t.t === 'num') return { value: sign * Number(t.v), next: j + 1 };
  if (t.t === 'str') return { value: t.v, next: j + 1 };
  const word = upper(t);
  if (word === 'TRUE') return { value: 1, next: j + 1 };
  if (word === 'FALSE') return { value: 0, next: j + 1 };
  if (word === 'NULL' || word.startsWith('CURRENT_')) return { value: null, next: j + 1 };
  return { value: t.v, next: j + 1 };
}

/**
 * @param {Token[]} toks definición de una columna
 */
function parseColumn(toks) {
  const name = toks[0].v;
  let j = 1;
  /** @type {string[]} */
  const typeWords = [];
  while (j < toks.length) {
    const t = toks[j];
    if (t.t === 'id' && CONSTRAINT_WORDS.has(t.v.toUpperCase())) break;
    if (t.t === 'p' && t.v === '(') {
      j = matchParen(toks, j) + 1;
      continue;
    }
    if (t.t === 'id' || t.t === 'qid') typeWords.push(t.v.toUpperCase());
    j++;
  }
  let pk = false;
  let pkDesc = false;
  let generated = false;
  let stored = false;
  /** @type {number|string|null} */
  let defaultValue = null;
  while (j < toks.length) {
    const word = upper(toks[j]);
    const t = toks[j];
    if (word === 'PRIMARY' && upper(toks[j + 1]) === 'KEY') {
      pk = true;
      j += 2;
      const dir = upper(toks[j]);
      if (dir === 'DESC' || dir === 'ASC') {
        pkDesc = dir === 'DESC';
        j++;
      }
    } else if (word === 'DEFAULT') {
      const r = readDefault(toks, j + 1);
      defaultValue = r.value;
      j = r.next;
    } else if (word === 'AS') {
      generated = true;
      j++;
    } else if (word === 'STORED') {
      stored = true;
      j++;
    } else if (word === 'VIRTUAL') {
      stored = false;
      j++;
    } else if (t.t === 'p' && t.v === '(') {
      j = matchParen(toks, j) + 1;
    } else {
      j++;
    }
  }
  return { name, type: typeWords.join(' '), pk, pkDesc, virtual: generated && !stored, defaultValue };
}

/**
 * Columna nombrada en una restricción de tabla PRIMARY KEY (una sola columna).
 * @param {Token[]} toks
 * @returns {string|null}
 */
function tablePrimaryKeyColumn(toks) {
  for (let j = 0; j < toks.length - 1; j++) {
    if (upper(toks[j]) === 'PRIMARY' && upper(toks[j + 1]) === 'KEY') {
      const open = j + 2;
      if (!toks[open] || toks[open].v !== '(') return null;
      const close = matchParen(toks, open);
      const inner = splitTopLevel(toks.slice(open + 1, close));
      if (inner.length !== 1 || inner[0].length === 0) return null;
      return inner[0][0].v;
    }
  }
  return null;
}

/**
 * Analiza una sentencia CREATE TABLE.
 * @param {string} sql
 * @returns {ParsedTable|null} null si no se puede interpretar
 */
export function parseCreateTable(sql) {
  const toks = tokenize(sql);
  let i = 0;
  if (upper(toks[i]) !== 'CREATE') return null;
  i++;
  if (upper(toks[i]) === 'TEMP' || upper(toks[i]) === 'TEMPORARY') i++;
  if (upper(toks[i]) === 'VIRTUAL') return { columns: [], withoutRowid: false, virtual: true };
  if (upper(toks[i]) !== 'TABLE') return null;
  i++;
  if (upper(toks[i]) === 'IF' && upper(toks[i + 1]) === 'NOT' && upper(toks[i + 2]) === 'EXISTS') i += 3;
  i++; // nombre
  if (toks[i] && toks[i].t === 'p' && toks[i].v === '.') i += 2; // esquema.nombre
  if (!toks[i] || toks[i].t !== 'p' || toks[i].v !== '(') return null; // CREATE TABLE ... AS SELECT
  const close = matchParen(toks, i);
  const body = toks.slice(i + 1, close);
  const tail = toks.slice(close + 1).map(upper);
  const withoutRowid = tail.includes('WITHOUT') && tail.includes('ROWID');

  /** @type {ReturnType<typeof parseColumn>[]} */
  const raw = [];
  /** @type {string|null} */
  let tablePk = null;
  for (const def of splitTopLevel(body)) {
    if (def.length === 0) continue;
    if (def[0].t === 'id' && TABLE_CONSTRAINT_WORDS.has(def[0].v.toUpperCase())) {
      tablePk = tablePrimaryKeyColumn(def) ?? tablePk;
    } else {
      raw.push(parseColumn(def));
    }
  }

  let recordIndex = 0;
  /** @type {ColumnDef[]} */
  const columns = raw.map((c) => {
    const isAlias =
      !withoutRowid &&
      c.type === 'INTEGER' &&
      ((c.pk && !c.pkDesc) || (tablePk !== null && tablePk.toLowerCase() === c.name.toLowerCase()));
    return {
      name: c.name,
      key: c.name.toLowerCase(),
      type: c.type,
      recordIndex: c.virtual ? -1 : recordIndex++,
      rowidAlias: isAlias,
      defaultValue: c.defaultValue,
    };
  });
  return { columns, withoutRowid, virtual: false };
}
