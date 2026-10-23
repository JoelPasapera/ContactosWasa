// Capturas de pantalla para revisión visual (no es una prueba con aserciones).
//   node tests/browser/serve.mjs "$PWD" 8099 &
//   OUT=/ruta/capturas PAGE=/dist/padron.html node tests/browser/screenshots.mjs
import { mkdirSync } from 'node:fs';
import playwright from '/opt/npm-tools/node_modules/playwright/index.js';

const { chromium } = playwright;
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const PAGE = process.env.PAGE || '/';
const OUT = process.env.OUT || './capturas';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
for (const [label, viewport, scheme] of [
  ['escritorio', { width: 1180, height: 900 }, 'light'],
  ['movil', { width: 390, height: 844 }, 'light'],
  ['escritorio-oscuro', { width: 1180, height: 900 }, 'dark'],
]) {
  const page = await browser.newPage({ viewport, colorScheme: /** @type {'light'|'dark'} */ (scheme) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + PAGE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#demo-banner:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${label}-primera-vista.png` });
  await page.screenshot({ path: `${OUT}/${label}-completa.png`, fullPage: true });
  console.log(label, 'errores:', errors.length ? errors : 'ninguno');
  await page.close();
}
await browser.close();
