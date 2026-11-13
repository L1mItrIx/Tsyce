# Instrucciones para Codex y otros agentes

Antes de trabajar, lee [CLAUDE.md](CLAUDE.md). Es la fuente compartida de reglas
para Codex y Claude; este archivo es su punto de entrada, no otro plan.

Lee las skills indicadas allí desde `.claude/skills/`, aunque tu cliente no las
descubra automáticamente. Para tareas no triviales, aplica `httpi-paralelo` antes
de repartir el trabajo. Sus reglas se aplican también a los subagentes.

Las instrucciones explícitas del usuario y las restricciones de la herramienta
tienen precedencia. Usa solo capacidades disponibles: un subagente de Codex no
equivale a ejecutar Claude, y viceversa. No afirmes que otro modelo participó si
no lo ejecutaste realmente.
