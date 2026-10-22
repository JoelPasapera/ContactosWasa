// @ts-check
/**
 * Tabla virtualizada: solo materializa en el DOM las filas visibles, de modo
 * que decenas de miles de contactos se desplazan con fluidez. Única
 * responsabilidad: pintar filas y emitir el evento de ordenación.
 * @module ui/table
 */

import { el, clear } from './dom.js';
import { formatNumber, formatDate } from './format.js';

const ROW_HEIGHT = 44;
const OVERSCAN = 6;

/** @typedef {import('../contacts/merge.js').Contact} Contact */

/**
 * @typedef {object} ColumnSpec
 * @property {string} field       campo de Contact para ordenar
 * @property {string} label
 * @property {'text'|'number'|'date'|'initiated'|'type'} render
 * @property {boolean} [numeric]  alineación a la derecha
 */

/** @type {ColumnSpec[]} */
export const TABLE_COLUMNS = [
  { field: 'name', label: 'Nombre', render: 'text' },
  { field: 'phone', label: 'Teléfono', render: 'text' },
  { field: 'type', label: 'Tipo', render: 'type' },
  { field: 'initiatedByMe', label: '¿Inicié yo?', render: 'initiated' },
  { field: 'messageCount', label: 'Mensajes', render: 'number', numeric: true },
  { field: 'callCount', label: 'Llamadas', render: 'number', numeric: true },
  { field: 'lastTs', label: 'Último mensaje', render: 'date' },
];

/** @type {Record<string, string>} */
const TYPE_LABEL = {
  contacto: 'Contacto',
  grupo: 'Grupo',
  oculto: 'Sin número',
  difusión: 'Difusión',
  canal: 'Canal',
};

export class ContactTable {
  /**
   * @param {HTMLElement} container
   * @param {(field: string) => void} onSort
   */
  constructor(container, onSort) {
    this.container = container;
    this.onSort = onSort;
    /** @type {Contact[]} */
    this.rows = [];
    this.container.classList.add('table');

    this.head = el('div', { class: 'table__head', role: 'row' });
    this.viewport = el('div', { class: 'table__viewport', tabindex: '0' });
    this.spacer = el('div', { class: 'table__spacer' });
    this.layer = el('div', { class: 'table__layer' });
    this.spacer.append(this.layer);
    this.viewport.append(this.spacer);
    this.container.append(this.head, this.viewport);

    this.#buildHead();
    this.viewport.addEventListener('scroll', () => this.#renderWindow());
    this.resizeObserver = new ResizeObserver(() => this.#renderWindow());
    this.resizeObserver.observe(this.viewport);
  }

  #buildHead() {
    clear(this.head);
    for (const col of TABLE_COLUMNS) {
      const cell = el(
        'button',
        {
          class: `table__th${col.numeric ? ' table__th--num' : ''}`,
          type: 'button',
          'data-field': col.field,
          onclick: () => this.onSort(col.field),
        },
        [col.label],
      );
      this.head.append(cell);
    }
  }

  /**
   * @param {Contact[]} rows
   * @param {import('../app/state.js').Sort} sort
   */
  setRows(rows, sort) {
    this.rows = rows;
    this.spacer.style.height = `${rows.length * ROW_HEIGHT}px`;
    for (const th of this.head.children) {
      const field = /** @type {HTMLElement} */ (th).dataset.field;
      th.setAttribute('aria-sort', field === sort.field ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
      th.classList.toggle('is-sorted', field === sort.field);
      th.classList.toggle('is-desc', field === sort.field && sort.dir === -1);
    }
    this.viewport.scrollTop = 0;
    this.#renderWindow();
  }

  #renderWindow() {
    const scrollTop = this.viewport.scrollTop;
    const height = this.viewport.clientHeight || ROW_HEIGHT * 12;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visible = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;
    const last = Math.min(this.rows.length, first + visible);
    this.layer.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    clear(this.layer);
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.append(this.#renderRow(this.rows[i]));
    this.layer.append(frag);
  }

  /**
   * @param {Contact} c
   * @returns {HTMLElement}
   */
  #renderRow(c) {
    const row = el('div', { class: 'table__row', role: 'row' });
    for (const col of TABLE_COLUMNS) {
      const cell = el('div', { class: `table__cell${col.numeric ? ' table__cell--num' : ''}` });
      this.#fillCell(cell, col, c);
      row.append(cell);
    }
    return row;
  }

  /**
   * @param {HTMLElement} cell
   * @param {ColumnSpec} col
   * @param {Contact} c
   */
  #fillCell(cell, col, c) {
    const value = /** @type {any} */ (c)[col.field];
    switch (col.render) {
      case 'number':
        cell.textContent = formatNumber(value || 0);
        break;
      case 'date':
        cell.textContent = formatDate(value || 0);
        break;
      case 'type':
        cell.append(el('span', { class: `tag tag--${c.type}` }, [TYPE_LABEL[c.type] ?? c.type]));
        break;
      case 'initiated':
        cell.append(initiatedBadge(c.initiatedByMe));
        break;
      default:
        if (col.field === 'name') {
          cell.append(el('span', { class: 'table__name' }, [String(value ?? '')]));
          if (c.inAddressBook) cell.append(el('span', { class: 'dot', title: 'En tu agenda' }));
        } else {
          cell.textContent = String(value ?? '');
        }
    }
  }
}

/**
 * @param {number|null} v
 * @returns {HTMLElement}
 */
function initiatedBadge(v) {
  if (v === 1) return el('span', { class: 'badge badge--me' }, ['Yo']);
  if (v === 0) return el('span', { class: 'badge badge--them' }, ['Me escribieron']);
  return el('span', { class: 'badge badge--none' }, ['—']);
}
