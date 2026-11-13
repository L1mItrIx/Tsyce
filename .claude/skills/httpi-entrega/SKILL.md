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

Cada cambio de comportamiento entrega al menos un test que fallaría sin él.
Los cambios solo de instrucciones/documentación se verifican revisando coherencia,
enlaces/rutas y `git diff --check`; no necesitan tests que repitan el texto.

| Si tocaste | Debe existir |
|---|---|
| Tokenizador o `map-flags` | Caso en la tabla del dialecto (skill `httpi-caso-curl`) |
| `runner/` | Test de integración contra servidor `node:http` local |
| `asserts`, `vars`, `schema` | Test unitario del caso feliz y de al menos un error |
| `tui/` | Test del reducer; `ink-testing-library` solo para el render |
| `cli.ts` | Test e2e del código de salida |

## 3. Revisa tu propio diff

En cambios sustanciales, sigue `httpi-paralelo` y pide a un subagente una revisión
independiente de la versión integrada y estable antes de hacer commit. El principal
contrasta sus hallazgos; si no hay subagentes disponibles, explica el límite.

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

- El hook de Claude vuelve a correr `npm run check` cuando está activo; en otros clientes no se presupone esa protección. Si bloquea, no uses `--no-verify` ni lo modifiques.
- No abras un pull request salvo que el usuario lo pida.

## 6. Verifica CI e informa

Después del push, consulta el workflow del SHA exacto que subiste y comprueba
todos los jobs de Ubuntu, macOS y Windows con Node 22/24. Un job verde no equivale
a la matriz completa. Si hay un fallo, lee sus logs y corrige la causa antes de dar
el cierre por verificado; un reintento exitoso por sí solo no arregla un test inestable.
Si el CI sigue pendiente o no es accesible, dilo con el enlace y lo que sí se comprobó.

Al usuario, en pocas líneas: qué tarea quedó, qué se delegó, qué se probó y con qué
resultado, qué no se pudo verificar y cuál es la siguiente tarea. No abras el PR
pendiente a `main` ni publiques npm sin la instrucción correspondiente del usuario.
