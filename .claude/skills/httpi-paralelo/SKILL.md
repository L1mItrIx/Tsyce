---
name: httpi-paralelo
description: Úsala al comenzar tareas no triviales de httpi y antes de lanzar subagentes. Reparte implementación, investigación, revisión y verificación independientes entre agentes con contratos y propiedad de archivos claros; el principal integra y entrega.
---

# Trabajo con varios agentes (Codex y Claude)

## 1. Decide el reparto al comenzar

Por instrucción del usuario, usa subagentes cuando existan dos o más líneas de
trabajo independientes útiles y la herramienta permita delegarlas. No necesitas
pedir autorización de nuevo para cada subencargo dentro de la tarea autorizada.

- Identifica el trabajo crítico del principal y los subencargos que pueden avanzar
  sin esperar cambios suyos: investigar una causa, implementar otro módulo,
  revisar un diff o comprobar una matriz de CI.
- En cambios sustanciales, asigna una revisión independiente antes de entregar.
  El revisor puede leer archivos que otros editaron; debe revisar una versión
  estable indicada por el principal, no una copia que está cambiando.
- Un cambio pequeño y secuencial puede resolverse en un solo agente. Explica
  brevemente por qué si el usuario pidió paralelismo para esa tarea.
- Usa las skills necesarias para cada subencargo, no todas las disponibles.
  Comunica cuáles se aplican la primera vez que se utilicen.

Delegar trabajo de desarrollo no cambia la ejecución secuencial de requests del
producto. Tampoco permite saltar dependencias o abrir tareas fuera de alcance.

## 2. Aislamiento y propiedad

| Tipo de subencargo | Regla |
|---|---|
| Investigación, CI o revisión de solo lectura | Puede leer archivos comunes. No edita, instala, hace commit ni altera workflows. |
| Implementación | Lista cerrada de archivos con un único propietario por archivo; contratos compartidos definidos antes de editar. |
| Integración | El principal resuelve conflictos, revisa el resultado y entrega. |

- `schema.ts`, `runner/exec.ts`, `cli.ts`, `package.json`, lockfiles, `PROGRESS.md`
  e instrucciones compartidas quedan a cargo del principal. Un subagente puede
  revisarlos en solo lectura; los cambios se coordinan en secuencia.
- Para escritura, prefiere worktrees: aislamiento nativo de Claude si está
  disponible, o un `git worktree` separado y una ruta explícita con Codex.
  Usa exclusivamente parámetros que la herramienta soporte; no inventes una
  opción `isolation` para una API que no la tiene.
- Si no hay aislamiento disponible, usa el árbol compartido solo con archivos
  disjuntos y sin operaciones de git concurrentes. Explica esa limitación y
  conserva la revisión en solo lectura.
- Fija el commit/base y los contratos compartidos antes de repartir. No hace
  falta hacer push para delegar; nunca subas código incompleto solo para ello.
- No dupliques la instalación de dependencias o el check completo en cada
  agente. El principal prepara el entorno; cada implementador usa las pruebas
  específicas de su módulo cuando tiene acceso a las dependencias.

## 3. Contrato de cada subagente

El encargo debe indicar:

1. Objetivo verificable, ID de tarea y contexto mínimo; secciones del plan y
   skills que necesita leer.
2. Directorio de trabajo y commit/base; modo solo lectura o implementación.
3. Archivos autorizados y «no toques ningún otro»; el lector no modifica ninguno.
4. Firma o contrato existente cuando corresponda, entradas, salida esperada y
   dependencias ya preparadas.
5. Criterio de éxito, pruebas concretas y comandos aplicables. Para una revisión,
   pedir hallazgos con ruta/línea y evidencia; para CI, SHA, URL y estado de todos
   los jobs, no solo Ubuntu.
6. Prohibiciones: sin dependencias nuevas, cambios de alcance, push, publicación,
   PR ni actualizaciones de `PROGRESS.md`. No crear otros subagentes salvo que el
   principal lo encargue explícitamente y reserve capacidad para ello.
7. Entrega: archivos cambiados o hallazgos, comandos/resultados observados,
   dudas y limitaciones. Distinguir lo comprobado de una hipótesis.

No atribuyas trabajo a Claude desde Codex ni a Codex desde Claude sin ejecutar
realmente ese cliente/modelo. Si no hay herramientas de subagentes, informa el
límite y realiza la tarea y la revisión posibles sin simular delegación.

## 4. Coordinación y entrega

El principal sigue trabajando en su parte mientras los agentes avanzan. Recibe
sus informes, contrasta la evidencia y resuelve dudas o reasigna trabajo si hace
falta. Un informe no sustituye leer el diff ni ejecutar las pruebas integradas.

Antes de entregar, el principal:

1. Inspecciona cada diff, integra únicamente el alcance aprobado y elimina
   duplicados. No sobrescribe trabajo ajeno ni hace cherry-pick a ciegas.
2. Solicita revisión del resultado integrado cuando hubo cambios sustanciales;
   corrige los hallazgos o explica con evidencia por qué no aplican.
3. Ejecuta `npm run check` y comprueba su código de salida. No salta pruebas,
   relaja asserts ni aumenta timeouts para esconder fallos.
4. Actualiza `PROGRESS.md` y sigue `httpi-entrega` para commit/push y CI del SHA
   entregado. Los subagentes no hacen push.
5. Informa al usuario qué delegó, qué se verificó y los límites pendientes.
   Retira solo los worktrees temporales propios, limpios y ya revisados.
