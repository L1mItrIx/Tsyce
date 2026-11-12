# httpi — Plan

> "Pega un curl o responde unas preguntas, y obtienes una prueba de API lista para correr en CI."

Fecha de la investigación: 2026-11-12. Versiones tomadas de `npm view` ese día.

## 0. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Node mínimo | **>= 22** (lo exige Ink 8) |
| Curl pegado | **Bash + cmd + PowerShell** → parser propio |
| Dedicación | 5–8 h/semana |
| Nombre en npm | **Pendiente.** `httpi` está ocupado (`httpi@0.3.0`, 2022). Se trabaja con `npm link` hasta la fase 7. Opciones: `@usuario/httpi` con bin `httpi`, o `httpi-cli` (libre hoy) |
| Motor HTTP | curl del sistema vía `spawn` (sin shell) |
| Formato | YAML (se acepta JSON), validado con zod |
| TUI | Ink, solo teclado |

## 1. Competencia

| Herramienta | Qué hace bien | Qué le falta frente a httpi | No competir en |
|---|---|---|---|
| **Hurl** (Rust, libcurl) | Formato de texto plano, encadenar requests, capturas, asserts JSONPath/XPath, reportes JUnit/TAP/HTML, `--test`, exporta curl (`--curl`), importa curl (`hurlfmt --in curl`) | Hay que aprender su sintaxis; no hay modo guiado ni menú de asserts | Velocidad, amplitud de asserts, XPath/HTML, reportes |
| **Bruno CLI** (`bru`) | `bru run` de colecciones con entornos, reportes JSON/JUnit/HTML, `bru import` de OpenAPI/WSDL | El CLI es acompañante de la app de escritorio; el import documentado del CLI es desde specs, no desde un curl | Colecciones, GUI, scripting JS |
| **httpyac** (npm) | Archivos `.http`/`.rest`, HTTP/GraphQL/WebSocket/gRPC, `--junit`, `--json`, entornos, `oauth2` | Sin modo guiado; sintaxis `.http` a mano | Multi-protocolo, OAuth2 |
| **Step CI** (npm) | YAML/JSON/JS, REST/GraphQL/gRPC/tRPC/SOAP, `stepci run` | YAML escrito a mano; telemetría activada por defecto | Multi-protocolo, workflows grandes |
| **Posting** (TUI, v3 en Go) | TUI completa con mouse, pestañas, temas, importa curl pegándolo en la barra de URL, exporta curl, importa OpenAPI/Postman/Bruno | Es un cliente interactivo, no un runner de pruebas para CI | **La TUI.** Mouse, temas, pestañas, árbol JSON |
| **HTTPie** | Sintaxis humana para lanzar requests, salida con color, sesiones | No es herramienta de pruebas: sin archivo de prueba ni asserts | Cliente ad hoc "más bonito que curl" |

**Hueco real:** todas piden escribir su formato a mano. Hurl es el más cercano (importa curl), pero entrega un archivo sin asserts y sin guía. httpi gana solo en el trayecto *curl pegado → asserts por menú → archivo → CI*. Todo lo demás es terreno perdido de antemano.

Alcance de la verificación: Hurl, httpyac, Step CI, Posting y HTTPie desde su README; Bruno desde su página de docs del CLI. No comprobé actividad reciente ni estrellas de los repos.

## 2. Arquitectura

```
curl pegado ─► importer ─┐
modo guiado (Ink) ───────┼─► TestFile (modelo zod) ─► YAML en disco
                         │
httpi run archivo.yaml ──┘─► vars/entorno ─► runner (spawn curl) ─► asserts ─► reporter ─► exit code
                                                └─► exporter (curl / código)
```

Regla: `core/` no importa nada de Ink ni de commander. La TUI y el CLI son capas finas.

### 2.1 curl con `spawn` vs `fetch`

| | `spawn('curl', [...])` | `fetch` |
|---|---|---|
| Fidelidad con el curl pegado | Total: mismo binario | Hay que traducir cada flag |
| "curl equivalente" | Es literalmente lo ejecutado | Aproximación |
| Tiempos DNS/TLS/TTFB | Gratis con `-w` | No disponibles |
| Dependencia externa | Requiere curl >= 7.83 | Ninguna |
| Riesgo de inyección | Nulo con args en arreglo y sin `shell` | Nulo |

**Recomendación: spawn.** Es la identidad del proyecto. Nunca `shell: true` ni `exec` con cadena.

### 2.2 Leer status, tiempo y headers (probado en curl 8.5.0)

```bash
curl -sS -o body.bin -D headers.txt -w '%{json}\n%{header_json}' --compressed https://httpbingo.org/get
```

| Flag | Uso |
|---|---|
| `-o <archivo>` | Cuerpo a archivo temporal; deja stdout limpio para la metadata |
| `-w '%{json}'` | Un objeto JSON con `http_code`, `time_total`, `time_starttransfer`, `size_download`, `exitcode`, `errormsg`, etc. (7.70.0) |
| `-w '%{header_json}'` | Headers de la última respuesta, nombres en minúscula y valores en arreglo (7.83.0) |
| `-D <archivo>` | Headers crudos. Opcional, solo para mostrar |
| `-sS` | Sin barra de progreso, pero con errores en stderr |

Detalles observados:
- `-D` incluye **todos** los bloques: la respuesta del `CONNECT` del proxy y cada redirect. Para asserts usa `header_json`, no parsees `-D`.
- Si falla la conexión: `http_code` = `000`, código de salida de curl distinto de 0, y `%{exitcode}`/`%{errormsg}` (7.75.0) explican la causa.
- `time_total` viene en segundos; convertir a ms.
- **Versión mínima de curl: 7.83.0.** Comprobar con `curl --version` al arrancar y fallar con mensaje claro.

## 3. Parser de curl pegado

| Opción | Estado | Veredicto |
|---|---|---|
| `curlconverter` 4.12.0 | Probado: `toJsonString()` devuelve url, method, headers, queries, data, auth, cookies. Avisa de variables (`$TOKEN`). Solo ESM | **Solo como oráculo en tests** (devDependency) |
| `parse-curl` 0.2.6 | Sin cambios desde 2022 | Descartado |
| `shell-quote` / `string-argv` | Tokenizadores, no entienden flags de curl | Insuficientes solos |
| **Propio** | — | **Elegido** |

Por qué no curlconverter en producción:
- Solo entiende Bash; tú pediste cmd y PowerShell.
- Pesa: 30 MB instalado, con `tree-sitter` nativo (prebuilds solo para darwin-arm64/x64, linux-x64, win32-x64).
- Su JSON pierde el cuerpo original: convierte `--data-raw '{"a":1}'` en objeto.

Diseño propio, en dos etapas separadas:

1. **Tokenizador por dialecto** → `string[]`
   - Bash: comillas simples y dobles, `\` de continuación, `$'...'` (ANSI-C).
   - cmd: `^` como escape y continuación, `"` dobles, `^"` de DevTools.
   - PowerShell: `` ` `` como escape y continuación, comillas simples con `''`, `curl.exe`.
   - Autodetección por `^` o `` ` `` al final de línea; opción `--dialect` para forzar.
2. **Mapeador de flags** (común) → modelo de request. Lista blanca:

| Flags | Destino |
|---|---|
| `-X`, `--request` | method |
| `-H`, `--header` | headers |
| `-d`, `--data`, `--data-raw`, `--data-binary`, `--data-urlencode`, `--json` | body (implica POST) |
| `-F`, `--form` | multipart |
| `-u`, `--user` | auth básica |
| `-b`, `--cookie` | header cookie |
| `-A`, `-e` | user-agent, referer |
| `--compressed`, `-L`, `-k`, `-m`, `--max-time` | opciones |
| `-G`, `--get` | pasa data a query |
| formas pegadas (`-XPOST`, `-sSL`) y `--flag=valor` | normalizar |

Flag desconocido → **advertencia visible**, nunca descarte silencioso. Secretos detectados (`Authorization`, `-u`, cookies) → ofrecer reemplazo por `{{variable}}`.

## 4. Formato de archivo

YAML por defecto (comentarios, diffs legibles, cuerpos multilínea); JSON aceptado porque el parser `yaml` lo lee igual.

```yaml
version: 1
name: Crear usuario
tests:
  - name: POST /users devuelve 201
    request:
      method: POST
      url: "{{baseUrl}}/users"
      headers:
        Content-Type: application/json
        Authorization: "Bearer {{token}}"
      body:
        json: { name: Ana }
    expect:
      status: 201
      maxTimeMs: 800
      headers:
        content-type: { contains: application/json }
      json:
        - { path: "$.id", exists: true }
        - { path: "$.name", equals: Ana }
```

Entornos en `httpi.env.yaml`:

```yaml
dev:  { baseUrl: "http://localhost:3000" }
prod: { baseUrl: "https://api.example.com" }
```

```bash
httpi run tests/usuarios.yaml --env dev --var token=abc
```

Precedencia: `--var` > variables de entorno del sistema (`${TOKEN}`) > `httpi.env.yaml`. Variable sin resolver → error, salida 2.

**Validación: zod 4** (no ajv). Un esquema da tipos TS e `z.toJSONSchema()` (comprobado), que publicas como `httpi.schema.json` para autocompletado en VS Code. ajv solo valdría la pena si el esquema naciera como JSON Schema.

## 5. Asserts

| Assert | Sintaxis | Menú |
|---|---|---|
| Status | `status: 200` o `status: [200, 201]` | "Status igual al recibido" |
| Tiempo | `maxTimeMs: 800` | "Menor que N ms" |
| Header | `headers: { nombre: { equals \| contains } }` | Lista de headers recibidos |
| Campo JSON | `{ path, equals \| exists \| contains \| matches \| type }` | Campos de la respuesta real |

El menú se llena **ejecutando la request una vez** y ofreciendo los campos de la respuesta real: ese es el momento que vende el producto.

JSONPath:

| Librería | Nota | Veredicto |
|---|---|---|
| `json-p3` 3.0.3 | RFC 9535, MIT, 1 dependencia, activo; probado | **Elegida** |
| `jsonpath-rfc9535` 1.3.0 | RFC 9535, último cambio abr-2025 | Alternativa |
| `jsonpath-plus` 11.3.0 | Dos RCE (CVE-2024-21534, CVE-2025-1302), corregidos en 10.3.0; evalúa expresiones | Evitar: los `path` vienen de archivos ajenos |

Códigos de salida:

| Código | Significado |
|---|---|
| 0 | Todo pasó |
| 1 | Al menos un assert falló |
| 2 | Archivo inválido, variable sin resolver o uso incorrecto |
| 3 | curl ausente, versión vieja o error de red |

## 6. Publicación y multiplataforma

```json
{
  "type": "module",
  "bin": { "httpi": "dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=22" }
}
```

- `dist/cli.js` debe empezar con `#!/usr/bin/env node`. En Windows npm genera un `httpi.cmd`.
- Probar antes de publicar:

```bash
npm pack --dry-run
```

```bash
npm link
```

| Plataforma | Punto a cuidar |
|---|---|
| Windows | curl viene con Windows 10/11, pero el build de Microsoft no trae HTTP/2 ni brotli/zstd y va por detrás en versión |
| PowerShell 5.1 | `curl` es alias de `Invoke-WebRequest`. A httpi no le afecta (`spawn` sin shell no ve alias), pero el **curl exportado** debe decir `curl.exe` |
| Windows | Invocar `curl.exe` explícito. `.cmd`/`.bat` no corren con `spawn` sin shell; no aplica a curl, sí a tests que lancen `httpi.cmd` |
| Todas | Archivos temporales con `os.tmpdir()` y `path.join`; borrar en `finally` |
| Todas | Opción `HTTPI_CURL` para apuntar a otro binario |

Nota: con `npx` un paquete scoped se ejecuta como `npx @usuario/httpi`; sin scope, `npx httpi-cli`. Pesa en la decisión del nombre.

## 7. Mouse: quedarse en Ink, solo teclado

- Ink no ofrece API de mouse. Su README solo dice que los reportes de mouse se filtran de `useInput` y que, si la app activa el seguimiento, use modo SGR.
- Hay paquetes de terceros (`@ink-tools/ink-mouse`, `ink-use-mouse`); no los evalué.
- Posting ya ocupa el nicho de TUI con mouse.
- El modo guiado es un asistente lineal: flechas, Enter, espacio y Tab bastan.

**No cambiar de framework.** Como `core/` no depende de Ink, se puede reevaluar después sin reescribir.

## 8. Pruebas del propio CLI

| Capa | Herramienta | Qué cubre |
|---|---|---|
| Unitarias | vitest 5 | Tokenizadores (tabla de casos por dialecto), mapeador de flags, asserts, variables, esquema |
| Oráculo | `curlconverter` (dev) | Comparar el parser Bash propio contra su salida en ~50 curls reales |
| Integración | vitest + servidor `node:http` local | runner con curl real: status, headers, timeouts, redirects, error de red |
| TUI | `ink-testing-library` 4.0.0 | `render()`, `lastFrame()`, `stdin.write()` |
| E2E | `spawn` de `dist/cli.js` | Códigos de salida 0/1/2/3 y salida en modo no-TTY |
| CI | GitHub Actions, matriz ubuntu/macos/windows × Node 22/24 | Diferencias de curl y rutas |

En tests de Ink: `stdin.write('\r')` para Enter, `'\u001B[B'` para flecha abajo, y esperar un tick antes de leer `lastFrame()`.

## 9. Estructura de carpetas

```
httpi/
├─ src/
│  ├─ cli.ts                 # commander: run, import, new, export
│  ├─ core/
│  │  ├─ schema.ts           # zod + tipos
│  │  ├─ file.ts             # leer/escribir YAML
│  │  ├─ vars.ts             # {{var}}, entornos
│  │  ├─ runner/
│  │  │  ├─ curl-args.ts     # request → string[]
│  │  │  ├─ exec.ts          # spawn, -w, -o, temporales
│  │  │  └─ detect.ts        # binario y versión de curl
│  │  ├─ asserts.ts
│  │  ├─ importer/
│  │  │  ├─ tokenize-bash.ts
│  │  │  ├─ tokenize-cmd.ts
│  │  │  ├─ tokenize-powershell.ts
│  │  │  ├─ detect-dialect.ts
│  │  │  └─ map-flags.ts
│  │  ├─ exporter/           # curl (bash/cmd/powershell), código
│  │  └─ reporter/           # pretty, json, junit
│  └─ tui/                   # Ink: asistente y menú de asserts
├─ test/
│  ├─ fixtures/curl/         # curls reales por dialecto
│  ├─ unit/  integration/  tui/  e2e/
├─ examples/
├─ schema/httpi.schema.json
└─ .github/workflows/ci.yml
```

## 10. Fases del MVP

A 5–8 h/semana, ~68 h son **9 a 13 semanas**. Soportar PowerShell y cmd añade unas 8 h sobre la opción solo-Bash.

| # | Fase | Entregable | Horas | Semanas |
|---|---|---|---|---|
| 0 | Base | Repo, TS estricto, vitest, CI en 3 SO, prueba de humo de Ink 8 + ink-testing-library | 5 | 1 |
| 1 | Runner | `exec.ts`: request → curl → `{status, headers, body, tiempos, error}`, con tests de integración | 8 | 1–1.5 |
| 2 | Formato + `run` | Esquema zod, YAML, asserts, reporter pretty, códigos de salida | 12 | 2 |
| 3 | Variables y entornos | `{{var}}`, `--env`, `--var`, `${ENV}` | 5 | 1 |
| 4 | Importador | 3 tokenizadores, mapeador, advertencias, `httpi import` | 16 | 2.5–3 |
| 5 | Modo guiado | Asistente Ink + menú de asserts desde respuesta real (reusa el prototipo) | 10 | 1.5–2 |
| 6 | Exportar | curl por dialecto; código (fetch) opcional | 4 | 0.5–1 |
| 7 | CI y publicación | Reporter JUnit, README con GIF, ejemplo de GitHub Actions, nombre, `npm publish` | 8 | 1–1.5 |

Corte usable tras la fase 4: `httpi import` + `httpi run` ya cumplen la promesa sin TUI.

Fuera del MVP: encadenar requests con capturas, GraphQL/gRPC, OAuth, ejecución en paralelo, importar OpenAPI/Postman, mouse.

## 11. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Comillas de cmd/PowerShell mal parseadas | Alto: rompe la promesa central | Fixtures reales de DevTools por dialecto; advertir en vez de adivinar |
| `ink-testing-library` 4.0.0 (2024) frente a Ink 8 (2026): compatibilidad sin comprobar | Medio | Prueba de humo en fase 0; plan B: probar la lógica del asistente como reducer puro |
| curl de Windows viejo o sin funciones | Medio | Chequeo de versión, `HTTPI_CURL`, job de Windows en CI |
| Secretos guardados en el YAML al importar | Alto | Detectar y proponer `{{var}}`; aviso en README |
| Secretos visibles en la lista de procesos (args de curl) | Bajo-medio | Documentarlo; después, pasar config por stdin con `-K -` |
| Crecer hacia "otro Hurl" | Alto: pierdes el diferenciador | La lista "fuera del MVP" es vinculante |
| Nombre ocupado en npm | Bajo | Decidir antes de la fase 7 |
| Prototipo en Ink antiguo | Bajo-medio | Migrar a Ink 8 / React 19.3 en fase 0 |

## 12. Dependencias

Producción:

| Paquete | Versión | Para |
|---|---|---|
| `ink` | 8.0.0 | TUI (Node >= 22, React >= 19.3) |
| `react` | >= 19.3 | Requerido por Ink |
| `@inkjs/ui` | 2.0.0 | Select, TextInput, Spinner (peer `ink >= 5`; confirmar con Ink 8) |
| `commander` | 15.1.0 | Subcomandos y flags |
| `yaml` | 2.9.1 | Leer/escribir YAML |
| `zod` | 4.6.7 | Esquema y JSON Schema |
| `json-p3` | 3.0.3 | JSONPath RFC 9535 |

Desarrollo: `typescript`, `vitest` 5.1.0, `@vitest/coverage-v8`, `ink-testing-library` 4.0.0, `curlconverter` 4.12.0 (oráculo), `@types/react`, `@types/node`.

Sin dependencia a propósito: `execa` (basta `node:child_process`), bundler (`tsc` alcanza; `tsup` si luego quieres un solo archivo).

## 13. Qué aprender

| Tema | Por qué |
|---|---|
| Reglas de comillas de Bash, cmd y PowerShell | Es el 80 % de la dificultad del importador |
| `curl --write-out` y códigos de salida de curl | Base del runner y de los mensajes de error |
| JSONPath RFC 9535 | Sintaxis estándar de los asserts |
| Convenciones de CLI: códigos de salida, stdout vs stderr, `NO_COLOR`, detección de TTY | Que funcione bien en CI |
| Formato JUnit XML | Lo leen GitHub Actions, GitLab y Jenkins |
| Matriz de GitHub Actions y `npm publish --provenance` | Publicación confiable |
| Reducers puros para el asistente | TUI testeable sin terminal |

## 14. Primera tarea

**Spike del runner (2–3 h), antes de tocar la TUI:**

1. Crear el repo con TS estricto, `"type": "module"`, vitest.
2. Escribir `src/core/runner/exec.ts`: recibe `{method, url, headers, body}`, arma `string[]`, hace `spawn(curlBin, args)` con `-sS -o <tmp> -w '%{json}\n%{header_json}'` y devuelve `{status, timeMs, headers, body, curlExitCode, error}`.
3. Un test de integración con servidor `node:http` local que cubra: 200 con JSON, 404, y puerto cerrado.
4. Workflow de CI con matriz ubuntu/macos/windows.

Hecho cuando: el test pasa en los tres sistemas. Eso valida de entrada el mayor riesgo técnico (curl en Windows) y fija el contrato que usarán asserts, importador y TUI.

## Fuentes consultadas

- curl, man page (`--write-out`, `--json`, `-D`, `-o`): https://curl.se/docs/manpage.html
- curl en Windows y alias de PowerShell: https://curl.se/windows/microsoft.html
- `Invoke-WebRequest` (alias `curl` en PowerShell 5.1): https://learn.microsoft.com/powershell/module/microsoft.powershell.utility/invoke-webrequest?view=powershell-5.1
- Node `child_process` (spawn, `.bat`/`.cmd`): https://nodejs.org/api/child_process.html
- npm `package.json`, campo `bin`: https://docs.npmjs.com/cli/configuring-npm/package-json#bin
- Ink: https://github.com/vadimdemedes/ink
- ink-testing-library: https://github.com/vadimdemedes/ink-testing-library
- curlconverter: https://github.com/curlconverter/curlconverter
- Hurl: https://github.com/Orange-OpenSource/hurl y https://hurl.dev/docs/hurlfmt.html
- Bruno CLI: https://docs.usebruno.com/bru-cli/overview
- httpyac: https://github.com/AnWeber/httpyac
- Step CI: https://github.com/stepci/stepci
- Posting: https://github.com/darrenburns/posting
- HTTPie: https://github.com/httpie/cli
- Avisos de `jsonpath-plus` (OSV): https://osv.dev/list?q=jsonpath-plus&ecosystem=npm
