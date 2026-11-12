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
- [ ] F1.4 Tests de integración con servidor `node:http`: 200 JSON, 404, puerto cerrado, timeout, redirect

## Fase 2 — Formato y `run`
- [ ] F2.1 `schema.ts` (zod) y `file.ts` (YAML/JSON)
- [ ] F2.2 `asserts.ts`: status, maxTimeMs, headers, json (json-p3)
- [ ] F2.3 `reporter/pretty` y códigos de salida 0/1/2/3
- [ ] F2.4 `httpi run <archivo>` + tests e2e de códigos de salida

## Fase 3 — Variables y entornos
- [ ] F3.1 `vars.ts`: `{{var}}`, `${ENV}`, precedencia
- [ ] F3.2 `httpi.env.yaml`, `--env`, `--var`; variable sin resolver → salida 2

## Fase 4 — Importador de curl
- [ ] F4.1 `tokenize-bash.ts`
- [ ] F4.2 `tokenize-cmd.ts`
- [ ] F4.3 `tokenize-powershell.ts`
- [ ] F4.4 `detect-dialect.ts` y `--dialect`
- [ ] F4.5 `map-flags.ts` (lista blanca de PLAN §3) con advertencias
- [ ] F4.6 Detección de secretos → propuesta de `{{var}}`
- [ ] F4.7 `httpi import` + oráculo curlconverter en tests

## Fase 5 — Modo guiado
- [ ] F5.1 Reducer puro del asistente (sin Ink) con tests
- [ ] F5.2 Pantallas Ink: método → URL → headers → body
- [ ] F5.3 Menú de asserts a partir de la respuesta real
- [ ] F5.4 `httpi new` escribe el YAML

## Fase 6 — Exportar
- [ ] F6.1 Exportar curl por dialecto (`curl.exe` en PowerShell)
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

## Backlog (fuera de la tarea actual)
Ideas que surgieron y no se hicieron. No implementar sin aprobación.

- Headers repetidos (mismo nombre varias veces): `headers` es un mapa y no los representa.
- Cuerpos de respuesta binarios: `RunResult.body` es texto UTF-8.

## Bloqueos
Qué impide avanzar y qué se necesita del usuario.

- El prototipo en Ink del usuario no está en el repo (afecta F5.2).
