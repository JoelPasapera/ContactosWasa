// Empaquetador propio, sin dependencias: une los módulos ES de js/ en un solo
// HTML autocontenido (CSS y JS en línea, Worker desde blob:). Herramienta de
// desarrollo; el código fuente sigue siendo modular.
//
//   node tools/build-single.mjs
//
// Salidas:
//   dist/padron.html    documento completo: funciona con doble clic y en cualquier hosting.
//   dist/artifact.html  fragmento según el contrato del visor de artefactos
//                       (sin doctype/html/head/body; el visor pone el esqueleto).
//
// Admite exactamente las formas que usa el proyecto y falla en cualquier otra:
//   import { a, b as c } from './x.js';    export function|async function|class|const|let
//   import('./x.js')  (dinámica, con literal)   import.meta.url
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_ENTRY = 'js/app/main.js';
const WORKER_ENTRY = 'js/worker/extract-worker.js';

const STATIC_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
// Las importaciones de tipos de JSDoc ({import('./x.js').Tipo}) no se tocan:
// van seguidas de ".Nombre".
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)(?!\.[A-Za-z_$])/g;
const EXPORT_DECL = /^export\s+(async\s+function\s*\*?|function\s*\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;

/**
 * @param {string} fromId
 * @param {string} spec
 */
function resolveId(fromId, spec) {
  if (!spec.startsWith('.')) throw new Error(`${fromId}: solo se admiten rutas relativas (${spec})`);
  return posix.normalize(posix.join(posix.dirname(fromId), spec));
}

/**
 * Transforma un módulo a función de registro y devuelve sus dependencias.
 * @param {string} id
 */
function transform(id) {
  let src = readFileSync(join(ROOT, id), 'utf8');
  /** @type {Set<string>} */
  const staticDeps = new Set();
  /** @type {Set<string>} */
  const dynamicDeps = new Set();

  src = src.replace(STATIC_IMPORT, (_, names, spec) => {
    const dep = resolveId(id, spec);
    staticDeps.add(dep);
    const bindings = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const m = n.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!m) throw new Error(`${id}: importación no admitida "${n}"`);
        return m[2] ? `${m[1]}: ${m[2]}` : m[1];
      });
    return `const { ${bindings.join(', ')} } = __req(${JSON.stringify(dep)});`;
  });

  src = src.replace(DYNAMIC_IMPORT, (_, spec) => {
    const dep = resolveId(id, spec);
    dynamicDeps.add(dep);
    return `Promise.resolve().then(() => __req(${JSON.stringify(dep)}))`;
  });

  /** @type {string[]} */
  const exported = [];
  src = src.replace(EXPORT_DECL, (_, kind, name) => {
    exported.push(name);
    return `${kind} ${name}`;
  });

  src = src.replace(/\bimport\.meta\.url\b/g, 'document.baseURI');

  const leftovers = src.match(/^(import|export)\b.*$/gm);
  if (leftovers) throw new Error(`${id}: sintaxis de módulo no admitida:\n  ${leftovers.join('\n  ')}`);

  const tail = exported.map((n) => `__exp.${n} = ${n};`).join('\n');
  const code = `__def(${JSON.stringify(id)}, function (__req, __exp) {\n${src}\n${tail}\n});`;
  return { code, staticDeps, dynamicDeps };
}

/**
 * Recorre el grafo desde la entrada. Rechaza ciclos de importación estática
 * (romperían el orden de inicialización de este empaquetador).
 * @param {string} entry
 */
function bundle(entry) {
  /** @type {Map<string, string>} */
  const modules = new Map();
  /** @type {Set<string>} */
  const visiting = new Set();

  /** @param {string} id @param {string[]} chain */
  const visit = (id, chain) => {
    if (modules.has(id)) return;
    if (visiting.has(id)) throw new Error(`Ciclo de importación: ${[...chain, id].join(' → ')}`);
    visiting.add(id);
    const { code, staticDeps, dynamicDeps } = transform(id);
    for (const dep of staticDeps) visit(dep, [...chain, id]);
    visiting.delete(id);
    modules.set(id, code);
    // Las dinámicas se cargan bajo demanda: no participan en el orden.
    for (const dep of dynamicDeps) visit(dep, []);
  };
  visit(entry, []);

  const runtime = `const __defs = new Map();
const __cache = new Map();
function __def(id, factory) { __defs.set(id, factory); }
function __req(id) {
  const hit = __cache.get(id);
  if (hit) return hit;
  const factory = __defs.get(id);
  if (!factory) throw new Error('Módulo no empaquetado: ' + id);
  const exports = {};
  __cache.set(id, exports);
  factory(__req, exports);
  return exports;
}`;
  const body = [...modules.values()].join('\n\n');
  return { code: `${runtime}\n\n${body}\n\n__req(${JSON.stringify(entry)});\n`, count: modules.size };
}

/**
 * Comprueba que un texto pueda ir dentro de un <script> o <style> en línea.
 * @param {string} label
 * @param {string} text
 * @param {string} closing etiqueta de cierre que no debe aparecer
 */
function assertInlineSafe(label, text, closing) {
  if (new RegExp(`</${closing}`, 'i').test(text) || text.includes('<!--')) {
    throw new Error(`${label}: contiene "</${closing}" o "<!--" y no puede ir en línea`);
  }
}

/**
 * Elimina las regiones marcadas como solo-desarrollo.
 * @param {string} html
 */
function stripDevOnly(html) {
  return html.replace(/[ \t]*<!-- dev-only:start -->[\s\S]*?<!-- dev-only:end -->\n?/g, '');
}

const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const pageMatch = indexHtml.match(/<!-- page:start -->\n([\s\S]*?)[ \t]*<!-- page:end -->/);
if (!pageMatch) throw new Error('index.html: faltan los marcadores page:start/page:end');
const pageContent = stripDevOnly(pageMatch[1]).trimEnd();
const title = (indexHtml.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? 'Padrón de WhatsApp';
const description = (indexHtml.match(/<meta\s+name="description"\s+content="([^"]*)"/) ?? [])[1] ?? '';
const icon = (indexHtml.match(/<link rel="icon" href="([^"]*)"/) ?? [])[1] ?? '';

const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8');
const worker = bundle(WORKER_ENTRY);
const page = bundle(PAGE_ENTRY);
if (/\bdocument\b/.test(worker.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))) {
  throw new Error('El código del Worker no puede usar document');
}

assertInlineSafe('CSS', css, 'style');
assertInlineSafe('página', page.code, 'script');
// El Worker viaja como cadena: se escapan "</" y "<!--" para el analizador HTML.
const workerLiteral = JSON.stringify(`'use strict';\n${worker.code}`).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');

const scripts =
  `<script>globalThis.__PADRON_WORKER_SRC__ = ${workerLiteral};</script>\n` +
  `<script type="module">\n${page.code}</script>`;

const standalone = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="icon" href="${icon}">
<style>
${css}</style>
</head>
<body>
${pageContent}
${scripts}
</body>
</html>
`;

const artifact = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
${pageContent}
${scripts}
`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/padron.html'), standalone);
writeFileSync(join(ROOT, 'dist/artifact.html'), artifact);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(
  `página: ${page.count} módulos · Worker: ${worker.count} módulos · padron.html ${kb(standalone)} · artifact.html ${kb(artifact)}`,
);
