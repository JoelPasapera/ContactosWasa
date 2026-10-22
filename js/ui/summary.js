// @ts-check
/**
 * Barra de resumen: fichas con los totales del padrón. Clicables para fijar
 * un filtro rápido.
 * @module ui/summary
 */

import { el, clear } from './dom.js';
import { formatNumber } from './format.js';

export class SummaryBar {
  /**
   * @param {HTMLElement} mount
   * @param {(preset: string) => void} onPick
   */
  constructor(mount, onPick) {
    this.root = el('div', { class: 'summary' });
    this.onPick = onPick;
    mount.append(this.root);
  }

  /**
   * @param {{ total: number, initiatedByMe: number, initiatedByThem: number, groups: number, inBook: number }} s
   */
  render(s) {
    clear(this.root);
    /** @type {Array<[string, number, string, string]>} */
    const chips = [
      ['Contactos', s.total, 'all', 'Todos los contactos del padrón'],
      ['Inicié yo', s.initiatedByMe, 'me', 'Conversaciones que empezaste tú'],
      ['Me escribieron', s.initiatedByThem, 'them', 'Conversaciones que empezó el contacto'],
      ['En tu agenda', s.inBook, 'book', 'Contactos con nombre en la agenda'],
      ['Grupos', s.groups, 'groups', 'Grupos en los que participas'],
    ];
    for (const [label, value, preset, title] of chips) {
      this.root.append(
        el('button', { class: 'chip', type: 'button', title, onclick: () => this.onPick(preset) }, [
          el('span', { class: 'chip__value' }, [formatNumber(value)]),
          el('span', { class: 'chip__label' }, [label]),
        ]),
      );
    }
  }
}
