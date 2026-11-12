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

## Conectar agentes de IA por MCP

`httpi mcp` expone el mismo motor de flujos a clientes MCP locales por `stdio`.
No necesita cuenta, servicio alojado ni dependencias adicionales. El cliente inicia
el proceso; no es una pantalla interactiva y stdout contiene exclusivamente JSON-RPC.
Implementa el subconjunto de herramientas del protocolo con inicialización de
[MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
con negociación de las versiones 2025-06-18, 2025-03-26 y 2024-11-05. No implementa
Streamable HTTP, OAuth, recursos, prompts ni tareas/cancelación MCP.

Después de `npm.cmd run build`, esta configuración sirve para clientes que utilizan
`mcpServers` (ajusta las rutas a tu instalación):

```json
{
  "mcpServers": {
    "tsyce": {
      "command": "node",
      "args": [
        "D:\\Tsyce\\dist\\cli.js", "mcp",
        "--root", "D:\\Tsyce\\examples",
        "--allow-run", "--allow-origin", "http://127.0.0.1:3000",
        "--allow-env", "dev", "--allow-write"
      ]
    }
  }
}
```

Usa `node` con una ruta absoluta al JS para evitar problemas con los wrappers `.cmd`
en Windows. Cada cliente tiene su formato de configuración; esta sección JSON no se
copia sin cambios a configuraciones TOML. No se ha instalado automáticamente en tu cliente.

| Herramienta | Entrada | Resultado |
|---|---|---|
| `list_tests` | `{}` | Rutas relativas de flujos YAML/JSON válidos; excluye archivos de entorno. |
| `inspect_test` | `{ "file": "auth.yaml" }` | Orden, método, URL sin query/credenciales, nombres de headers, tipo de body y cantidad de asserts; omite valores de headers/body/asserts. |
| `create_test` | `{ "file": "nuevo.yaml", "testFile": { "version": 1, "tests": [...] } }` | Valida y crea el archivo, sin sobrescribir ni ejecutarlo. Extrae Authorization/Cookie a variables como el asistente. |
| `run_test` | `{ "file": "auth.yaml", "env": "dev", "variables": {} }` | `exitCode`, resumen, orden, status HTTP, tiempo y resultado booleano de cada assert. Autentica y captura tokens con el motor habitual. |

Para una prueba completa, deja `node examples/server.mjs` ejecutándose en otra terminal,
conecta el cliente y pide: **«Lista los flujos de Tsyce, inspecciona auth.yaml y
ejecútalo en dev; dime qué pasos y validaciones fallaron»**. La API local utiliza
credenciales ficticias `demo/demo`. Antes de conectar un agente a una API real,
configura su origen y los ambientes concretos que quieres permitir.

Permisos configurados por la persona que inicia el proceso:

- `--root` es obligatorio. Las rutas deben ser relativas y quedar dentro de esa carpeta,
  también tras resolver symlinks. Los directorios de destino deben existir.
- Sin `--allow-run` no se envía ninguna request; sin `--allow-write` no se crean archivos.
  El agente no puede activar estos permisos mediante argumentos de herramientas.
- Cada origen HTTP(S), con puerto, necesita `--allow-origin`; cada ambiente necesita
  `--allow-env`. Ambos flags son repetibles. Se comprueban todos los destinos antes
  de enviar la primera request. El archivo de entorno debe estar junto al flujo y dentro de root.
- `--allow-run` autoriza también POST/PUT/PATCH/DELETE. La aprobación de cada llamada
  corresponde al cliente MCP y su política; el servidor no abre diálogos de confirmación.
  Usa ambientes de prueba y no habilites producción por defecto.
- Las respuestas MCP de ejecución omiten headers, bodies y valores esperados, incluso
  si una petición devuelve credenciales. Los tokens capturados se conservan solo en
  memoria. Los errores de diagnóstico se resumen sin incluir contenido del archivo.
- La inspección devuelve metadatos del archivo; no pongas secretos en nombres, rutas
  de URL o nombres de headers. Los parámetros de una llamada pasan por el cliente/agente:
  usa referencias a variables para contraseñas en vez de enviarlas como literales.
- Esta versión MCP rechaza redirects, multipart y tokens capturados en URLs; limita
  cada request a 30 segundos. Para uploads y diagnóstico completo usa el CLI.
  El límite de carpeta no es un sandbox del sistema operativo ni limita DNS o proxies.

## Comparativa de alternativas para probar APIs

Consulta documental: **12 de noviembre de 2026**. Es un mapa amplio de alternativas
representativas, no un censo exhaustivo ni un benchmark ejecutado. Se comparan funciones
documentadas por sus fabricantes con el código actual de Tsyce; no se instalaron ni
probaron todas las alternativas. Las ediciones y planes pueden cambiar las prestaciones.
**NV** significa que no se verificó un servidor MCP oficial para ese uso en las fuentes
consultadas; no demuestra que no exista. Ser cliente MCP, generar un servidor desde una
API y exponer el propio runner a agentes son capacidades distintas.

### Clientes y herramientas más cercanos

| Opción y fuente oficial | Cómo se trabaja y automatiza | IA/MCP verificado | Diferencia frente a Tsyce |
|---|---|---|---|
| **Tsyce / httpi** | Asistente de terminal con mouse; YAML/JSON ordenado; curl real; ambientes, asserts, Bearer capturado, CLI/JUnit. | Servidor local de cuatro herramientas sobre los mismos flujos. | Flujo pequeño y local; sin colaboración alojada, importación OpenAPI/Postman, scripting general o OAuth guiado. npm aún sin publicar. |
| **[Postman](https://learning.postman.com/docs/tests-and-scripts/running-collections/intro-to-collection-runs/)** | Plataforma de colecciones, scripts, ejecución, colaboración y monitores. | [Servidor MCP para recursos Postman](https://learning.postman.com/docs/reference/postman-api/postman-mcp-server/overview); además genera servidores desde APIs. | Mayor amplitud y ecosistema. Hay que evaluar edición, credenciales y flujo local/cloud; MCP no es exclusivo de Tsyce. |
| **[Bruno](https://www.usebruno.com/product/cli)** | Cliente de colecciones en archivos y CLI para CI. | [MCP oficial](https://github.com/usebruno/bruno-mcp) descubre/inspecciona y ejecuta mediante su CLI. | Competidor directo para colecciones locales y agentes; Tsyce apuesta por terminal guiada y curl. |
| **[Insomnia / Inso](https://insomnia.rest/features/insomnia-cli)** | Cliente gráfico y CLI de pruebas/lint de APIs. | [Cliente MCP en Insomnia](https://developer.konghq.com/insomnia/mcp-clients-in-insomnia/); eso no demuestra un servidor que exponga Inso. | Plataforma gráfica más amplia; verificar por separado el control del runner desde agentes. |
| **[Hoppscotch](https://docs.hoppscotch.io/documentation/clients/cli/overview)** | Cliente y colecciones con CLI de tests. | [Servidor oficial](https://github.com/hoppscotch/hoppscotch-mcp-server) conecta agentes a workspaces, colecciones y ambientes. | Ecosistema de equipos y clientes; no confundir gestionar colecciones con ejecutar todos sus tests. |
| **[Thunder Client](https://docs.thunderclient.com/cli)** | Cliente integrado en IDE, pruebas visuales y CLI. | [MCP oficial](https://docs.thunderclient.com/mcp/tools): crear y ejecutar requests. | Rival directo en uso visual y agentes; revisar requisitos de suscripción del CLI. |
| **[Yaak](https://yaak.app/docs/getting-started/cli-usage)** | Cliente local con CLI para personas y agentes. | [MCP documentado](https://yaak.app/docs/getting-started/mcp-server). | Rival directo local con interfaz gráfica; no podemos afirmar que Tsyce sea el único local o accesible a IA. |
| **[Apidog](https://docs.apidog.io/apidog-mcp-server)** | Plataforma de diseño/documentación/pruebas de APIs. | MCP oficial para especificaciones; [cliente MCP](https://docs.apidog.com/en/mcp-client-1930835m0). | Más cobertura del ciclo de API; no equiparar acceso a specs con ejecución de suites. |
| **[Kreya](https://kreya.app/docs/scripting-and-tests/tests/)** | Cliente con scripting, snapshots y CLI/JUnit. | NV para exponer su runner por MCP. | Más opciones gráficas y de pruebas; Tsyce ofrece asistente en terminal y MCP local integrado. |
| **[Hurl](https://hurl.dev/docs/manual.html)** | Requests, asserts y [capturas](https://hurl.dev/docs/capturing-response.html) en archivos de texto, usando libcurl. | NV para un servidor oficial del runner. | Rival técnico muy cercano para pruebas reproducibles y encadenadas; Tsyce añade creación guiada y MCP. |
| **[HTTPie](https://httpie.io/docs/cli/usage)** | HTTP desde terminal, archivos y sesiones. | NV para suites con MCP oficial. | Excelente cliente HTTP; las sesiones no equivalen por sí solas a suites con asserts y JUnit. |
| **[curl](https://curl.se/docs/manpage.html)** | Transferencias, autenticación y archivos desde CLI; automatizable con scripts. | NV para un servidor oficial de suites. | Es el motor de Tsyce; la creación de pruebas, asserts, flujos y reportes se añaden aquí. |
| **[REST Client para VS Code](https://github.com/Huachao/vscode-restclient)** | Requests en `.http`/`.rest`, variables y referencias a respuestas en el editor. | NV para un servidor oficial del runner. | Alternativa para trabajo desde IDE; compara específicamente ejecución CI y validaciones que necesite tu equipo. |

### Frameworks, carga, contratos y monitorización

Estas herramientas cubren necesidades relacionadas; no son sustitutos idénticos de un cliente HTTP.

| Opción y fuente oficial | Fortaleza documentada | Relación con Tsyce e IA |
|---|---|---|
| **[Karate](https://karatelabs.io/)** | Automatización de API, mocks y otros tipos de pruebas. | Mayor alcance. [Karate Agent](https://docs.karatelabs.io/agent/quick-start/) añade integración MCP; distinguirlo del núcleo y revisar licencia/edición. |
| **[REST Assured](https://rest-assured.io/)** | DSL de pruebas REST en Java. | Más flexibilidad programática y dependencia del stack Java; MCP oficial del runner NV. |
| **[Playwright](https://playwright.dev/docs/api-testing)** | Pruebas de API por código, combinables con pruebas web. | Útil para UI + API. La existencia de MCP para navegador no implica que ejecute directamente suites de API guardadas; ese uso NV. |
| **[Tavern](https://tavern.readthedocs.io/en/stable/)** | Tests YAML y ejecución con pytest. | Rival declarativo para equipos Python; servidor MCP oficial del runner NV. |
| **[Robot Framework + RequestsLibrary](https://docs.robotframework.org/docs/different_libraries/requests)** | Pruebas HTTP mediante keywords. | Encaja en automatización existente de Robot; MCP de esta librería para ejecutar suites NV. |
| **[Step CI](https://stepci.com/)** | Flujos YAML/JSON/JS, capturas, variables y ejecución local/CI. | Rival declarativo cercano y más amplio; MCP oficial del runner NV. |
| **[SoapUI / ReadyAPI](https://www.soapui.org/docs/automation/running-functional-tests/)** | Suites de API y ejecución automatizada; especial interés en SOAP. | Mayor cobertura empresarial según edición; integración MCP equivalente NV. |
| **[Grafana k6](https://grafana.com/docs/k6/latest/testing-guides/api-load-testing/)** | Carga/rendimiento de APIs. | [MCP oficial](https://grafana.com/docs/k6/latest/set-up/configure-ai-assistant/tools-prompts-resources/) con ejecución de scripts. Complementa las pruebas funcionales de Tsyce. |
| **[Apache JMeter](https://jmeter.apache.org/usermanual/component_reference.html)** | Planes de carga con samplers HTTP y otros protocolos. | Cubre carga, que Tsyce no implementa; MCP oficial del runner NV. |
| **[Gatling](https://docs.gatling.io/)** | Simulaciones de carga por código. | Complementario para concurrencia y rendimiento; [MCP oficial](https://docs.gatling.io/ai-plugins/mcp-server/) para operaciones de Gatling Enterprise. |
| **[Schemathesis](https://schemathesis.readthedocs.io/en/stable/)** | Genera pruebas y casos límite desde OpenAPI/GraphQL. | Cubre generación basada en contratos y fuzzing que Tsyce no tiene; MCP equivalente NV. |
| **[Pact](https://docs.pact.io/)** | Contratos entre consumidores y proveedores. | Complementario: comprobar un status no verifica un contrato entre servicios; MCP equivalente NV. |
| **[Checkly](https://www.checklyhq.com/product/api-monitoring/)** | Monitorización sintética de APIs y flujos. | [MCP documentado](https://www.checklyhq.com/docs/ai/mcp-server/); ofrece operación alojada que Tsyce no tiene. |

### Evaluación de lo que tenemos

Tsyce ya cubre el recorrido **crear mientras pruebas → guardar → repetir por ambiente →
CI/JUnit → ejecutar desde agentes**, con un mismo motor y sin cuenta cloud. Sus límites
actuales son concretos: captura de un Bearer JSON reservado, sin capturas generales,
interfaz de archivos pendiente, sin OAuth guiado, importación OpenAPI/Postman, runner de
carga, mocks de producto, contratos, colaboración de equipos ni auditoría centralizada.
El servidor de ejemplo no equivale a un producto de mocks.

La hipótesis de diferenciación es la facilidad de convertir una prueba real en un flujo
de terminal compartido entre personas y agentes. No se ha demostrado ventaja en velocidad,
seguridad, coste total o facilidad de uso frente a otras herramientas. Para comprobarla,
la comparación práctica prioritaria es contra **Bruno, Hurl, Thunder Client y Yaak**:
mismo login + token + GET + POST + error intencional, mismo ambiente y CI; medir tiempo
hasta el primer flujo reproducible, pasos manuales, claridad del fallo y manejo de secretos.
Esa prueba entre productos queda pendiente; las capacidades anteriores son documentales.

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
