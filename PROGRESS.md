# Progreso de httpi

Estado de las tareas de `PLAN.md` §10 (MVP) y §15 (v0.2). El detalle de cada fase está allí; aquí solo va el estado.

Marcas: `[ ]` pendiente · `[~]` en curso (con rama) · `[x]` hecha (con commit).

## Fase 0 — Base
- [x] F0.1 Repo: `package.json` (ESM, Node >= 22), TS estricto, vitest, script `check`
- [x] F0.2 CI: GitHub Actions, matriz ubuntu/macos/windows × Node 22/24
- [x] F0.3 Prueba de humo: Ink 8 + ink-testing-library renderizan y leen `lastFrame()`

## Fase 1 — Runner
- [x] F1.1 `runner/detect.ts`: binario de curl y versión mínima 7.83.0
- [x] F1.2 `runner/curl-args.ts`: request → `string[]`
- [x] F1.3 `runner/exec.ts`: spawn, `-w`, `-o`, temporales, errores
- [x] F1.4 Tests de integración con servidor `node:http`: 200 JSON, 404, puerto cerrado, timeout, redirect

## Fase 2 — Formato y `run`
- [x] F2.1 `schema.ts` (zod) y `file.ts` (YAML/JSON)
- [x] F2.2 `asserts.ts`: status, maxTimeMs, headers, json (json-p3)
- [x] F2.3 `reporter/pretty` y códigos de salida 0/1/2/3
- [x] F2.4 `httpi run <archivo>` + tests e2e de códigos de salida

## Fase 3 — Variables y entornos
- [x] F3.1 `vars.ts`: `{{var}}`, `${ENV}`, precedencia
- [x] F3.2 `httpi.env.yaml`, `--env`, `--var`; variable sin resolver → salida 2

## Fase 4 — Importador de curl
- [x] F4.1 `tokenize-bash.ts`
- [x] F4.2 `tokenize-cmd.ts`
- [x] F4.3 `tokenize-powershell.ts`
- [x] F4.4 `detect-dialect.ts` y `--dialect` (el flag `--dialect` se expone en F4.7)
- [x] F4.5 `map-flags.ts` (lista blanca de PLAN §3) con advertencias
- [x] F4.6 Detección de secretos → propuesta de `{{var}}`
- [x] F4.7 `httpi import` + oráculo curlconverter en tests

## Fase 5 — Modo guiado
- [x] F5.1 Reducer puro del asistente (sin Ink) con tests; commit `F5.1: add pure request wizard reducer`
- [x] F5.2 Pantallas Ink: método → URL → headers → body; commit `F5.2: add keyboard-driven Ink request editor`
- [x] F5.3 Menú de asserts a partir de la respuesta real; commit `F5.3: suggest and select response assertions in Ink`
- [x] F5.4 `httpi new` escribe el YAML; commit `F5.4: create API tests with the interactive wizard`

## Fase 6 — Exportar
- [x] F6.1 Exportar curl por dialecto (`curl.exe` en PowerShell); commit `F6.1: export curl scripts for Bash, cmd and PowerShell`
- [ ] F6.2 (Opcional) Exportar a `fetch`

## Fase 7 — CI y publicación
- [x] F7.1 Reporter JUnit; commit `F7.1: add JUnit XML output for CI`
- [x] F7.2 README con ejemplo de GitHub Actions; commit `F7.2: document the CLI with a runnable API and CI example`
- [x] F7.3 Publicar `httpi.schema.json`; commit `F7.3: generate and publish JSON Schema from zod`
- [~] F7.4 `httpi-cli@0.1.0` preparado y tarball instalado/verificado; publicación aplazada por el usuario. Commit `F7.4: prepare httpi-cli 0.1.0 for npm distribution`

## Mejoras solicitadas por el usuario
- [x] U1 Selector visual de métodos HTTP y marco de terminal; commit `U1: add visual HTTP method selection to the request wizard`.
- [x] U2 Ejecución de archivos con respuestas visibles y ejemplo GET/POST por ambiente; commit `U2: show API responses when running request files`.

- [x] U3 Mouse para el asistente, botones y ayudas de headers/body; commit `U3: add mouse controls and explain optional request fields`.

- [x] U4 Varias requests desde el asistente, en un solo YAML y en orden; commit `U4: build ordered multi-request files in the wizard`.

- [x] U5 Capturar el token desde el asistente y reutilizarlo en vivo y al repetir el archivo; commit `U5: capture authentication tokens in the interactive flow`.
- [x] U6 Servidor MCP local para agentes y comparativa de alternativas; commit `U6: expose API test flows through local MCP tools`.

## v0.2 — Proyecto en un solo YAML (`PLAN.md` §15)

### V0 — Preparación
- [x] V0.1 Plan v0.2 en `PLAN.md` §15, alcance en `CLAUDE.md` y fases en este archivo
- [ ] V0.2 Integrar `claude/bold-albattani-fsyz04` a `main` (pull request; pendiente de que el usuario lo pida)

### V1 — Proyecto
- [x] V1.1 `projectFileSchema` y `project.ts`: localizar y leer `httpi.yaml`, expandir `run:` (rutas y patrones)
- [x] V1.2 `httpi run` sin argumentos: ejecuta el proyecto, entornos en `httpi.yaml` (`env.default`), estado compartido entre archivos
- [x] V1.3 `report.junit` y `schema/httpi.project.schema.json` publicado

### V2 — Capturas generales
- [x] V2.1 `capture` como mapa `{ nombre: jsonpath }` (`authToken` conserva su comportamiento)
- [x] V2.2 Variables capturadas compartidas entre archivos y validación previa de referencias

### V3 — Datos
- [x] V3.1 `data.ts`: parser CSV (RFC 4180) y lector JSON → filas
- [x] V3.2 `data` en un test y en `run:`, `{{data.columna}}`, resultados `nombre [fila N]` en los reporters

### V4 — Colaboración por git
- [x] V4.1 Rutas de `body.form` (`@ruta`) y de `data` relativas al YAML que las declara
- [x] V4.2 `httpi.local.yaml` y su precedencia
- [x] V4.3 `httpi init`
- [x] V4.4 `httpi validate`

### V5 — OAuth 2.0
- [x] V5.1 `authSchema`, `request.auth` y flujo `client_credentials`
- [x] V5.2 Flujo `refresh_token`
- [x] V5.3 `authorization_code` + PKCE, `token-store`, `httpi auth login|status`
- [x] V5.4 Asistente `httpi auth add`

### V6 — Importar Postman
- [x] V6.1 `importer/postman.ts`: colección v2.1 → `TestFile[]` + advertencias
- [ ] V6.2 `httpi import --from`, salida a carpeta, entorno Postman → `env`

### V7 — Importar OpenAPI
- [ ] V7.1 `importer/openapi.ts`: operaciones, `servers`, parámetros, `expect.status`
- [ ] V7.2 `$ref` locales, ejemplos de body, `securitySchemes` → `auth`

### V8 — Selector de archivos
- [ ] V8.1 Estado puro del selector con tests
- [ ] V8.2 Componente Ink (teclado y mouse)
- [ ] V8.3 Integración en multipart, datos e importación

### V9 — Cierre
- [ ] V9.1 README y ejemplo completo en `examples/`
- [ ] V9.2 MCP sobre el proyecto
- [ ] V9.3 Medir tiempo de arranque y sobrecosto frente a curl directo

## Decisiones
Una línea por decisión que no esté en `PLAN.md`: fecha, qué, por qué.

- 2026-11-12 — Node >= 22; parser de curl propio para Bash + cmd + PowerShell; nombre npm pendiente.
- 2026-11-12 — F0.1: `"private": true` hasta decidir el nombre en npm (evita un publish accidental); `tsconfig.json` revisa `src` + `test` sin emitir y `tsconfig.build.json` emite solo `src` a `dist`; `src/cli.ts` es un stub (sale 2) hasta F2.4.
- 2026-11-12 — La fase 0 se trabaja en la rama `claude/bold-albattani-fsyz04` (asignada por la sesión) en vez de `fase-0-<slug>`.
- 2026-11-12 — F0.3: `ink-testing-library` 4.0.0 funciona con Ink 8.0.0 + React 19.3 (`render`, `lastFrame()`, `stdin.write()`); el riesgo de PLAN §11 queda descartado, no hace falta el plan B.
- 2026-11-12 — F1.1: el helper `spawnCollect` y `CurlUnavailableError` viven en `runner/exec.ts` (único lugar que hace `spawn`); `detect.ts` los importa.
- 2026-11-12 — F1.2: el esquema de `request` nace ya en `schema.ts` (el tipo sale de zod); opciones planas en `request` (`followRedirects`, `insecure`, `compressed`, `timeoutMs`); body `{ json }` o `{ text }`. `curl-args` siempre añade `--globoff` y `--url` (URL literal), y solo pasa `--request` cuando el método no es el que curl ya infiere.
- 2026-11-12 — F1.3: `runRequest` pasa `-q` (ignora `~/.curlrc`) para que la prueba sea reproducible; un fallo de curl no lanza excepción: devuelve `status: 0`, `curlExitCode` y `error`. El body se devuelve como texto UTF-8.
- 2026-11-12 — F2.1: objetos estrictos (clave desconocida = error, no se ignora); `expect` es opcional (sin asserts el test solo exige que curl obtenga respuesta); cada assert JSON lleva `path` y exactamente un comparador; `contains` acepta cualquier valor JSON.
- 2026-11-12 — F2.2: si un `path` coincide con varios nodos, el comparador debe cumplirse en todos (y debe haber al menos uno); `equals` no convierte tipos; en headers basta con que un valor del header coincida; un `path` que no compila como JSONPath es error de archivo (salida 2), no assert fallido.
- 2026-11-12 — F2.3: archivo nuevo `src/core/run.ts` (no está en el mapa de PLAN §9): tipo `TestOutcome`, códigos de salida y, desde F2.4, el bucle que ejecuta un archivo. Si hay a la vez error de red y assert fallido, gana la salida 3. El reporter muestra todos los asserts, no solo los fallidos.
- 2026-11-12 — F2.4: `check` ahora es typecheck → build → tests, porque los e2e ejecutan `dist/cli.js`. Los errores de uso de commander salen con 2 (no 1). `httpi run` recibe un solo archivo; el reporte va a stdout y los errores a stderr; color solo en TTY y sin `NO_COLOR`.
- 2026-11-12 — F3.1: `{{nombre}}` busca en `--var`, luego en el entorno del sistema y luego en `httpi.env.yaml`; `${NOMBRE}` solo lee el entorno del sistema. Se sustituye en cualquier valor de texto del test (también en `expect`), nunca en claves; los valores no se vuelven a expandir.
- 2026-11-12 — F3.2: `httpi.env.yaml` se busca junto al archivo de test y, si no está, en el directorio actual; solo se lee si se pasa `--env`. `--var` es repetible y se parte en el primer `=`. Entorno inexistente, `--var` mal formado y variable sin resolver salen con 2.
- 2026-11-12 — F4.1: los tokenizadores no expanden `$VAR` ni sustituciones: quedan como texto. Comilla sin cerrar lanza `ShellSyntaxError` (definido en `tokenize-bash.ts`, lo reutilizan los otros dialectos). La tabla de Bash se contrastó a mano contra `bash` real (15 entradas, 0 diferencias).
- 2026-11-12 — F4.2: el tokenizador de cmd aplica dos pasos, como Windows: primero los `^` de cmd.exe y luego el reparto de argumentos del runtime de C (`\"`, `""`, barras antes de comilla). `%VAR%` queda como texto. No se pudo contrastar con un Windows real.
- 2026-11-12 — F4.3: el tokenizador de PowerShell devuelve el texto que el usuario quiso escribir; no imita el bug de Windows PowerShell 5.1 que pierde las comillas dobles internas al llamar a un `.exe`. `$var` y `$env:X` quedan como texto. No se pudo contrastar con un PowerShell real.
- 2026-11-12 — F4.4: detección de dialecto por señales, de más a menos fuerte: carácter de continuación al final de línea, comillas propias de un shell (`^"`, `` `" ``, `$env:`), nombre `curl.exe`; sin señales se lee como Bash.
- 2026-11-12 — F4.5: nuevo body `{ form: [...] }` (expresiones `-F` de curl tal cual) para representar multipart. `-u` se convierte en header `Authorization: Basic …`; `-b`, `-A`, `-e` en headers. El body importado siempre se guarda como `{ text }` sin re-serializar. Todo flag fuera de la lista blanca avisa, incluidos `-s`/`-S`/`-v`; hay una lista de flags de curl con valor solo para saltar su valor y no confundirlo con la URL. `@archivo` en `-d`/`-b` avisa y se ignora.
- 2026-11-12 — F4.6: se consideran secretos los headers `Authorization` y `Cookie` (cubre `-u` y `-b`). Variables propuestas: `token` (Bearer), `basicAuth` (Basic), `authorization` (otros) y `cookie`. `extractSecrets` vive en `map-flags.ts`.
- 2026-11-12 — F4.7: `httpi import [archivo]` lee el curl de un archivo o de stdin y escribe YAML a stdout o a `-o` (no pisa un archivo existente). Por defecto sustituye los secretos por `{{variable}}` y avisa por stderr sin mostrar el valor; `--keep-secrets` los deja. El test importado sale sin `expect` (no se inventa un status). curl real rechaza `--flag=valor`: se lee igual (PLAN §3) pero con advertencia. Oráculo: 25 comandos Bash coinciden con curlconverter (PLAN §8 hablaba de ~50 curls reales).

- 2026-11-11 — El usuario autoriza adelantar F6.1 mientras falta el prototipo de F5; se continúa en `claude/bold-albattani-fsyz04` por instrucción explícita.
- 2026-11-11 — F6.1: `httpi export <archivo> --dialect bash|cmd|powershell` exporta todas las requests a stdout, con `--env` y `--var` y sin asserts. Reutiliza `buildCurlArgs`; salida contiene los secretos resueltos. Bash genera un comando; cmd un script `.cmd` (porcentajes duplicados y expansión retardada desactivada), no una línea para pegar en el prompt. PowerShell requiere 7.3+ y `Standard` para preservar comillas al invocar `curl.exe`. NUL se rechaza en todos; saltos de línea literales se rechazan en cmd con salida 2.
- 2026-11-11 — F6.1: comprobación local en Linux/Node 24: 381 tests, typecheck y build; ejecución real Bash/curl conserva URL, headers y body. Los e2e ejecutan también cmd y PowerShell en Windows dentro de la matriz CI; matriz completa en verde sobre `0d6d3fc`.

- 2026-11-11 — El usuario autoriza completar F5 sin el prototipo y continuar el proyecto; nombre elegido para npm: `httpi-cli`. Se conserva la rama indicada.

- 2026-11-11 — F5 completa sin prototipo: formulario con Enter/Tab y Esc; confirmación explícita antes de enviar, asserts seleccionables desde respuesta real y guardado YAML sin sobrescribir. `httpi new [archivo] --name ...` requiere TTY; Authorization/Cookie se extraen a variables igual que al importar. Ctrl+C aborta curl. Verificación local: 406 tests y recorrido manual en TTY que guardó y ejecutó un test con éxito.

- 2026-11-11 — CI F5.4: las pruebas de Ink leían callbacks tras una espera fija; se cambia a esperar la condición `toHaveBeenCalledOnce` sin subir timeouts, saltar tests ni relajar asserts. La espera de callbacks no bastó en CI; se usa además `act()` para vaciar los efectos pasivos antes de escribir teclas (la pantalla visible precede a la suscripción de entrada). Verificación local: 414 tests; CI corregida: seis jobs en verde sobre `8cd1e48` (Ubuntu/macOS/Windows × Node 22/24).

- 2026-11-11 — F7.4: nombre `httpi-cli`, versión 0.1.0 y bin `httpi`; prepack ejecuta check. Tarball verificado: 29 archivos, ~28 kB; instalación aislada con dependencias de producción, `run --reporter junit` y asistente Ink probados. El usuario decide dejar la publicación npm pendiente; no se ha publicado. F6.2 (`fetch`) continúa opcional y pendiente.

- 2026-11-11 — U1/U2 solicitadas explícitamente por el usuario: métodos visibles con selección por flechas y marco de terminal inspirado en la referencia; `run --show-response` muestra status, headers repetidos y body junto a los asserts sin interacción. JUnit rechaza ese flag con salida 2. `examples/requests.yaml` contiene GET y POST contra el servidor local, que responde al POST sin persistir. Verificado con 422 tests, navegación en TTY y ejecución real del archivo (2 tests pasaron).

- 2026-11-11 — El usuario solicita explícitamente mouse en el asistente; se incorpora U3 como excepción al alcance inicial de solo teclado. Se usa SGR en pantalla alternativa, sin dependencias nuevas; la publicación npm sigue aplazada.

- 2026-11-11 — U3: clics en métodos, navegación, presets JSON, envío, asserts y guardado; rueda para formularios altos y opciones. Las posiciones se miden al recibir el evento y se ajustan al scroll. El parser admite secuencias fragmentadas e ignora eventos de mouse dentro de pegados delimitados. Se restauran mouse y pantalla al salir. Sin dependencias nuevas. Verificado con 432 tests y recorrido SGR en TTY: POST 201, YAML guardado y ejecutado correctamente; un doble clic de reintento no duplica requests.

- 2026-11-11 — U4: `httpi new` agrega requests al flujo con Add request; el resumen permite Add another request o Save file. Las requests se guardan y ejecutan en el orden de creación. Cancelar una posterior conserva las anteriores en el resumen. Mismo secreto = misma variable; valores distintos reciben variables distintas sin colisionar con referencias existentes. `--name` conserva el nombre de test único y nombra el archivo en colecciones. Verificado con 437 tests y recorrido CLI real de dos requests (ambas pasaron); guardar no vuelve a enviarlas.

- 2026-11-12 — U5 solicitada por el usuario: se autoriza la captura de tokens como excepción al alcance inicial. El asistente permite seleccionar un campo JSON del login y añadir Authorization Bearer en las siguientes requests; guarda solo `capture.authToken` y la referencia, nunca el token capturado. Cada ejecución autentica de nuevo y detiene el flujo si falla el login, sus asserts o la extracción. La variable reservada no cae a tokens antiguos; los reportes ocultan la respuesta de autenticación y redactan tokens capturados. Capturas limitadas a Bearer JSON, sin OAuth ni scripting; exportación curl estática rechazada para estos flujos. Demo local de login/ruta protegida y GIF actualizados. Verificado: 457 tests, CLI real y recorrido con mouse que guarda y repite el flujo con un token nuevo. Publicación npm sigue aplazada.

- 2026-11-12 — U6 solicitada por el usuario: servidor MCP local por stdio, sin dependencias nuevas; herramientas list_tests, inspect_test, create_test y run_test sobre el motor existente. Protocolo con inicialización 2025-11-25 y negociación de tres versiones anteriores; no HTTP/OAuth/tareas MCP. Root obligatorio con comprobación de rutas reales; permisos de escritura/ejecución, orígenes y ambientes fijados al arrancar, sin escalado por el agente. MCP rechaza redirects, multipart y authToken en URLs; timeout por request máximo 30 s. Resultados estructurados omiten bodies, headers, valores esperados y diagnósticos con datos; inspección devuelve metadatos y requiere no poner secretos en sus nombres/rutas. No es un sandbox de SO ni configura automáticamente clientes. Se corrige la redacción del runner que alteraba claves estructurales con tokens cortos. Verificado con 468 tests y cliente oficial @modelcontextprotocol/sdk instalado solo temporalmente fuera del proyecto: descubrimiento, creación y dos ejecuciones con autenticación nueva. README incluye configuración Windows y comparación documental de 25 alternativas con fuentes oficiales, sin atribuir exclusividad MCP ni inventar benchmarks. Publicación npm sigue aplazada.

- 2026-11-12 — v0.2: el usuario aprueba ejecutar el plan preparado en el chat de planificación ("httpi: plan de arquitectura y research"); queda como `PLAN.md` §15. OAuth, importación OpenAPI/Postman, capturas generales y mouse dejan de estar fuera de alcance. Sin dependencias nuevas (CSV y OAuth con módulos de Node). No se abre pull request a `main` hasta que el usuario lo pida.
- 2026-11-12 — V1.1: `httpi.yaml` se busca en el directorio actual y hacia arriba (gana el más cercano). Las rutas de `run:` son relativas a `httpi.yaml`; una ruta inexistente o un patrón sin coincidencias es error (salida 2), no una corrida vacía; un archivo listado dos veces corre dos veces. Patrones con `fs.glob` de Node.
- 2026-11-12 — V1.2: `httpi run` sin argumento (o con la ruta de un `httpi.yaml`) ejecuta el proyecto como un solo flujo: el token capturado en un archivo vale para los siguientes y un login fallido detiene todo el proyecto (los archivos no alcanzados salen como "not run"). Todas las variables se validan antes de enviar nada. Entorno: `--env` o `env.default`; si `httpi.yaml` declara `env`, `httpi.env.yaml` se ignora con aviso; si no, se sigue leyendo. `httpi run <archivo>` no cambia y no consulta `httpi.yaml` (no se hizo la delegación de `readEnvironment` que mencionaba el plan, para no alterar el comportamiento actual). Título de cada archivo en el reporte: su `name` o su ruta relativa; el `name` del proyecto aún no se muestra.
- 2026-11-12 — V1.3: `report.junit` se escribe en cada corrida del proyecto (ruta relativa a `httpi.yaml`, crea la carpeta y reemplaza el reporte anterior), además del reporte elegido por stdout y también cuando hay fallos. No se escribe si la corrida se aborta antes de enviar (salida 2).
- 2026-11-12 — V2.1: `capture` es un mapa `nombre: JSONPath`. Cada ruta debe seleccionar exactamente un texto, número o booleano (se guarda como texto). Un test con `capture` es requisito de lo que sigue: si la request falla, sus asserts fallan o una captura no se obtiene, el flujo se detiene (salida 1). Un nombre capturado queda reservado en toda la corrida: no cae a `--var` ni al sistema antes de capturarse. Solo `authToken` oculta la respuesta y se redacta. En MCP un valor capturado no puede usarse en la URL (decidiría el destino en tiempo de ejecución).
- 2026-11-12 — V2.2: no requirió código nuevo: el bucle multiarchivo de V1.2 y la reserva de nombres de V2.1 ya comparten capturas entre archivos y validan el orden antes de enviar; se añadieron los e2e que lo fijan.
- 2026-11-12 — V3.1: CSV separado por comas con cabecera obligatoria; los espacios forman parte del valor; las líneas en blanco se saltan; cada fila debe tener tantos campos como la cabecera. JSON: lista de objetos planos (texto, número o booleano; `null` y anidados se rechazan). Los nombres de columna deben servir como `{{data.<nombre>}}`. Todo error de datos es `TestFileError` (salida 2) con archivo y línea.
- 2026-11-12 — V3.2: `data` en un test (ruta relativa al archivo de prueba) lo repite por fila con el sufijo ` [row N]`; `data` en una entrada de `run:` (relativa a `httpi.yaml`) repite el archivo entero y cada fila es una suite `título [row N]`. `{{data.columna}}` solo lee la fila actual (nunca `--var` ni el sistema). Las filas se validan todas antes de enviar. `httpi export` y MCP rechazan tests con `data` en vez de ejecutarlos una sola vez.
- 2026-11-12 — V4.1: cambio de comportamiento: en `httpi run`, las rutas relativas de `body.form` (`campo=@ruta`, `campo=<ruta`, varias con coma, con `;type=`) se resuelven contra la carpeta del YAML, después de sustituir variables; antes eran relativas al directorio actual. Rutas absolutas y `@-` no cambian. `httpi export` y el asistente `httpi new` siguen usando la ruta tal como está escrita.
- 2026-11-12 — V4.2: `httpi.local.yaml` es un mapa plano `nombre: valor` junto a `httpi.yaml`, sin entornos; se lee solo en corridas de proyecto (no en `httpi run <archivo>`). Precedencia de `{{nombre}}`: capturas > `--var` > sistema > local > entorno. `${NOMBRE}` sigue leyendo solo el sistema.
- 2026-11-12 — V4.3: `httpi init [directorio]` crea `httpi.yaml` (entorno `dev`, `run: tests/*.yaml`, `report.junit`), `tests/example.yaml`, `data/.gitkeep`, `.github/workflows/httpi.yml` y añade a `.gitignore` `.httpi/`, `httpi.local.yaml` y `reports/` (este último no estaba en el plan; evita versionar reportes generados). No reemplaza archivos; si ya hay `httpi.yaml` sale con 2. El workflow generado es propio (no copia `examples/github-actions.yml`, que compila este repositorio) y usa `npx httpi-cli run`: no funcionará hasta publicar el paquete en npm (F7.4).
- 2026-11-12 — V4.4: `httpi validate` (solo proyecto) no envía requests y lista todos los problemas por stdout: esquema de cada archivo, archivos de datos, archivos de multipart inexistentes, credenciales literales en `Authorization`/`Cookie` (sin mostrar el valor) y variables sin resolver; sale 0 o 2. Las referencias `${NOMBRE}` no cuentan como problema porque los secretos de CI no existen donde se valida; `{{nombre}}` sí debe resolverse con `--var`, sistema, `httpi.local.yaml`, el entorno, capturas o datos. `validateRunVariables` ahora reúne las variables sin resolver de toda la corrida en un solo error (antes paraba en el primer test).
- 2026-11-12 — V5.1: `auth` en `httpi.yaml` (nombre → bloque `oauth2`) y `request.auth: <nombre>` en los tests. En una corrida de proyecto se pide un token por cada nombre usado, una sola vez y antes de la primera prueba; se envía como `Authorization: Bearer` y se redacta en los reportes. El cliente se identifica con HTTP Basic por defecto o con `clientAuth: body`. Si el endpoint de tokens falla o no responde, la corrida no empieza y sale con 3 (solo se muestran `error` y `error_description`, nunca el cuerpo). Nombre de `auth` inexistente, o `auth` junto a un header `Authorization`, salen con 2. `auth` solo funciona en corridas de proyecto: `httpi run <archivo>`, `httpi export` y MCP lo rechazan.
- 2026-11-12 — V5.2: `flow: refresh_token` canjea `refreshToken` (pensado para `${VAR}`) al inicio de cada corrida. Sin `clientSecret` se trata como cliente público (solo `client_id` en el body). Limitación: si el servidor rota el refresh token en cada canje, httpi no guarda el nuevo; ese caso necesita `authorization_code` en local (V5.3) o un refresh token no rotatorio en CI.
- 2026-11-12 — V5.3: `flow: authorization_code` con PKCE (S256) y `state`; callback en `http://127.0.0.1:<redirectPort>/callback` (por defecto 8787; hay que registrarlo en el proveedor). `httpi auth login <nombre>` imprime la URL y abre el navegador (`open`/`xdg-open`/`rundll32`, sin shell; `HTTPI_NO_BROWSER=1` lo evita), espera hasta 5 minutos y guarda el resultado en `.httpi/tokens.json` (permisos 600 donde aplican) junto a `httpi.yaml`. `httpi run` usa el token guardado hasta 30 s antes de caducar; si caducó lo renueva con el refresh token y guarda el nuevo (también si el servidor lo rota). Sin sesión, sesión caducada sin refresh token o proveedor que rechaza → salida 3 con el comando a ejecutar. `httpi auth status` lista los bloques sin mostrar tokens. Sin verificar: el login con un navegador real y un proveedor real; en los tests el "navegador" es una petición al callback contra un proveedor falso.
- 2026-11-12 — V5.4: `httpi auth add` (solo teclado, requiere TTY) pregunta nombre, flujo, URLs, client id, scopes y, para los secretos, el NOMBRE de la variable de entorno: en el YAML solo queda `${NOMBRE}` y rechaza algo que parezca el secreto. En `authorization_code` y `refresh_token` el secreto vacío significa cliente público. El bloque se inserta en `httpi.yaml` conservando comentarios y no pisa un nombre existente. La lógica es un reducer puro en `auth-wizard.tsx`. Verificado también en un pseudo-terminal real.
- 2026-11-12 — V6.1: `importPostman` acepta colecciones v2.0/v2.1: un archivo por carpeta de primer nivel (las subcarpetas pasan al nombre del test, `Sub / Request`) y uno más para las requests sueltas. `{{var}}` se conserva; `:id` de la ruta se sustituye por su valor guardado o queda como `{{id}}`. Auth heredada colección → carpeta → request: bearer y basic pasan a `Authorization`, apikey a header o query, oauth2 (`client_credentials`, `authorization_code`) a un bloque `auth` del proyecto sin copiar nunca el client secret ni el token guardado. Avisan y no se convierten: scripts, GraphQL, body `file`, otros tipos de auth y grants. Los tests importados salen sin `expect`. Reutiliza `CurlImportError` como error de importación. El fixture es una colección escrita a mano con el formato v2.1, no exportada de Postman.

## Backlog (fuera de la tarea actual)
Ideas que surgieron y no se hicieron. No implementar sin aprobación.

- Headers repetidos (mismo nombre varias veces): `headers` es un mapa y no los representa.
- Cuerpos de respuesta binarios: `RunResult.body` es texto UTF-8.
- `httpi run` con varios archivos o un directorio.
- `httpi --version`.
- Escape para escribir `{{` o `${` literales en un test.
- Al importar, convertir `$VAR` de Bash en `${VAR}` de httpi.
- Importador: `-I`/`--head` como método HEAD (hoy avisa como no soportado); leer `-d @archivo`; nombres largos abreviados de curl.
- Tratar como secretos otros headers habituales (`X-Api-Key`, `Proxy-Authorization`) y parámetros de la URL (`?api_key=`).
- `httpi import --run`: ejecutar la request una vez y proponer `expect.status` con el status real.
- `httpi import --force` para sobrescribir el archivo de salida.

## Bloqueos
Qué impide avanzar y qué se necesita del usuario.

- Publicación npm aplazada por el usuario; el tarball de 0.1.0 está preparado. No se requiere el prototipo de Ink: F5 se completó desde cero por instrucción del usuario.
- Los fixtures de `test/fixtures/curl/` están escritos a mano con el formato de DevTools, no copiados de un navegador real. Hace falta que el usuario pegue curls reales ("Copy as cURL (bash)" y "(cmd)") para validar el riesgo de comillas de PLAN §11.
- Sin verificar en cmd: cómo escapa DevTools una barra invertida dentro del body (p. ej. `\n` en JSON) en "Copy as cURL (cmd)". Se quitó ese caso del fixture inventado hasta tener un pegado real.
- Decisión pendiente del usuario: `{{nombre}}` consulta el entorno del sistema antes que `httpi.env.yaml` (precedencia de PLAN §4). En Windows las variables de entorno no distinguen mayúsculas, así que un `{{path}}` o `{{username}}` del archivo de entornos quedaría tapado por el del sistema.
