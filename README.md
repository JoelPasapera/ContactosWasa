# Padrón de WhatsApp

Aplicación web **100 % del lado del cliente** (sin frameworks, sin servidores, sin red)
que lee tu copia de seguridad de WhatsApp para Android y arma un padrón con **todos tus
contactos** y, para cada conversación, **quién la inició** (tú o la otra persona).

Todo ocurre dentro de tu navegador: ni tu copia ni tu clave salen nunca del dispositivo.
La página no hace una sola petición de red mientras procesa.

![sin conexión · sin servidores · sin dependencias](https://img.shields.io/badge/privacidad-100%25_local-1f7a5a)

---

## Qué obtienes

Una tabla filtrable y ordenable, y la posibilidad de exportar a **Excel (.xlsx)**, **CSV**,
**vCard (.vcf)** o un **.zip** con todo. Cada contacto trae:

| Columna | Significado |
|---|---|
| Nombre | De tu agenda (wa.db), de un vCard, o el número si no hay nombre |
| Teléfono | Número en formato internacional (`+51…`) |
| Tipo | Contacto, grupo, «sin número» (LID), difusión o canal |
| **¿Yo inicié?** | **Quién envió el primer mensaje de la conversación: tú o el contacto** |
| Mensajes / Enviados / Recibidos | Conteos por conversación |
| Llamadas | Número de llamadas registradas |
| Primer / Último mensaje | Fechas |
| En agenda | Si el contacto tiene nombre guardado en tu agenda |

---

## Qué archivos necesitas

1. **`msgstore.db.crypt15`** — tu copia de mensajes cifrada. En el teléfono está en:
   ```
   Android/media/com.whatsapp/WhatsApp/Databases/msgstore.db.crypt15
   ```
2. **La clave de 64 dígitos** (cifrado de extremo a extremo). En WhatsApp:
   *Ajustes → Chats → Copia de seguridad → Cifrado de extremo a extremo → ver/anotar la clave.*

Opcionales, para que salgan **nombres** y no solo números:
- **`wa.db`** o **`wa.db.crypt15`** (tu agenda sincronizada por WhatsApp), o
- un archivo **`.vcf`** exportado de tus contactos (Google Contacts, iCloud, etc.).

> Si solo tienes el archivo `encrypted_backup.key` en vez de los 64 dígitos, también sirve:
> arrástralo junto con los demás.

Consejo: copia los archivos del teléfono a la computadora (cable o nube) y luego súbelos aquí.

---

## Cómo ejecutarla

Como usa **módulos ES** y un **Web Worker**, hay que servirla por HTTP (no vale abrir
`index.html` con `file://`). Cualquier servidor estático sirve:

```bash
# Con Python
python3 -m http.server 8000

# o con Node
npx serve .
```

Luego abre `http://localhost:8000`. También funciona publicada en **GitHub Pages** o
cualquier hosting estático; sigue siendo 100 % local porque todo corre en el navegador.
Si abres `index.html` con doble clic, la página muestra un aviso: así el navegador bloquea la
aplicación.

### Probar sin tus datos

El botón **«Ver un ejemplo»** carga dos archivos de ejemplo (`msgstore.db.crypt15` y
`wa.db.crypt15`) con su clave, y señala el siguiente paso: pulsar **Procesar**. Sirve para
practicar el flujo completo antes de buscar tus propios archivos. Los datos son ficticios:
nombres inventados y números del rango +1 202 555 0100–0199, reservado para ficción. En cuanto
arrastras un archivo tuyo, el ejemplo se retira solo.

Navegadores: Chrome/Edge 94+, Firefox 114+, Safari 16.4+ (hace falta `WebCrypto`,
`DecompressionStream` y Web Workers de módulo).

---

## Cómo está construido

Vanilla JS + HTML + CSS, sin dependencias. La lógica está separada del DOM y repartida en
módulos de responsabilidad única. **Todo lo sensible se implementó desde cero**: el
descifrado, el lector de SQLite, el escritor de XLSX y el de ZIP.

```
js/
├─ crypto/        Descifrado de la copia (desde cero)
│  ├─ backup-header.js   Cabecera protobuf de .crypt15
│  ├─ backup-cipher.js   HKDF-SHA256 + AES-256-GCM (vía AES-CTR en streaming)
│  ├─ ghash.js           GF(2^128)/GHASH para el bloque contador J0 (IV de 16 B)
│  ├─ protobuf.js        Lector protobuf mínimo
│  ├─ md5.js             MD5 (suma de integridad de la copia)
│  └─ key.js             Clave de 64 dígitos / encrypted_backup.key
├─ sqlite/        Lector SQLite de solo lectura (desde cero)
│  ├─ header.js · varint.js · record.js · btree.js · schema-sql.js · database.js
├─ storage/       Almacenamiento del descifrado: memoria u OPFS según tamaño
│  ├─ memory-store.js · opfs-store.js · block-cache.js (LRU) · create-store.js
├─ whatsapp/      Dominio: índice de JID, LID→número, hilos e iniciador
│  ├─ jid.js · extract.js
├─ contacts/      Nombres (wa.db + vCard) y fusión del padrón
│  ├─ wa-contacts.js · vcard.js · phone.js · merge.js
├─ export/        Escritores de salida (desde cero)
│  ├─ xlsx.js · zip.js · crc32.js · csv.js · vcard-export.js · report.js
├─ worker/        Procesamiento fuera del hilo principal
│  ├─ extract-worker.js · protocol.js
├─ backup/        Orquestación
│  ├─ loader.js · pipeline.js
├─ ui/            Componentes de interfaz (DOM aislado aquí)
│  ├─ dom.js · dropzone.js · progress.js · summary.js · filters.js
│  ├─ table.js (tabla virtualizada) · format.js · error-messages.js · download.js
├─ app/           Composición
│  ├─ state.js · controller.js · export-controller.js · main.js
├─ demo/          Ejemplo guiado (se carga solo al pedirlo)
│  ├─ demo-loader.js · demo-data.js (generado por tools/build-demo.mjs)
└─ util/          bytes.js · errors.js · rowid-set.js
tools/
└─ build-demo.mjs  Regenera los archivos de ejemplo cifrados
```

### Decisiones de rendimiento

- **Descifrado en streaming**: AES-GCM se calcula como AES-CTR nativo (`WebCrypto`) por
  bloques; el bloque contador inicial `J0` para el IV de 16 bytes se deriva con una
  implementación propia de GHASH. La copia nunca se carga entera en memoria.
- **OPFS para copias grandes**: a partir de ~192 MB el texto descifrado se vuelca al
  sistema de archivos privado del origen, con una **caché LRU de bloques** preasignada, de
  modo que la memoria queda acotada aunque la base pese varios GB. Las copias pequeñas van
  en memoria. Los temporales se borran al terminar.
- **Lector SQLite sin asignaciones por fila**: recorre los B-tree y decodifica los
  registros de forma perezosa reutilizando una vista de fila; soporta páginas de
  desbordamiento y columnas añadidas por `ALTER TABLE`.
- **Un solo recorrido de `message`** para todos los agregados, con acumuladores mutables
  por chat y un mapa de bits (`RowidSet`) para los mensajes de sistema.
- **Tabla virtualizada**: solo se materializan en el DOM las filas visibles, así decenas de
  miles de contactos se desplazan con fluidez.
- Todo el trabajo pesado corre en un **Web Worker** (con repliegue al hilo principal si el
  navegador no admite Workers de módulo).

---

## Validación

El proyecto se probó a fondo (ver `tests/`):

- **Descifrado**: byte por byte contra copias **reales** de WhatsApp 2.26 durante el
  desarrollo, y en la suite incluida contra copias sintéticas cifradas con el mismo esquema.
- **Lector SQLite propio**: sus conteos y agregados se comparan contra el `node:sqlite`
  incorporado (oráculo) sobre la misma base.
- **Extracción e iniciador**: verificados por construcción contra el generador de datos.
- **Exportadores**: el `.xlsx` abre sin advertencias en LibreOffice y openpyxl; los `.xlsx`,
  `.csv` y `.zip` se releen con un lector propio en las pruebas.
- **Extremo a extremo**: prueba en Chromium real (Workers, WebCrypto, descarga de Excel).

### Correr las pruebas

```bash
node tests/node/run.mjs           # suite autocontenida (solo Node 22+)

# Pruebas de navegador (requieren Playwright y Chromium):
node tests/browser/serve.mjs "$PWD" 8099 &
node tests/browser/e2e.mjs        # flujo completo con copias cifradas
node tests/browser/e2e-demo.mjs   # ejemplo guiado
```

---

## Limitaciones

- Solo copias **`.crypt15`** (cifrado de extremo a extremo con clave de 64 dígitos). Las
  copias `.crypt14` antiguas o las protegidas con **contraseña/llave de acceso** no se
  admiten; la app lo avisa con claridad.
- Contactos que WhatsApp solo conoce por **LID** (identificador oculto) aparecen sin número;
  se muestran con el nombre que haya.
- Los **nombres** dependen de `wa.db` o del `.vcf`. Sin ellos, los contactos salen con su
  número.
- «¿Yo inicié?» mira el **primer mensaje conversacional** de cada chat (se ignoran los
  avisos de sistema como «cifrado de extremo a extremo»).

---

## Licencia

Uso personal. Haz con tu propio código y tus propios datos lo que quieras.
