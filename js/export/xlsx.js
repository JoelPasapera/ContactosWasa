// @ts-check
/**
 * Escritor XLSX mínimo desde cero: genera las partes OOXML estrictamente
 * necesarias (workbook, una hoja, estilos y relaciones) y las empaqueta con
 * el ZIP propio. Usa cadenas en línea (inlineStr), fila de cabecera fija,
 * autofiltro y anchos de columna. No depende de ninguna biblioteca.
 * @module export/xlsx
 */

import { createZip } from './zip.js';

const encoder = new TextEncoder();

/**
 * @typedef {object} XlsxColumn
 * @property {string} header
 * @property {number} [width]    ancho aproximado en caracteres
 * @property {boolean} [numeric] true para escribir celdas numéricas
 */

/**
 * Escapa texto para contenido XML y elimina caracteres de control no válidos
 * en XML 1.0 (que WhatsApp puede haber guardado en algún mensaje).
 * @param {string} value
 * @returns {string}
 */
function xmlText(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const valid = code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0xfffe && code !== 0xffff);
    if (!valid) continue;
    const ch = value[i];
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else out += ch;
  }
  return out;
}

/**
 * Letra(s) de columna 1→A, 27→AA.
 * @param {number} index 1-based
 * @returns {string}
 */
export function columnLetter(index) {
  let n = index;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * @param {string} sheetName
 * @returns {string}
 */
function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlText(sheetName).slice(0, 31) || 'Hoja1'}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

/**
 * @param {XlsxColumn[]} columns
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @returns {Uint8Array}
 */
function worksheetBytes(columns, rows) {
  const lastCol = columnLetter(columns.length);
  const totalRows = rows.length + 1;
  const parts = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  );
  // anchos de columna
  parts.push('<cols>');
  columns.forEach((c, i) => {
    parts.push(`<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`);
  });
  parts.push('</cols>');
  // vista con la fila de cabecera congelada
  parts.push(
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
  );
  parts.push('<sheetData>');
  // cabecera
  parts.push('<row r="1">');
  columns.forEach((c, i) => {
    const ref = `${columnLetter(i + 1)}1`;
    parts.push(`<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlText(c.header)}</t></is></c>`);
  });
  parts.push('</row>');
  // datos
  for (let r = 0; r < rows.length; r++) {
    const rowNum = r + 2;
    const row = rows[r];
    parts.push(`<row r="${rowNum}">`);
    for (let i = 0; i < columns.length; i++) {
      const ref = `${columnLetter(i + 1)}${rowNum}`;
      const value = row[i];
      if (value == null || value === '') continue;
      if (columns[i].numeric && typeof value === 'number' && Number.isFinite(value)) {
        parts.push(`<c r="${ref}"><v>${value}</v></c>`);
      } else {
        parts.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(value))}</t></is></c>`);
      }
    }
    parts.push('</row>');
  }
  parts.push('</sheetData>');
  parts.push(`<autoFilter ref="A1:${lastCol}${totalRows}"/>`);
  parts.push('</worksheet>');
  return encoder.encode(parts.join(''));
}

/**
 * Construye un .xlsx de una hoja.
 * @param {object} args
 * @param {string} args.sheetName
 * @param {XlsxColumn[]} args.columns
 * @param {Array<Array<string|number|null|undefined>>} args.rows
 * @returns {Promise<Blob>}
 */
export function buildXlsx({ sheetName, columns, rows }) {
  return createZip([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(sheetName)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: worksheetBytes(columns, rows) },
  ]);
}
