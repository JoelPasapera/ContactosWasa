// Pruebas de la versión de un solo archivo (dist/):
//  1) dist/padron.html abierto con doble clic (file://): el ejemplo se procesa
//     y la descarga clásica funciona.
//  2) dist/artifact.html dentro del visor simulado (esqueleto + CSP) con un
//     sustituto de window.claude: las descargas pasan por la capacidad
//     `downloads`, la vCard suelta se oculta y el ZIP la incluye.
//
//   node tests/browser/viewer-sim.mjs "$PWD/dist" "$PWD/dist/artifact.html" 8098 &
//   node tests/browser/single-file.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import playwright from '/opt/npm-tools/node_modules/playwright/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../../dist');
const VIEWER = process.env.VIEWER || 'http://127.0.0.1:8098';
const expected = JSON.parse(readFileSync(join(HERE, '../fixtures/demo-expected.json'), 'utf8'));
const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});

/** Espera a que el ejemplo termine y devuelve las fichas. */
async function exampleChips(page) {
  await page.waitForSelector('#results:not([hidden])', { timeout: 30000 });
  await page.waitForSelector('#demo-banner:not([hidden])');
  return page.$$eval('.chip__value', (ns) => ns.map((n) => Number(n.textContent.replace(/\D/g, ''))));
}
const want = [expected.total, expected.initiatedByMe, expected.initiatedByThem, expected.inBook, expected.groups];

// --- 1) Doble clic: file:// ---
{
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`file://${DIST}/padron.html`);
  assert.deepEqual(await exampleChips(page), want, 'file://: el ejemplo se procesa al abrir');
  assert.equal(await page.isVisible('#export-vcf'), true, 'file://: botón vCard visible');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export-xlsx')]);
  assert.match(dl.suggestedFilename(), /\.xlsx$/, 'file://: descarga clásica del Excel');
  // Enlace de ayuda (ancla) y sección visible.
  await page.click('a[href="#conseguir"]');
  await page.waitForTimeout(600);
  const inView = await page.$eval('#conseguir', (s) => {
    const r = s.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0;
  });
  assert.ok(inView, 'file://: «¿Dónde los encuentro?» lleva a la sección de ayuda');
  assert.deepEqual(errors, [], `file://: sin errores\n${errors.join('\n')}`);
  await ctx.close();
  console.log('✅ dist/padron.html con doble clic: ejemplo, ayuda y descarga OK');
}

// --- 2) Visor simulado con capacidad de descargas ---
{
  const ctx = await browser.newContext();
  // Sustituto mínimo del entorno del visor: solo `use`, con `downloads.save`.
  await ctx.addInitScript(() => {
    /** @type {any[]} */
    const saved = [];
    Object.defineProperty(window, '__saved', { value: saved });
    window.claude = {
      use: (name) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                name === 'downloads'
                  ? Object.freeze({
                      save: async ({ filename, data }) => {
                        saved.push({ filename, size: data.size, isBlob: data instanceof Blob });
                        return { status: 'saved' };
                      },
                    })
                  : null,
              ),
            50,
          ),
        ),
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => /Content Security Policy|Refused/i.test(m.text()) && errors.push(m.text()));
  await page.goto(VIEWER, { waitUntil: 'networkidle' });
  assert.deepEqual(await exampleChips(page), want, 'visor: el ejemplo se procesa al abrir');
  await page.waitForFunction(() => document.getElementById('export-vcf')?.hidden === true);
  assert.equal(await page.textContent('#export-zip'), 'Todo en ZIP (incluye vCard)', 'visor: ZIP anuncia la vCard');
  await page.click('#export-xlsx');
  await page.waitForFunction(() => /** @type {any} */ (window).__saved.length === 1);
  await page.click('#export-zip');
  await page.waitForFunction(() => /** @type {any} */ (window).__saved.length === 2);
  const saved = await page.evaluate(() => /** @type {any} */ (window).__saved);
  assert.match(saved[0].filename, /\.xlsx$/);
  assert.match(saved[1].filename, /\.zip$/);
  assert.ok(saved.every((s) => s.isBlob && s.size > 1000), 'visor: se entregan Blobs no vacíos');
  assert.match(await page.textContent('.exporters__status'), /Listo/, 'visor: mensaje de éxito');
  assert.deepEqual(errors, [], `visor: sin errores ni bloqueos\n${errors.join('\n')}`);
  await ctx.close();
  console.log('✅ dist/artifact.html en el visor simulado: descargas por la capacidad, vCard dentro del ZIP');
}
await browser.close();
