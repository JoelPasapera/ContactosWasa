// Prueba del ejemplo que se carga al abrir, en Chromium real.
//   node tests/browser/serve.mjs "$PWD" 8099 &
//   PAGE=/ node tests/browser/e2e-demo.mjs                  # versión modular
//   PAGE=/dist/padron.html node tests/browser/e2e-demo.mjs  # versión de un solo archivo
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '/opt/npm-tools/node_modules/playwright/index.js';
import { generateEncrypted } from '../fixtures/generate.mjs';

const { chromium } = playwright;
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const PAGE = process.env.PAGE || '/';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HERE = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(join(HERE, '../fixtures/demo-expected.json'), 'utf8'));
const want = [expected.total, expected.initiatedByMe, expected.initiatedByThem, expected.inBook, expected.groups];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
await page.goto(BASE + PAGE, { waitUntil: 'networkidle' });
const chips = () => page.$$eval('.chip__value', (ns) => ns.map((n) => Number(n.textContent.replace(/\D/g, ''))));

// 1) Al abrir: el ejemplo ya está procesado y marcado como tal.
await page.waitForSelector('#demo-banner:not([hidden])', { timeout: 30000 });
assert.deepEqual(await chips(), want, 'fichas del ejemplo al abrir');
assert.ok(await page.isVisible('#demo-hint'), 'aviso de que los archivos son del ejemplo');
assert.equal(await page.isVisible('#error'), false, 'sin recuadro de error vacío');
assert.equal((await page.$$('#file-warning')).length === 0 || !(await page.isVisible('#file-warning')), true, 'sin aviso de doble clic');
const names = await page.$$eval('.dropzone__file-name', (ns) => ns.map((n) => n.textContent));
assert.deepEqual(names, ['msgstore.db.crypt15', 'wa.db.crypt15'], 'archivos de ejemplo listados');
assert.equal(await page.inputValue('#key-input'), expected.keyHex, 'clave de ejemplo puesta');
assert.ok(await page.isVisible('#conseguir'), 'la ayuda para conseguir los archivos está siempre visible');

// 2) «Ver el ejemplo» lo vuelve a procesar.
await page.click('#demo');
await page.waitForSelector('#demo-banner:not([hidden])', { timeout: 30000 });
assert.deepEqual(await chips(), want, 'fichas tras «Ver el ejemplo»');

// 3) El usuario trae su propio archivo: el ejemplo se retira solo.
const dir = mkdtempSync(join(tmpdir(), 'padron-demo-e2e-'));
await generateEncrypted(dir, Uint8Array.from({ length: 32 }, (_, i) => i), 30);
await page.setInputFiles('#file-input', [`${dir}/syn-msgstore.db.crypt15`]);
const after = await page.$$eval('.dropzone__file-name', (ns) => ns.map((n) => n.textContent));
assert.deepEqual(after, ['syn-msgstore.db.crypt15'], 'solo queda el archivo del usuario');
assert.equal(await page.inputValue('#key-input'), '', 'la clave de ejemplo se borró');
assert.equal(await page.isVisible('#results'), false, 'resultados del ejemplo ocultos');
assert.equal(await page.isVisible('#demo-hint'), false, 'aviso del ejemplo oculto');

// 4) Procesar sin archivos orienta hacia el ejemplo.
await page.click('#reset');
await page.click('#process');
assert.ok((await page.textContent('#error')).includes('Ver el ejemplo'), 'el error orienta hacia el ejemplo');

assert.deepEqual(errors, [], `sin errores en consola/página:\n${errors.join('\n')}`);
await browser.close();
console.log(`✅ e2e ejemplo (${PAGE}):`, JSON.stringify({ chips: want }));
