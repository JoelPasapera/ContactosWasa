// @ts-check
/**
 * Zona para soltar o elegir archivos. Única responsabilidad: recoger
 * archivos del usuario y mostrarlos como fichas; avisa por callback.
 * @module ui/dropzone
 */

import { el, clear } from './dom.js';
import { formatSize } from './format.js';

export class DropZone {
  /**
   * @param {HTMLElement} mount
   * @param {(files: File[]) => void} onAdd
   */
  constructor(mount, onAdd) {
    this.onAdd = onAdd;
    /** @type {File[]} */
    this.files = [];

    this.input = el('input', { type: 'file', multiple: true, class: 'dropzone__input', id: 'file-input' });
    this.input.addEventListener('change', () => {
      if (this.input instanceof HTMLInputElement && this.input.files) this.#add([...this.input.files]);
      if (this.input instanceof HTMLInputElement) this.input.value = '';
    });

    this.area = el('label', { class: 'dropzone', for: 'file-input' }, [
      el('div', { class: 'dropzone__icon', 'aria-hidden': 'true' }, ['📂']),
      el('div', { class: 'dropzone__text' }, [
        el('strong', {}, ['Arrastra aquí tus archivos o haz clic']),
        el('span', { class: 'dropzone__hint' }, ['msgstore.db.crypt15, wa.db, encrypted_backup.key, contactos.vcf']),
      ]),
      this.input,
    ]);

    this.list = el('ul', { class: 'dropzone__files' });
    mount.append(this.area, this.list);

    for (const type of ['dragenter', 'dragover']) {
      this.area.addEventListener(type, (e) => {
        e.preventDefault();
        this.area.classList.add('is-over');
      });
    }
    for (const type of ['dragleave', 'drop']) {
      this.area.addEventListener(type, (e) => {
        e.preventDefault();
        this.area.classList.remove('is-over');
      });
    }
    this.area.addEventListener('drop', (e) => {
      const dt = /** @type {DragEvent} */ (e).dataTransfer;
      if (dt?.files?.length) this.#add([...dt.files]);
    });
  }

  /** @param {File[]} incoming */
  #add(incoming) {
    for (const f of incoming) {
      if (!this.files.some((x) => x.name === f.name && x.size === f.size)) this.files.push(f);
    }
    this.#renderList();
    this.onAdd(this.files);
  }

  /** @param {number} index */
  #remove(index) {
    this.files.splice(index, 1);
    this.#renderList();
    this.onAdd(this.files);
  }

  #renderList() {
    clear(this.list);
    this.files.forEach((f, i) => {
      this.list.append(
        el('li', { class: 'dropzone__file' }, [
          el('span', { class: 'dropzone__file-name' }, [f.name]),
          el('span', { class: 'dropzone__file-size' }, [formatSize(f.size)]),
          el('button', { type: 'button', class: 'dropzone__remove', 'aria-label': `Quitar ${f.name}`, onclick: () => this.#remove(i) }, ['✕']),
        ]),
      );
    });
  }

  reset() {
    this.files = [];
    this.#renderList();
  }
}
