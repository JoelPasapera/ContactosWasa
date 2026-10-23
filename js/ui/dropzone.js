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
   * @param {(files: File[]) => void} onAdd       avisa cada cambio de la lista
   * @param {() => void} [beforeUserAdd]          se llama antes de que el usuario añada archivos
   */
  constructor(mount, onAdd, beforeUserAdd = () => {}) {
    this.onAdd = onAdd;
    this.beforeUserAdd = beforeUserAdd;
    /** @type {File[]} */
    this.files = [];
    /** Etiqueta de las fichas marcadas (p. ej. «ejemplo»). */
    this.tag = '';
    /** @type {Set<File>} */
    this.tagged = new Set();

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

  /**
   * Sustituye la lista completa (lo usa el ejemplo). Con `tag`, cada ficha
   * muestra esa etiqueta para que se vea que no son archivos del usuario.
   * @param {File[]} files
   * @param {string} [tag]
   */
  setFiles(files, tag = '') {
    this.files = [...files];
    this.tag = tag;
    this.tagged = new Set(tag ? files : []);
    this.#renderList();
    this.onAdd(this.files);
  }

  /** @param {File[]} incoming */
  #add(incoming) {
    this.beforeUserAdd();
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
      const parts = [el('span', { class: 'dropzone__file-name' }, [f.name])];
      if (this.tagged.has(f)) parts.push(el('span', { class: 'dropzone__tag' }, [this.tag]));
      parts.push(
        el('span', { class: 'dropzone__file-size' }, [formatSize(f.size)]),
        el('button', { type: 'button', class: 'dropzone__remove', 'aria-label': `Quitar ${f.name}`, onclick: () => this.#remove(i) }, ['✕']),
      );
      this.list.append(el('li', { class: 'dropzone__file' }, parts));
    });
  }

  reset() {
    this.files = [];
    this.tagged = new Set();
    this.#renderList();
  }
}
