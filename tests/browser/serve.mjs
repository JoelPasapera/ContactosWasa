// Servidor estático mínimo para las pruebas de navegador (MIME correcto para ESM/Workers).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';

const ROOT = process.argv[2];
const PORT = Number(process.argv[3] || 8099);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(full);
    res.setHeader('Content-Type', TYPES[extname(full)] || 'application/octet-stream');
    // COOP/COEP no son necesarios aquí; OPFS sync funciona en Workers sin aislamiento.
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
server.listen(PORT, () => console.log(`serving ${ROOT} on ${PORT}`));
