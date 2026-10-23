// Simulador del visor de artefactos para pruebas: envuelve la página en el
// mismo esqueleto que el host y aplica una CSP modelada sobre el contrato
// (scripts y estilos solo inline o de los CDN permitidos; Workers propios o
// blob:; fetch al mismo origen). Sirve también los archivos estáticos de la
// raíz, para comprobar que una página modular NO puede usarlos.
//
//   node tests/browser/viewer-sim.mjs <raíz> <página.html> <puerto>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const [ROOT, PAGE, PORT = '8098'] = process.argv.slice(2);

const SKELETON_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}' +
  'img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
const SKELETON_TAIL = '</body></html>';

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com data:',
  'img-src data: blob:',
  "worker-src 'self' blob:",
  "connect-src 'self'",
].join('; ');

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (path === '/' || path === '/index.html') {
      const page = await readFile(PAGE, 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', CSP);
      res.end(SKELETON_HEAD + page + SKELETON_TAIL);
      return;
    }
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(full);
    res.setHeader('Content-Type', TYPES[extname(full)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(Number(PORT), () => console.log(`visor simulado en ${PORT}`));
