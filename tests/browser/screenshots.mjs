// Capturas de pantalla para revisión visual (no es una prueba con aserciones).
//   node tests/browser/serve.mjs "$PWD" 8099 &
//   OUT=/tmp/shots node tests/browser/screenshots.mjs
import { mkdirSync } from 'node:fs';
import playwright from '/opt/npm-tools/node_modules/playwright/index.js';

const { chromium } = playwright;
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const OUT = process.env.OUT || '/tmp/shots';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
for (const [label, viewport] of [
  ['desktop', { width: 1180, height: 900 }],
  ['movil', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${label}-1-inicio.png`, fullPage: true });
  await page.click('#demo');
  await page.waitForSelector('#demo-hint:not([hidden])');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${label}-2-ejemplo-cargado.png`, fullPage: true });
  await page.click('#process');
  await page.waitForSelector('#results:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${label}-3-resultados.png`, fullPage: true });
  console.log(label, 'errores:', errors.length ? errors : 'ninguno');
  await page.close();
}
await browser.close();
