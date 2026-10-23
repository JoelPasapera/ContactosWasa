// Prueba de extremo a extremo en Chromium real (Workers, WebCrypto,
// DecompressionStream). Autocontenida: genera sus propios fixtures cifrados.
//
//   node tests/browser/serve.mjs "$PWD" 8099 &   # servir la app
//   node tests/browser/e2e.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import playwright from '/opt/npm-tools/node_modules/playwright/index.js';
import { generateEncrypted } from '../fixtures/generate.mjs';
import { bytesToHex } from '../../js/util/bytes.js';

const { chromium } = playwright;
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const PAGE = process.env.PAGE || '/';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const dir = mkdtempSync(join(tmpdir(), 'padron-e2e-'));
const rootKey = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
const expected = await generateEncrypted(dir, rootKey, 1200);
const rootHex = bytesToHex(rootKey);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newContext({ acceptDownloads: true }).then((c) => c.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));

await page.goto(BASE + PAGE, { waitUntil: 'networkidle' });
assert.equal(await page.title(), 'Padrón de WhatsApp');

// La página abre con el ejemplo procesado; el usuario lo reemplaza con sus archivos.
await page.waitForSelector('#demo-banner:not([hidden])', { timeout: 30000 });
await page.setInputFiles('#file-input', [`${dir}/syn-msgstore.db.crypt15`, `${dir}/syn-wa.db.crypt15`]);
assert.equal(await page.isVisible('#results'), false, 'el ejemplo se retira al traer archivos propios');
await page.fill('#key-input', rootHex);
await page.click('#process');

await page.waitForSelector('#results:not([hidden])', { timeout: 60000 });
await page.waitForFunction(() => /\d/.test(document.getElementById('view-count')?.textContent || ''));
assert.equal(await page.isVisible('#demo-banner'), false, 'resultado propio, sin aviso de ejemplo');

const num = (s) => Number(String(s).split('de')[0].replace(/\D/g, ''));
const chips = await page.$$eval('.chip__value', (ns) => ns.map((n) => Number(n.textContent.replace(/\D/g, ''))));
const [total, me, them, inBook, groups] = chips;
assert.equal(total, expected.totalWithGroups, `total (con grupos): ${total}`);
assert.equal(me, expected.initMeAll, `inicié yo (con grupos): ${me}`);
assert.equal(them, expected.initThemAll, `me escribieron (con grupos): ${them}`);
assert.equal(inBook, expected.waPhones, `en agenda: ${inBook}`);
assert.equal(groups, expected.groups, `grupos: ${groups}`);

const rendered = await page.$$eval('.table__row', (ns) => ns.length);
assert.ok(rendered > 0 && rendered < 60, `tabla virtualizada acotada: ${rendered} filas en el DOM`);

// Búsqueda por número único (i=500 → +51980000500, está en agenda).
await page.fill('.filters__search', '+51980000500');
await page.waitForTimeout(250);
assert.equal(num(await page.$eval('#view-count', (n) => n.textContent)), 1, 'búsqueda única → 1');
await page.fill('.filters__search', '');
await page.waitForTimeout(200);
assert.equal(num(await page.$eval('#view-count', (n) => n.textContent)), expected.totalWithGroups, 'limpiar → todos');

// Preset "Inicié yo".
await page.click('.chip:nth-child(2)');
await page.waitForTimeout(200);
assert.equal(num(await page.$eval('#view-count', (n) => n.textContent)), expected.initMeAll, 'preset inicié yo');
await page.click('.chip:nth-child(1)');
await page.waitForTimeout(150);

// Exportar Excel de verdad desde el navegador.
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-xlsx')]);
const xlsxPath = `${dir}/descarga.xlsx`;
await download.saveAs(xlsxPath);
assert.ok(readFileSync(xlsxPath).length > 2000, 'xlsx descargado no vacío');

assert.deepEqual(errors, [], `sin errores en consola/página:\n${errors.join('\n')}`);
await browser.close();
console.log('✅ e2e navegador:', JSON.stringify({ total, me, them, inBook, groups, rendered }));
