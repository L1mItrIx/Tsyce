# Progreso de httpi

Estado de las tareas de `PLAN.md` §10. El detalle de cada fase está allí; aquí solo va el estado.

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
- [ ] F5.3 Menú de asserts a partir de la respuesta real
- [ ] F5.4 `httpi new` escribe el YAML

## Fase 6 — Exportar
- [x] F6.1 Exportar curl por dialecto (`curl.exe` en PowerShell); commit `F6.1: export curl scripts for Bash, cmd and PowerShell`
- [ ] F6.2 (Opcional) Exportar a `fetch`

## Fase 7 — CI y publicación
- [ ] F7.1 Reporter JUnit
- [ ] F7.2 README con ejemplo de GitHub Actions
- [ ] F7.3 Publicar `httpi.schema.json`
- [ ] F7.4 Decidir nombre en npm (pendiente del usuario) y `npm publish`

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
- 2026-11-11 — F6.1: comprobación local en Linux/Node 24: 381 tests, typecheck y build; ejecución real Bash/curl conserva URL, headers y body. Los e2e ejecutan también cmd y PowerShell en Windows dentro de la matriz CI; resultado remoto pendiente.

- 2026-11-11 — El usuario autoriza completar F5 sin el prototipo y continuar el proyecto; nombre elegido para npm: `httpi-cli`. Se conserva la rama indicada.

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

- Prototipo de Ink ausente: desbloqueado por instrucción del usuario de completar la fase 5 creando el flujo desde cero.
- Los fixtures de `test/fixtures/curl/` están escritos a mano con el formato de DevTools, no copiados de un navegador real. Hace falta que el usuario pegue curls reales ("Copy as cURL (bash)" y "(cmd)") para validar el riesgo de comillas de PLAN §11.
- Sin verificar en cmd: cómo escapa DevTools una barra invertida dentro del body (p. ej. `\n` en JSON) en "Copy as cURL (cmd)". Se quitó ese caso del fixture inventado hasta tener un pegado real.
- Decisión pendiente del usuario: `{{nombre}}` consulta el entorno del sistema antes que `httpi.env.yaml` (precedencia de PLAN §4). En Windows las variables de entorno no distinguen mayúsculas, así que un `{{path}}` o `{{username}}` del archivo de entornos quedaría tapado por el del sistema.
