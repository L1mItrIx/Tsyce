---
name: httpi-tarea
description: Úsala SIEMPRE antes de escribir o modificar código en httpi, al empezar una sesión, o cuando el usuario diga "sigue", "continúa", "siguiente tarea" o nombre una fase. Elige la siguiente tarea de PROGRESS.md, comprueba que no esté ya hecha y fija su alcance para no duplicar ni desviarse.
---

# Tomar una tarea

## 1. Ubícate (lecturas mínimas)

1. Lee `PROGRESS.md` completo.
2. De `PLAN.md` lee solo la sección de la fase que toca, no todo el archivo.
3. Revisa el estado real:

```bash
git status -sb && git log --oneline -10 && git branch -a
```

## 2. Elige una sola tarea

- Si hay una `[~]` en curso, termínala antes de abrir otra.
- Si no, toma la primera `[ ]` en orden. No saltes de fase: cada una depende de la anterior.
- Si el usuario pidió algo que no está en `PROGRESS.md`, pregunta si se añade antes de hacerlo.
- Si la fase anterior quedó en una rama sin integrar a `main`, avisa al usuario y continúa sobre esa rama; no la reimplementes.

## 3. Comprueba que no exista ya

Antes de crear un archivo, función o tipo:

- Busca por nombre y por concepto en `src/` y `test/` (Grep/Glob).
- Mira el mapa de carpetas en `PLAN.md` §9: cada responsabilidad tiene un único archivo.
- Si existe algo parecido, extiéndelo. Si existe y está mal, corrígelo ahí; no crees una segunda versión.

## 4. Fija el alcance antes de escribir

Escribe en tu respuesta, en tres líneas:

- **Tarea:** ID y título (p. ej. `F1.3 runner/exec.ts`).
- **Archivos que tocarás:** lista cerrada.
- **Hecho cuando:** el test concreto que debe pasar.

Si durante el trabajo necesitas tocar algo fuera de esa lista, detente y justifica por qué; si es una mejora no pedida, va a "Backlog".

## 5. Marca y trabaja

- Cambia la tarea a `[~]` en `PROGRESS.md` e indica la rama.
- Rama: `fase-<n>-<slug>` (una por fase, no por tarea).
- Escribe primero el test que define "hecho", luego el código mínimo que lo pasa.
- Al terminar, usa la skill `httpi-entrega`.

## No hagas

- Refactors, renombrados o formateo de archivos ajenos a la tarea.
- Añadir dependencias fuera de `PLAN.md` §12.
- Abstracciones "por si acaso" (interfaces con una sola implementación, opciones que nadie usa).
- Volver a investigar decisiones ya tomadas en `PLAN.md` o en "Decisiones".
