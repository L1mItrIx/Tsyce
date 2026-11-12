---
name: httpi-paralelo
description: Úsala antes de lanzar subagentes o trabajar varias tareas de httpi a la vez. Decide si conviene paralelizar, reparte archivos sin solapes y define el contrato de cada agente para que no dupliquen trabajo ni se pisen.
---

# Trabajo con varios agentes

## 1. ¿Hace falta?

Por defecto, **no**. Un agente nuevo arranca sin contexto y lo vuelve a derivar; eso cuesta más que hacerlo en línea.

Paraleliza solo si se cumplen las tres:

- Las tareas no comparten archivos.
- Ninguna depende del resultado de otra.
- Cada una tiene un contrato de entrada/salida ya fijado en código o en `PLAN.md`.

Casos donde sí encaja:

| Tareas | Por qué son independientes |
|---|---|
| F4.1, F4.2, F4.3 (tokenizadores) | Misma firma `(input: string) => string[]`, archivos y fixtures distintos |
| `reporter/pretty` y `reporter/junit` | Misma entrada (resultado de la corrida), archivos distintos |
| Exportadores por dialecto | Misma entrada (request), archivos distintos |

No paralelices: `schema.ts`, `runner/exec.ts`, `cli.ts`, `package.json`, `PROGRESS.md`. Son puntos únicos; los edita solo el agente principal.

## 2. Antes de lanzar

1. El agente principal escribe y sube primero lo compartido: tipos, firma de la función, estructura de fixtures.
2. Asigna a cada agente una lista cerrada de archivos. Ningún archivo aparece en dos listas.
3. Usa `isolation: "worktree"` para que no compartan directorio de trabajo.

## 3. Encargo para cada agente

Cada encargo debe incluir, explícitamente:

- ID de la tarea y la sección de `PLAN.md` que debe leer (solo esa).
- Archivos que puede crear o modificar, y la frase "no toques ningún otro".
- La firma o tipo exacto que debe cumplir, copiado tal cual.
- El test que define "hecho" y el comando para correrlo.
- Prohibiciones: no añadir dependencias, no editar `PROGRESS.md`, no hacer push, no refactorizar.
- Qué devolver: archivos cambiados, resultado de los tests, dudas abiertas.

## 4. Al recibir resultados

El agente principal, no los subagentes:

1. Lee cada diff; no confíes en el resumen.
2. Busca duplicados entre agentes (helpers iguales con distinto nombre) y unifícalos en un solo archivo.
3. Corre `npm run check` con todo integrado.
4. Actualiza `PROGRESS.md` y entrega con la skill `httpi-entrega`.
