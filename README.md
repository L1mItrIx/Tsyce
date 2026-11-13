# httpi

Pega un curl o responde unas preguntas y obtén una prueba de API lista para CI.
httpi usa el curl de tu sistema: el asistente y el runner ejecutan la misma request.
Un `httpi.yaml` reúne entornos, autenticación, datos y qué ejecutar: en CI basta `httpi run`.

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

## Un proyecto en un solo YAML

```bash
httpi init mi-api        # httpi.yaml, tests/, data/, workflow de CI y .gitignore
cd mi-api
httpi validate           # revisa todo sin enviar requests (útil en pull requests)
httpi run                # ejecuta el proyecto del httpi.yaml más cercano
```

El workflow que crea `httpi init` ejecuta `npx --yes httpi-cli run`: funcionará cuando
el paquete esté publicado en npm; mientras tanto, instala httpi desde el código fuente.

[examples/proyecto](examples/proyecto) es un proyecto completo listo para la API de
ejemplo: inicia `node examples/server.mjs` y ejecuta
`DEMO_CLIENT_SECRET=demo-secret httpi run` dentro de esa carpeta.

```yaml
version: 1
name: API de ejemplo
env:
  default: local                  # el que se usa sin --env
  environments:
    local: { baseUrl: "http://127.0.0.1:3000" }
    staging: { baseUrl: "https://staging.example.com" }
auth:
  demo:                           # los tests lo usan con `auth: demo`
    type: oauth2
    flow: client_credentials
    tokenUrl: "{{baseUrl}}/oauth/token"
    clientId: demo-client
    clientSecret: ${DEMO_CLIENT_SECRET}   # secretos siempre desde el entorno
run:
  - tests/salud.yaml
  - file: tests/usuarios.yaml     # se repite una vez por fila del CSV
    data: data/usuarios.csv
  - tests/admin/*.yaml            # patrón: archivos en orden alfabético
report:
  junit: reports/junit.xml        # se escribe en cada corrida, también si falla
```

- **Un solo flujo.** Los archivos corren en el orden de `run:`. Lo que un test captura
  sirve a los siguientes, también en otros archivos. Si una captura o un login falla,
  el resto no se ejecuta y el reporte lo marca como *not run*. Antes de enviar nada se
  comprueban todas las variables, filas de datos y nombres de `auth`.
- **`httpi run <archivo>`** sigue ejecutando un archivo suelto, sin leer `httpi.yaml`.
- **Valores personales.** `httpi.local.yaml` (fuera de git, lo añade `httpi init`) guarda
  `nombre: valor` para tu máquina. En un proyecto, `{{nombre}}` busca en
  `--var` > entorno del sistema > `httpi.local.yaml` > entorno de `httpi.yaml`.
- **`httpi validate`** lista todos los problemas a la vez y sale con 0 o 2: esquema,
  archivos de datos y de multipart inexistentes, credenciales literales en
  `Authorization`/`Cookie` (sin mostrar su valor) y variables sin valor. Las referencias
  `${NOMBRE}` no se reportan: se espera que el CI las defina como secretos.

### Capturas

```yaml
tests:
  - name: Crear usuario
    request: { method: POST, url: "{{baseUrl}}/users", body: { json: { name: Ana } } }
    expect: { status: 201 }
    capture:
      userId: $.id              # cualquier texto, número o booleano de la respuesta
  - name: Consultar usuario
    request: { url: "{{baseUrl}}/users/{{userId}}" }
```

Cada ruta debe seleccionar exactamente un valor. Un nombre capturado no toma valores
antiguos de `--var` ni del sistema. `authToken` es especial: oculta la respuesta del
login y redacta el token en los reportes.

### Datos desde CSV o JSON

`data` en un test (ruta relativa al test) lo repite por fila con el sufijo `[row N]`;
`data` en una entrada de `run:` (relativa a `httpi.yaml`) repite el archivo completo.
Las columnas se usan como `{{data.columna}}`. El CSV lleva cabecera y admite comillas,
comas y saltos de línea dentro de comillas; el JSON es una lista de objetos planos.
Una fila que falla no detiene las demás. Las rutas `@archivo` de un body multipart
también son relativas al YAML que las declara.

### OAuth 2.0

| Flujo | Para | Cómo |
|---|---|---|
| `client_credentials` | CI | httpi pide el token al empezar la corrida. HTTP Basic por defecto; `clientAuth: body` lo manda en el formulario. |
| `refresh_token` | CI en nombre de una persona | Canjea `refreshToken: ${VARIABLE}` al empezar. Sin `clientSecret` es un cliente público. |
| `authorization_code` + PKCE | Tu máquina | `httpi auth login <nombre>` abre el navegador y recibe el código en `http://127.0.0.1:8787/callback` (cambia el puerto con `redirectPort`). |

```bash
httpi auth add               # asistente: escribe el bloque en httpi.yaml (solo nombres de variables)
httpi auth login demo        # solo authorization_code
httpi auth status            # estado de cada bloque, sin mostrar tokens
```

El login guarda el token en `.httpi/tokens.json` junto a `httpi.yaml` (permisos 600
donde el sistema los admite; en Windows queda en tu carpeta de usuario sin ese
permiso). `httpi run` lo renueva con su refresh token cuando caduca. Si no hay sesión
o el proveedor rechaza la petición, la corrida no empieza y sale con 3. Los tokens
se redactan en los reportes y nunca se escriben en el YAML. No incluye device code,
JWT bearer ni mTLS. `auth` solo funciona dentro de un proyecto.

### Rendimiento

`node scripts/bench.mjs` mide contra un servidor local. En el contenedor Linux de
desarrollo (Node 22, curl 8.5, mediana de 20 corridas): `httpi --help` tarda 148 ms
(Node solo, 25 ms); una request con 2 asserts, 195 ms frente a 7 ms de `curl`;
10 requests en un archivo, 300 ms frente a 71 ms de 10 llamadas a `curl`. El coste
está sobre todo en el arranque (~120 ms) y luego ~12 ms por request. No se ha medido
en macOS ni en Windows.

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

**Attach a file** (o Ctrl+O en Body) abre un explorador de archivos: el archivo elegido
se envía como campo multipart `file` y se guarda con una ruta relativa al YAML. En la
confirmación, **Repeat over a data file** (o `d`) elige un CSV o JSON: la request en
vivo usa la primera fila y el test guardado se repite por cada fila. El explorador
funciona con flechas, Enter, ← para subir de carpeta, Esc para cancelar y con el mouse.

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

El asistente captura tokens Bearer de una respuesta JSON; para capturar otros valores
escribe `capture: { nombre: <JSONPath> }` en el YAML (ver *Capturas*). El exportador
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
| `list_tests` | `{}` | Rutas relativas de flujos YAML/JSON válidos y de los proyectos `httpi.yaml`; excluye archivos de entorno y de valores locales. |
| `inspect_test` | `{ "file": "auth.yaml" }` | Orden, método, URL sin query/credenciales, nombres de headers, tipo de body y cantidad de asserts; omite valores de headers/body/asserts. Con `httpi.yaml`: archivos que ejecuta, entornos y nombre/flujo de cada bloque `auth`. |
| `create_test` | `{ "file": "nuevo.yaml", "testFile": { "version": 1, "tests": [...] } }` | Valida y crea el archivo, sin sobrescribir ni ejecutarlo. Extrae Authorization/Cookie a variables como el asistente. |
| `run_test` | `{ "file": "auth.yaml", "env": "dev", "variables": {} }` | `exitCode`, resumen, orden, status HTTP, tiempo y resultado booleano de cada assert. Autentica y captura tokens con el motor habitual. Con `httpi.yaml` ejecuta el proyecto entero (capturas, filas de datos y tokens OAuth) e indica el archivo de cada resultado. |

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
- Esta versión MCP rechaza redirects, multipart y valores capturados en URLs; limita
  cada request a 30 segundos. En un proyecto se comprueba cada request planificada
  (fila por fila) y cada endpoint de tokens; el entorno que se usaría, el pedido o
  `env.default`, debe estar en `--allow-env`. `httpi.local.yaml` no se puede leer por MCP.
  Para uploads y diagnóstico completo usa el CLI.
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
| **Tsyce / httpi** | Asistente de terminal con mouse; proyecto en un `httpi.yaml`; curl real; ambientes, capturas, datos CSV/JSON, OAuth 2.0, importación curl/Postman/OpenAPI, CLI/JUnit. | Servidor local de cuatro herramientas sobre los mismos flujos y proyectos. | Local y basado en git; sin colaboración alojada ni scripting general. npm aún sin publicar. |
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

Tsyce ya cubre el recorrido **importar o crear mientras pruebas → guardar → repetir por
ambiente y por fila de datos → CI/JUnit → ejecutar desde agentes**, con un mismo motor y
sin cuenta cloud. Sus límites actuales son concretos: sin runner de carga, mocks de
producto, contratos, ejecución en paralelo, scripting, colaboración alojada ni auditoría
centralizada (la colaboración es por git). El servidor de ejemplo no equivale a un
producto de mocks.

La hipótesis de diferenciación es la facilidad de convertir una prueba real en un flujo
de terminal compartido entre personas y agentes. No se ha demostrado ventaja en velocidad,
seguridad, coste total o facilidad de uso frente a otras herramientas. Para comprobarla,
la comparación práctica prioritaria es contra **Bruno, Hurl, Thunder Client y Yaak**:
mismo login + token + GET + POST + error intencional, mismo ambiente y CI; medir tiempo
hasta el primer flujo reproducible, pasos manuales, claridad del fallo y manejo de secretos.
Esa prueba entre productos queda pendiente; las capacidades anteriores son documentales.

## Importar un curl, una colección Postman o un documento OpenAPI

```bash
httpi import curl.txt -o usuarios.yaml
httpi import curl.txt --dialect cmd -o usuarios.yaml
httpi import coleccion.postman_collection.json -o mi-api --environment staging.postman_environment.json
httpi import openapi.yaml -o mi-api
httpi import --pick -o mi-api      # elige el archivo en un explorador
```

httpi detecta qué recibe; `--from curl|postman|openapi` lo fuerza. Una colección o un
documento OpenAPI generan un proyecto: los tests van a `mi-api/tests/` y el entorno y
los bloques `auth` a `mi-api/httpi.yaml`, que se crea o se completa sin reemplazar lo
que ya tenga. Nunca se sobrescriben tests existentes.

- **Postman v2.0/v2.1**: un archivo por carpeta de primer nivel; `{{variables}}` y la
  autenticación heredada (bearer, basic, API key, OAuth 2.0) se conservan. El client
  secret y los tokens guardados en la colección nunca se copian.
- **OpenAPI 3.0/3.1**: un test por operación y un archivo por tag; `baseUrl` sale de
  `servers`, el status esperado es el primer 2xx documentado, los bodies salen de los
  ejemplos o se arman desde el esquema, y la seguridad pasa a variables o a bloques `auth`.
- Todo lo que no se convierte (scripts de Postman, GraphQL, Swagger 2, `$ref` remotos,
  flujos OAuth implicit o password…) se avisa por stderr, nunca se descarta en silencio.

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

`{{nombre}}` busca en **`--var` > entorno del sistema > archivo de entornos**
(en un proyecto, `httpi.local.yaml` va justo antes del entorno de `httpi.yaml`).
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
compila httpi, inicia la API local, ejecuta la prueba y el proyecto de
[examples/proyecto](examples/proyecto) (con `httpi validate` antes) y sube los XML
incluso si fallan asserts. En tu propio proyecto puedes usar el mismo comando contra tu API, sin el
servidor de ejemplo. JUnit distingue `<failure>` (assert) de `<error>` (transporte).

`npm run check` comprueba tipos, compila y ejecuta los tests. La CI del proyecto usa
Ubuntu, macOS y Windows con Node 22 y 24; incluye curl real y pruebas de teclado de Ink.
Las fixtures de importación todavía no se han contrastado con pegados reales de
DevTools en Windows. Los secretos enviados a curl viajan en argumentos visibles en
la lista de procesos del sistema.

## Autocompletado del YAML

El esquema publicado en [schema/httpi.schema.json](schema/httpi.schema.json) se
genera desde zod en cada `npm run build`; el de `httpi.yaml` está en
[schema/httpi.project.schema.json](schema/httpi.project.schema.json). Con la extensión YAML de VS Code,
añade un comentario al inicio del test (ajusta la ruta a tu archivo):

```yaml
# yaml-language-server: $schema=./schema/httpi.schema.json
```

También puedes usar la URL raw del esquema en GitHub. No añadas una propiedad
`$schema` al test: el formato rechaza claves desconocidas. Las comprobaciones
personalizadas de JSONPath y regex se realizan al ejecutar httpi; el esquema del
editor no sustituye la validación del runner.

No incluye GraphQL/gRPC, ejecución en paralelo, scripting, reportes HTML ni un servidor de colaboración.
Consulta [PROGRESS.md](PROGRESS.md) para el avance y las limitaciones pendientes.
