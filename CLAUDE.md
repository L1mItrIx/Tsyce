# httpi

CLI/TUI para probar APIs con curl por debajo. Promesa única:

> "Pega un curl o responde unas preguntas, y obtienes una prueba de API lista para correr en CI."

## Fuentes de verdad (no las dupliques)

| Archivo | Contiene | Regla |
|---|---|---|
| `PLAN.md` | Arquitectura, decisiones, fases, dependencias | Solo cambia si el usuario lo aprueba |
| `PROGRESS.md` | Estado de cada tarea y registro de decisiones | Se actualiza en el mismo commit que el trabajo |
| Este archivo | Reglas de trabajo | Corto; el detalle vive en las skills |

No crees otros documentos de plan, notas o resúmenes. Si algo no cabe en esos tres, pregunta.

## Flujo obligatorio

1. **Antes de escribir código:** skill `httpi-tarea`.
2. **Antes de cada commit/push:** skill `httpi-entrega`.
3. **Si vas a usar subagentes:** skill `httpi-paralelo`.
4. **Si tocas el importador de curl:** skill `httpi-caso-curl`.

Un hook bloquea `git push` cuando `npm run check` falla. No lo esquives (`--no-verify`, editar el hook, quitar tests): arregla la causa.

## Alcance

Hacer solo la tarea tomada de `PROGRESS.md`. Si aparece una idea o mejora no pedida, anótala en "Backlog" de `PROGRESS.md` y sigue.

Fuera del MVP (no implementar, aunque parezca fácil): encadenar requests con capturas, GraphQL/gRPC, OAuth, ejecución en paralelo, importar OpenAPI/Postman, mouse, scripting, reportes HTML.

## Reglas de arquitectura

- `src/core/` no importa `ink`, `react` ni `commander`. `src/tui/` y `src/cli.ts` son capas finas sobre `core`.
- curl se ejecuta con `spawn(bin, args[])`. Nunca `shell: true`, nunca `exec` con cadena.
- Un solo lugar por responsabilidad (mapa en `PLAN.md` §9). Antes de crear una función o tipo, busca si ya existe.
- Los tipos salen del esquema zod (`z.infer`); no declares interfaces paralelas.
- Flag de curl desconocido → advertencia visible, nunca descarte silencioso.
- Dependencias: solo las de `PLAN.md` §12. Una nueva requiere aprobación del usuario.
- Node >= 22, ESM, TypeScript estricto.

## Comandos

```bash
npm run check
```

`check` = typecheck + tests + build. Debe existir desde la fase 0 y pasar antes de cualquier push.

## Idioma

Código, identificadores y mensajes de commit en inglés. Documentación y respuestas al usuario en español.
