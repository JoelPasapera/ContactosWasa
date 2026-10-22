// @ts-check
/**
 * Ayudantes mínimos de DOM. Única responsabilidad: crear y manipular nodos
 * sin plantillas ni frameworks.
 * @module ui/dom
 */

/**
 * Crea un elemento con atributos e hijos.
 * @param {string} tag
 * @param {Record<string, string|number|boolean|EventListener>} [attrs]
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else if (value !== false && value != null) {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) node.append(child);
  return node;
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
export function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id}`);
  return node;
}

/** @param {HTMLElement} node */
export function clear(node) {
  node.replaceChildren();
}

/**
 * @param {HTMLElement} node
 * @param {boolean} visible
 */
export function toggle(node, visible) {
  node.hidden = !visible;
}
