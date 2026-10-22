# Pruebas

Dos suites, ambas autocontenidas (no necesitan tu copia real ni archivos externos:
generan copias `.crypt15` sintéticas con el esquema real de WhatsApp 2.26).

## Node (sin dependencias, solo Node 22+)

```bash
node tests/node/run.mjs
```

Comprueba, de punta a punta:

1. El **lector SQLite propio** contra el `node:sqlite` incorporado (mismos conteos y
   agregados sobre la misma base).
2. La **extracción** y la detección de **quién inició** cada conversación.
3. La **tubería completa** descifrando copias `.crypt15` cifradas con una clave conocida.
4. El rechazo de una **clave equivocada** (`KEY_WRONG`).
5. Los **exportadores** XLSX/CSV/VCF/ZIP, releídos con un lector de ZIP propio.

Variable opcional: `SCALE=5000 node tests/node/run.mjs` para más datos.

## Navegador (Chromium + Playwright)

```bash
node tests/browser/serve.mjs "$PWD" 8099 &
node tests/browser/e2e.mjs
```

Carga la app en Chromium real, sube los fixtures cifrados, teclea la clave, procesa y
verifica las fichas de resumen, el filtrado, la tabla virtualizada y la descarga del Excel,
exigiendo **cero errores** de consola o de página.

`node tests/browser/e2e-demo.mjs` prueba el ejemplo guiado: que los avisos vacíos estén
ocultos al abrir, que «Ver un ejemplo» cargue archivos y clave, que las fichas coincidan con
`fixtures/demo-expected.json`, y que el ejemplo se retire al arrastrar un archivo propio.
`node tests/browser/screenshots.mjs` genera capturas (escritorio y móvil) para revisión visual.

## Carpeta `fixtures/`

Herramientas **solo de prueba** (no forman parte de la app): generador de bases sintéticas
(`generate.mjs`, usa `node:sqlite`), cifrador `.crypt15` (`crypt15-encrypt.mjs`) y un lector
de ZIP (`unzip.mjs`). Los datos son inventados de forma determinista; no hay información de
ninguna persona real.
