// @ts-check
/**
 * Barra de progreso con etiqueta de fase. Única responsabilidad: reflejar
 * el avance comunicado por el Worker.
 * @module ui/progress
 */

import { el, toggle } from './dom.js';

/** @type {Record<string, string>} */
const PHASE_LABEL = {
  abriendo: 'Abriendo archivos…',
  descifrando: 'Descifrando la copia…',
  leyendo: 'Leyendo la base de datos…',
  messages: 'Recorriendo los mensajes…',
  analizando: 'Analizando conversaciones…',
  fusionando: 'Armando el padrón…',
};

export class ProgressView {
  /** @param {HTMLElement} mount */
  constructor(mount) {
    this.label = el('span', { class: 'progress__label' }, ['Procesando…']);
    this.bar = el('div', { class: 'progress__bar' });
    this.track = el('div', { class: 'progress__track' }, [this.bar]);
    this.root = el('div', { class: 'progress', role: 'status', 'aria-live': 'polite' }, [this.label, this.track]);
    this.root.hidden = true;
    mount.append(this.root);
  }

  /** @param {boolean} visible */
  show(visible) {
    toggle(this.root, visible);
    if (visible) {
      this.bar.style.width = '0%';
      this.bar.classList.add('is-indeterminate');
    }
  }

  /**
   * @param {string} phase
   * @param {number} done
   * @param {number} total
   */
  update(phase, done, total) {
    this.label.textContent = PHASE_LABEL[phase] ?? 'Procesando…';
    if (total > 0 && done <= total) {
      const pct = Math.max(2, Math.round((done / total) * 100));
      this.bar.classList.remove('is-indeterminate');
      this.bar.style.width = `${pct}%`;
    } else {
      this.bar.classList.add('is-indeterminate');
    }
  }
}
