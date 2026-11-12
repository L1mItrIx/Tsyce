# httpi

Pega un curl o responde unas preguntas y obtén una prueba de API lista para CI.
httpi usa el curl de tu sistema: el asistente y el runner ejecutan la misma request.

![Asistente de httpi en una terminal real](https://raw.githubusercontent.com/L1mItrIx/Tsyce/claude/bold-albattani-fsyz04/docs/demo.gif)

## Requisitos e instalación

Node.js **22 o posterior** y **curl >= 7.83.0** en el PATH. En Windows se usa
`curl.exe`, evitando el alias de PowerShell. `HTTPI_CURL` permite elegir otro binario.

Desde el código fuente:

```bash
git clone --branch claude/bold-albattani-fsyz04 https://github.com/L1mItrIx/Tsyce.git
cd Tsyce
npm ci
npm run check
npm link
httpi --help
```

El paquete está preparado con el nombre **httpi-cli** y el ejecutable **httpi**.
La instalación desde npm estará disponible después de publicar la primera versión.

## Preparar o publicar el paquete

```bash
npm pack
npm install -g ./httpi-cli-0.1.0.tgz
httpi --help
```

`npm pack` ejecuta `npm run check` antes de generar el tarball. El paquete incluye
el runtime, el esquema y los ejemplos; no incluye tests ni archivos de Claude.
Para publicar en npm con una cuenta autorizada:

```bash
npm login
npm publish --access public
```

La versión preparada es **0.1.0**. No hay publicación automática configurada.

## Crear una prueba con el asistente

```bash
httpi new usuarios.yaml --name "Consultar usuarios"
```

1. Selecciona GET, POST, PUT, PATCH, DELETE, HEAD u OPTIONS con las flechas y pulsa Enter.
   También puedes escribir un método personalizado. Luego escribe la URL y pulsa Enter.
2. Añade headers, uno por línea. En headers y body, Enter añade una línea y Tab avanza.
3. Revisa y confirma. Solo entonces se envía la request **una vez**, incluso si es POST o DELETE.
4. Selecciona asserts con ↑/↓ y espacio. El status recibido está seleccionado inicialmente.
   `t` permite escribir un límite de tiempo en ms. **Add request** o Enter añade esa request al flujo.
5. En el resumen, elige **Add another request** (tecla `a`) para configurar la siguiente.
   Repite las veces necesarias. **Save file** o Enter guarda todas en el mismo YAML y en el orden mostrado.

```bash
httpi new flujo-usuarios.yaml --name "Flujo de usuarios"
# Configura la primera request → Add request → Add another request → configura la siguiente.
httpi run flujo-usuarios.yaml --show-response
```

Durante la creación se envía cada request una vez, tras confirmarla, para proponer
asserts. Agregar otra o guardar no vuelve a ejecutar las anteriores. Al usar `run`
se ejecuta nuevamente el flujo completo. `--name` nombra el test si solo hay una
request, o el archivo si hay varias.

Esc vuelve a la pantalla anterior; Ctrl+C cancela la request actual y detiene curl.
Si ya agregaste otras, vuelve al resumen y las conserva; **Discard file** o Ctrl+C
en ese resumen descarta todo sin escribir. Si falla la red,
puedes reintentar o volver a editar. El asistente requiere una terminal interactiva
y nunca sobrescribe un archivo existente. La selección ofrece status, tiempo,
headers y comparadores JSON (`exists`, `type`, `equals`, `contains`, `matches`).
En respuestas grandes se limita la lista para mantener manejable el menú.

### Mouse, headers y body

En Windows Terminal, la terminal de VS Code u otra terminal compatible con mouse
SGR, puedes hacer clic en los métodos y en los botones **Next**, **Back**, **Cancel**
y **Send request**. En la respuesta, haz clic en los asserts para marcarlos y en
**Add request** para agregarla al flujo. En el resumen, usa **Add another request**
para continuar o **Save file** para escribir el YAML. La rueda desplaza el formulario si no cabe en la ventana
y recorre las opciones del menú de asserts. El asistente usa una pantalla alternativa
y restaura la terminal al salir. El teclado sigue funcionando; Shift permite usar la
selección de texto propia de las terminales que ofrecen ese atajo.

**Headers** son datos adicionales de la request: `Content-Type: application/json`
indica que envías JSON y `Authorization: Bearer ...` puede identificarte ante una API.
Un GET público como `https://jsonplaceholder.typicode.com/posts/1` normalmente no
necesita headers: haz clic en **Skip headers**.

**Body** es el contenido que envías. POST, PUT y PATCH suelen usarlo, por ejemplo
`{"name":"Ana"}`. Un GET o HEAD normalmente no necesita body: usa **No body**.
El formulario incluye **Add JSON header** y **Use JSON example**; este último añade
`Content-Type: application/json` si no lo habías definido. El ejemplo es editable:
debes adaptarlo a los campos que espera tu API.

En un flujo, el mismo secreto reutiliza su variable; credenciales diferentes usan
variables distintas (`{{token}}`, `{{token2}}`, etc.). httpi indica los nombres al
guardar, sin imprimir los valores. Proporciónalos con `--var` al ejecutar el archivo.

Seleccionar un método, añadir un ejemplo o avanzar no envía nada. Solo **Send request**
o Enter en la pantalla de confirmación realiza la llamada.

### Capturar el token durante la prueba interactiva

No necesitas copiar el token ni escribir el YAML manualmente:

1. Configura y envía la request de login.
2. En su respuesta pulsa **Use response token** (o `c`). Selecciona el campo que
   contiene el access token, por ejemplo `$["access_token"]`. El selector muestra
   las rutas, sin revelar sus valores. Después elige los asserts y pulsa **Add request**.
3. Pulsa **Add another request** y configura la URL protegida.
4. En Headers pulsa **Use captured token**. Se añade `Authorization: Bearer {{authToken}}`;
   al confirmar se envía el valor que acabas de obtener, sin que lo copies.
5. Agrega la request y guarda el flujo con **Save file**.

El archivo guarda la ruta de extracción (`capture.authToken`), no el token. Al
ejecutarlo, httpi hace login de nuevo y utiliza el token nuevo para las siguientes
requests. No lo reutiliza entre ejecuciones. Si falla el login, sus asserts o la
extracción, se detiene el flujo sin enviar las siguientes requests. `{{authToken}}`
queda reservado a la captura y no usa un valor antiguo del entorno o de `--var`.

Para probarlo localmente, inicia `node examples/server.mjs` y crea una prueba con
POST `http://127.0.0.1:3000/auth/login`, header `Content-Type: application/json` y
body `{"username":"demo","password":"demo"}`. Selecciona `access_token`, agrega
GET `http://127.0.0.1:3000/private/users` y usa el token capturado. Es una API de
demostración; esas credenciales son ficticias. También se incluye el flujo equivalente:

```bash
httpi run examples/auth.yaml --env dev --show-response
```

Los tokens capturados se mantienen en memoria y se ocultan en los reportes pretty
y JUnit. La respuesta de login se oculta incluso con `--show-response`. Las opciones
del asistente evitan asserts con el valor literal del token. Para credenciales reales,
usa variables de entorno en el login y revisa el archivo antes de compartirlo: los
campos de usuario/password del body no se extraen automáticamente como secretos.

La captura actual está orientada a tokens Bearer en una respuesta JSON. El exportador
de curl estático rechaza estos flujos, porque no puede reproducir la extracción.

## Importar un curl

```bash
httpi import curl.txt -o usuarios.yaml
httpi import curl.txt --dialect cmd -o usuarios.yaml
```

También acepta stdin: `cat curl.txt | httpi import -o usuarios.yaml` en Bash.
Se detectan Bash, cmd y PowerShell; `--dialect` fuerza el dialecto. Los flags no
soportados generan advertencias. El importador **no ejecuta** la request ni inventa
asserts: añade un bloque `expect` o crea la prueba con `httpi new`.

Al importar o usar el asistente, los headers Authorization y Cookie se guardan como
`{{token}}`, `{{basicAuth}}`, `{{authorization}}` o `{{cookie}}`. Pasa su valor al ejecutar.
`httpi import --keep-secrets` permite conservarlos explícitamente.
Otros headers, cuerpos y parámetros de URL pueden contener secretos: revisa el YAML antes de compartirlo.

## Ejecutar y configurar entornos

```bash
httpi run usuarios.yaml
httpi run usuarios.yaml --env dev --var token=valor
httpi run usuarios.yaml --env dev --show-response
httpi run usuarios.yaml --reporter junit > results.xml
```

YAML y JSON usan el mismo esquema. Ejemplo mínimo:

```yaml
version: 1
tests:
  - name: Consultar usuarios
    request:
      method: GET
      url: "{{baseUrl}}/users"
    expect:
      status: 200
      headers:
        content-type: { contains: application/json }
      json:
        - { path: "$.users[0].id", exists: true }
```

`httpi.env.yaml`, junto al test o en el directorio actual:

```yaml
dev:
  baseUrl: http://127.0.0.1:3000
```

`{{nombre}}` busca en **`--var` > entorno del sistema > archivo de entornos**.
`${NOMBRE}` solo lee el sistema. Una variable sin resolver es un error; los valores
no se expanden recursivamente. En Windows, evita nombres como `path` y `username`
en el archivo: pueden quedar tapados por las variables del sistema.

| Salida | Significado |
| --- | --- |
| 0 | Todos los tests pasaron |
| 1 | Falló al menos un assert |
| 2 | Archivo, variable o uso inválidos |
| 3 | curl ausente/antiguo o error de red |

Las requests se ejecutan en orden. Un HTTP 404 es una respuesta: solo falla si
contradice los asserts. Los errores de red tienen prioridad sobre los asserts fallidos.

### Ejecutar un archivo completo sin pasos manuales

Guarda todas las requests en el arreglo `tests` del YAML. Al ejecutar el archivo,
httpi carga el ambiente, envía cada request en orden y comprueba sus asserts sin
abrir el asistente ni pedir confirmaciones:

```bash
httpi run examples/requests.yaml --env dev --show-response
```

[examples/requests.yaml](examples/requests.yaml) contiene un GET y un POST listos
para la API local de ejemplo. Iníciala primero con `node examples/server.mjs`.
El POST de esta API es una respuesta de demostración: no persiste usuarios ni cambia el GET.

`--show-response` muestra el status, todos los headers y el body de cada respuesta,
con JSON formateado, además del resultado de los asserts. También muestra respuestas
con asserts fallidos; un error de red se informa como tal. Los caracteres de control
se muestran escapados para que una respuesta no modifique la terminal. Usa este flag
cuando quieras inspeccionar el contenido; puede mostrar datos sensibles de tu API.
No se combina con `--reporter junit`, que genera solo XML.

Puedes definir más ambientes en `httpi.env.yaml` y cambiar solo `--env`, o pasar
`--var baseUrl=https://tu-api-de-pruebas.example` sin modificar las requests.

## Exportar curl

```bash
httpi export usuarios.yaml --env dev --dialect bash > requests.sh
httpi export usuarios.yaml --env dev --dialect cmd > requests.cmd
httpi export usuarios.yaml --env dev --dialect powershell > requests.ps1
```

Se exportan todas las requests, sin asserts y con las variables ya resueltas.
La salida puede contener credenciales. No publica ni ejecuta el script.

- Bash: comandos con argumentos literales.
- cmd: archivo **`.cmd`**, no una línea para pegar en el prompt. Rechaza saltos de línea literales.
- PowerShell: script para **7.3+**, con `curl.exe` y paso de argumentos `Standard`.
  Windows PowerShell 5.1 puede perder comillas y no está soportado en la exportación.

## Probar el ejemplo local y CI

En una terminal:

```bash
node examples/server.mjs
```

En otra, desde el repositorio:

```bash
httpi run examples/users.yaml --env dev
httpi run examples/users.yaml --env dev --reporter junit > results.xml
```

[examples/github-actions.yml](examples/github-actions.yml) contiene un workflow completo:
compila httpi, inicia la API local, ejecuta la prueba y sube el XML incluso si fallan
asserts. En tu propio proyecto puedes usar el mismo comando contra tu API, sin el
servidor de ejemplo. JUnit distingue `<failure>` (assert) de `<error>` (transporte).

`npm run check` comprueba tipos, compila y ejecuta los tests. La CI del proyecto usa
Ubuntu, macOS y Windows con Node 22 y 24; incluye curl real y pruebas de teclado de Ink.
Las fixtures de importación todavía no se han contrastado con pegados reales de
DevTools en Windows. Los secretos enviados a curl viajan en argumentos visibles en
la lista de procesos del sistema.

## Autocompletado del YAML

El esquema publicado en [schema/httpi.schema.json](schema/httpi.schema.json) se
genera desde zod en cada `npm run build`. Con la extensión YAML de VS Code,
añade un comentario al inicio del test (ajusta la ruta a tu archivo):

```yaml
# yaml-language-server: $schema=./schema/httpi.schema.json
```

También puedes usar la URL raw del esquema en GitHub. No añadas una propiedad
`$schema` al test: el formato rechaza claves desconocidas. Las comprobaciones
personalizadas de JSONPath y regex se realizan al ejecutar httpi; el esquema del
editor no sustituye la validación del runner.

No incluye encadenamiento de requests, OAuth, GraphQL/gRPC, importación de OpenAPI/Postman ni scripting.
Consulta [PROGRESS.md](PROGRESS.md) para el avance y las limitaciones pendientes.
