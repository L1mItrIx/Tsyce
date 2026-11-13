# httpi

CLI/TUI para probar APIs con curl por debajo. Promesa única:

> "Pega un curl o responde unas preguntas, y obtienes una prueba de API lista para correr en CI."

Estas reglas y las skills de `.claude/skills/` se aplican a Claude, Codex y sus
subagentes. `AGENTS.md` dirige a Codex a esta misma fuente; no mantiene otro plan.

## Fuentes de verdad (no las dupliques)

| Archivo | Contiene | Regla |
|---|---|---|
| `PLAN.md` | Arquitectura, decisiones, fases, dependencias (§15 = v0.2, en curso) | Solo cambia si el usuario lo aprueba |
| `PROGRESS.md` | Estado de cada tarea y registro de decisiones | Se actualiza en el mismo commit que el trabajo |
| Este archivo | Reglas de trabajo | Corto; el detalle vive en las skills |

No crees otros documentos de plan, notas o resúmenes. Si algo no cabe en esos tres, pregunta.

## Flujo obligatorio

1. **Antes de escribir código:** skill `httpi-tarea`.
2. **Antes de cada commit/push:** skill `httpi-entrega`.
3. **Al comenzar una tarea no trivial:** skill `httpi-paralelo`. Delega cuando haya trabajo independiente útil y herramientas de subagentes disponibles; incluye revisión independiente en cambios sustanciales.
4. **Si tocas el importador de curl:** skill `httpi-caso-curl`.

El hook de `.claude/settings.json` verifica los pushes de Claude. No asumas que
protege otros clientes: todos deben ejecutar y comprobar `npm run check` antes
de subir. No esquives un hook activo (`--no-verify`, editarlo, quitar tests).

Usa las skills pertinentes al trabajo y sus referencias necesarias. No actives
skills ajenas al problema por el solo hecho de estar disponibles. Si una capacidad
necesaria no está disponible, informa el límite concreto y continúa lo posible.

## Alcance

Hacer solo la tarea tomada de `PROGRESS.md`. Si aparece una idea o mejora no pedida, anótala en "Backlog" de `PROGRESS.md` y sigue.

Fuera de alcance (no implementar, aunque parezca fácil): GraphQL/gRPC, ejecución en paralelo, scripting, reportes HTML, servidor propio de colaboración. OAuth se limita a los flujos de `PLAN.md` §15 (sin device code, JWT bearer ni mTLS).

## Reglas de arquitectura

- `src/core/` no importa `ink`, `react` ni `commander`. `src/tui/` y `src/cli.ts` son capas finas sobre `core`.
- curl se ejecuta con `spawn(bin, args[])`. Nunca `shell: true`, nunca `exec` con cadena.
- Un solo lugar por responsabilidad (mapa en `PLAN.md` §9 y §15 "Archivos"). Antes de crear una función o tipo, busca si ya existe.
- Los tipos salen del esquema zod (`z.infer`); no declares interfaces paralelas.
- Flag de curl desconocido → advertencia visible, nunca descarte silencioso.
- Dependencias: solo las de `PLAN.md` §12 (v0.2 no añade ninguna). Una nueva requiere aprobación del usuario.
- Node >= 22, ESM, TypeScript estricto.

## Comandos

```bash
npm run check
```

`check` = typecheck → build → tests. Debe existir desde la fase 0 y pasar antes de cualquier push.

## Idioma

Código, identificadores y mensajes de commit en inglés. Documentación y respuestas al usuario en español.
