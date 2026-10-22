// @ts-check
/**
 * Barra de filtros: búsqueda por texto, tipo, iniciador y conmutadores.
 * Única responsabilidad: recoger la intención de filtrado y avisar.
 * @module ui/filters
 */

import { el } from './dom.js';

export class FilterBar {
  /**
   * @param {HTMLElement} mount
   * @param {(patch: Partial<import('../app/state.js').Filters>) => void} onChange
   */
  constructor(mount, onChange) {
    this.onChange = onChange;

    this.search = el('input', {
      type: 'search',
      class: 'filters__search',
      placeholder: 'Buscar por nombre, número o JID…',
      'aria-label': 'Buscar contactos',
    });
    let timer = 0;
    this.search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange({ query: /** @type {HTMLInputElement} */ (this.search).value }), 120);
    });

    this.type = selectControl('Tipo', [
      ['all', 'Todos'],
      ['contacto', 'Contactos'],
      ['grupo', 'Grupos'],
      ['oculto', 'Sin número'],
    ]);
    this.type.addEventListener('change', () => onChange({ type: /** @type {HTMLSelectElement} */ (this.type).value }));

    this.initiated = selectControl('Inició', [
      ['all', 'Cualquiera'],
      ['me', 'La inicié yo'],
      ['them', 'Me escribieron'],
    ]);
    this.initiated.addEventListener('change', () =>
      onChange({ initiated: /** @type {any} */ (/** @type {HTMLSelectElement} */ (this.initiated).value) }),
    );

    this.withChat = checkControl('Con conversación');
    this.withChat.input.addEventListener('change', () => onChange({ onlyWithChat: this.withChat.input.checked }));

    this.inBook = checkControl('Solo agenda');
    this.inBook.input.addEventListener('change', () => onChange({ onlyInAddressBook: this.inBook.input.checked }));

    this.root = el('div', { class: 'filters' }, [
      this.search,
      this.type,
      this.initiated,
      this.withChat.label,
      this.inBook.label,
    ]);
    mount.append(this.root);
  }

  /**
   * Refleja un preset elegido desde la barra de resumen.
   * @param {import('../app/state.js').Filters} filters
   */
  sync(filters) {
    /** @type {HTMLInputElement} */ (this.search).value = filters.query;
    /** @type {HTMLSelectElement} */ (this.type).value = filters.type;
    /** @type {HTMLSelectElement} */ (this.initiated).value = filters.initiated;
    this.withChat.input.checked = filters.onlyWithChat;
    this.inBook.input.checked = filters.onlyInAddressBook;
  }
}

/**
 * @param {string} label
 * @param {Array<[string, string]>} options
 * @returns {HTMLSelectElement}
 */
function selectControl(label, options) {
  const select = el('select', { class: 'filters__select', 'aria-label': label });
  for (const [value, text] of options) select.append(el('option', { value }, [text]));
  return /** @type {HTMLSelectElement} */ (select);
}

/**
 * @param {string} label
 */
function checkControl(label) {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', class: 'filters__check' }));
  const wrapper = el('label', { class: 'filters__toggle' }, [input, el('span', {}, [label])]);
  return { label: wrapper, input };
}
