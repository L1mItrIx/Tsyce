---
name: httpi-entrega
description: Úsala SIEMPRE antes de hacer commit o push en httpi, y cuando el usuario diga "sube", "guarda el avance", "commit" o "ya terminé". Verifica con pruebas, revisa el diff contra el alcance, actualiza PROGRESS.md y sube. Nunca se sube nada con pruebas en rojo.
---

# Entregar un avance

Sigue los pasos en orden. Si uno falla, corrige y vuelve a ese paso; no avances.

## 1. Verifica

```bash
npm run check
```

- Debe terminar en verde. Si falla, arregla la causa.
- Prohibido para "hacerlo pasar": borrar o saltar tests (`.skip`, `.only`), relajar asserts, `@ts-ignore`, `any`, subir timeouts sin motivo.
- Si el cambio toca `runner/` o el CLI, ejecútalo de verdad una vez (no solo los tests) y mira la salida y el código de salida.

## 2. Comprueba que hay prueba nueva

Cada tarea entrega al menos un test que fallaría sin el cambio. Sin test, la tarea no está hecha.

| Si tocaste | Debe existir |
|---|---|
| Tokenizador o `map-flags` | Caso en la tabla del dialecto (skill `httpi-caso-curl`) |
| `runner/` | Test de integración contra servidor `node:http` local |
| `asserts`, `vars`, `schema` | Test unitario del caso feliz y de al menos un error |
| `tui/` | Test del reducer; `ink-testing-library` solo para el render |
| `cli.ts` | Test e2e del código de salida |

## 3. Revisa tu propio diff

```bash
git status -sb && git diff --stat && git diff
```

Quita antes de seguir:

- Archivos fuera del alcance declarado en `httpi-tarea`.
- Código duplicado: si copiaste lógica que ya existía, reutiliza la original.
- Código muerto, `console.log` de depuración, comentarios que repiten el código, TODOs sin tarea.
- Secretos, tokens o URLs privadas en fixtures.
- Importaciones de `ink`/`react`/`commander` dentro de `src/core/`.

## 4. Actualiza PROGRESS.md (mismo commit)

- Tarea terminada → `[x]`. Si quedó a medias → sigue en `[~]` con una nota de qué falta.
- Decisión nueva que no está en `PLAN.md` → una línea en "Decisiones".
- Ideas descartadas → "Backlog". Impedimentos → "Bloqueos".

## 5. Commit y push

- Un commit por tarea. Mensaje en inglés: `F1.3: run curl via spawn and parse write-out`.
- `git add` por archivo; no uses `git add -A` sin haber leído `git status`.

```bash
git push -u origin <rama>
```

- El hook vuelve a correr `npm run check`. Si bloquea, no uses `--no-verify` ni toques el hook.
- No abras un pull request salvo que el usuario lo pida.

## 6. Informa

Al usuario, en pocas líneas: qué tarea quedó, qué se probó y con qué resultado, qué no se pudo verificar (p. ej. Windows hasta que corra CI) y cuál es la siguiente tarea.
