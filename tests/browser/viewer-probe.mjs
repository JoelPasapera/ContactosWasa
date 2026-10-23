// Sonda para el visor simulado: informa si el JS y el CSS propios cargaron,
// si la ayuda se abre desde el enlace y qué bloqueó la CSP.
//   node tests/browser/viewer-probe.mjs http://127.0.0.1:8098
import playwright from '/opt/npm-tools/node_modules/playwright/index.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8098';
const SHOT = process.argv[3] || '';
const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const blocked = [];
page.on('console', (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to/i.test(t)) blocked.push(t.slice(0, 140));
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const dz = document.querySelector('.dropzone');
  const bg = getComputedStyle(document.body).backgroundColor;
  return {
    jsCorrio_dropzoneCreada: Boolean(dz),
    cssPropioAplicado: bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(0, 0, 0, 0)',
    fondoBody: bg,
  };
});

// Enlace «¿Dónde los encuentro?» (botón o ancla según la versión).
const link = await page.$('[data-open-help], a[href="#conseguir"]');
let ayudaVisibleTrasClic = null;
if (link) {
  await link.click();
  await page.waitForTimeout(800);
  ayudaVisibleTrasClic = await page.evaluate(() => {
    const target = document.getElementById('conseguir') || document.getElementById('help');
    if (!target) return false;
    const open = target.tagName !== 'DETAILS' || /** @type {HTMLDetailsElement} */ (target).open;
    const r = target.getBoundingClientRect();
    return open && r.top < window.innerHeight && r.bottom > 0;
  });
}
if (SHOT) await page.screenshot({ path: SHOT, clip: { x: 0, y: 0, width: 1100, height: 800 } });
console.log(JSON.stringify({ ...report, ayudaVisibleTrasClic, bloqueosCSP: blocked.slice(0, 4) }, null, 2));
await browser.close();
