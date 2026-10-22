// Prueba del ejemplo guiado en Chromium real.
//   node tests/browser/serve.mjs "$PWD" 8099 &
//   node tests/browser/e2e-demo.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '/opt/npm-tools/node_modules/playwright/index.js';
import { generateEncrypted } from '../fixtures/generate.mjs';

const { chromium } = playwright;
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HERE = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(join(HERE, '../fixtures/demo-expected.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
await page.goto(BASE, { waitUntil: 'networkidle' });

// Regresión: los avisos vacíos deben estar ocultos al abrir.
assert.equal(await page.isVisible('#error'), false, 'el recuadro de error vacío no se ve');
assert.equal(await page.isVisible('#file-warning'), false, 'sin aviso de doble clic al servir por HTTP');
assert.equal(await page.isVisible('#demo-hint'), false, 'sin indicación antes del ejemplo');

// 1) Cargar el ejemplo.
await page.click('#demo');
await page.waitForSelector('#demo-hint:not([hidden])');
const names = await page.$$eval('.dropzone__file-name', (ns) => ns.map((n) => n.textContent));
assert.deepEqual(names, ['msgstore.db.crypt15', 'wa.db.crypt15'], 'archivos de ejemplo listados');
assert.equal(await page.inputValue('#key-input'), expected.keyHex, 'clave de ejemplo puesta');
assert.ok(await page.$eval('#process', (b) => b.classList.contains('is-attention')), 'Procesar resaltado');

// 2) Procesar.
await page.click('#process');
await page.waitForSelector('#results:not([hidden])', { timeout: 30000 });
assert.ok(await page.isVisible('#demo-banner'), 'aviso de datos de ejemplo visible');
assert.equal(await page.isVisible('#demo-hint'), false, 'indicación retirada al procesar');
const chips = await page.$$eval('.chip__value', (ns) => ns.map((n) => Number(n.textContent.replace(/\D/g, ''))));
assert.deepEqual(
  chips,
  [expected.total, expected.initiatedByMe, expected.initiatedByThem, expected.inBook, expected.groups],
  'fichas del ejemplo',
);

// 3) El usuario trae su propio archivo: el ejemplo se retira solo.
const dir = mkdtempSync(join(tmpdir(), 'padron-demo-e2e-'));
await generateEncrypted(dir, Uint8Array.from({ length: 32 }, (_, i) => i), 30);
await page.setInputFiles('#file-input', [`${dir}/syn-msgstore.db.crypt15`]);
const after = await page.$$eval('.dropzone__file-name', (ns) => ns.map((n) => n.textContent));
assert.deepEqual(after, ['syn-msgstore.db.crypt15'], 'solo queda el archivo del usuario');
assert.equal(await page.inputValue('#key-input'), '', 'la clave de ejemplo se borró');
assert.equal(await page.isVisible('#results'), false, 'resultados de ejemplo ocultos');
assert.equal(await page.isVisible('#demo-banner'), false, 'aviso de ejemplo oculto');

// 4) Procesar sin archivos muestra la ayuda adecuada.
await page.click('#reset');
await page.click('#process');
assert.ok((await page.textContent('#error')).includes('Ver un ejemplo'), 'el error orienta hacia el ejemplo');

assert.deepEqual(errors, [], `sin errores en consola/página:\n${errors.join('\n')}`);
await browser.close();
console.log('✅ e2e ejemplo guiado:', JSON.stringify({ chips }));
