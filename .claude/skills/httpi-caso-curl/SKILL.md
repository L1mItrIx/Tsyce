---
name: httpi-caso-curl
description: Úsala al añadir o corregir cualquier cosa del importador de curl de httpi: un flag nuevo, un caso de comillas, un bug de parseo en Bash, cmd o PowerShell. Fija el procedimiento "fixture primero" para que cada caso quede cubierto una sola vez y en el lugar correcto.
---

# Añadir o corregir un caso de curl

El importador tiene dos etapas que no se mezclan:

| Etapa | Archivos | Entrada → salida | Sabe de |
|---|---|---|---|
| Tokenizar | `importer/tokenize-{bash,cmd,powershell}.ts` | texto → `string[]` | Comillas y escapes del shell. Nada de curl |
| Mapear | `importer/map-flags.ts` | `string[]` → request + advertencias | Flags de curl. Nada de shells |

Primero decide a cuál pertenece el problema. Un flag nuevo va solo en `map-flags`. Un problema de comillas va solo en el tokenizador de ese dialecto.

## Procedimiento

1. **Fixture primero.** Añade el curl real a `test/fixtures/curl/<dialecto>/` tal como lo copia la herramienta de origen (DevTools, Postman, docs). Sustituye tokens y cookies reales por valores falsos.
2. **Caso en la tabla.** Añade una fila a la tabla de tests de esa etapa (`it.each`): entrada, salida esperada. No crees un archivo de test nuevo por caso.
3. **Míralo fallar.** Corre solo ese test y confirma que falla por la razón esperada.
4. **Implementa** lo mínimo en el archivo de esa etapa.
5. **Oráculo (solo Bash):** compara con `curlconverter` en el test de oráculo. Si difieren, decide cuál tiene razón probando con curl real y deja la razón en un comentario del caso.
6. **Equivalentes:** si el caso es de comillas, pregunta si existe su análogo en los otros dos dialectos y añádelo a sus tablas.

## Reglas

- Flag que no está en la lista blanca de `PLAN.md` §3 → advertencia con el nombre del flag. Nunca se ignora en silencio ni lanza excepción.
- El cuerpo (`-d`, `--data-raw`, `--json`) se guarda tal cual llegó; no lo re-serialices.
- Formas a normalizar en `map-flags`, no en los tokenizadores: `-XPOST`, `-sSL`, `--flag=valor`.
- `Authorization`, `-u` y cookies se marcan como secretos para ofrecer `{{variable}}`.
- No uses expresiones regulares para tokenizar: máquina de estados carácter a carácter.

## Diferencias que suelen fallar

| Dialecto | Escape | Continuación de línea | Comillas |
|---|---|---|---|
| Bash | `\` | `\` al final | `'...'` literal; `"..."` con escapes; `$'...'` ANSI-C |
| cmd | `^` | `^` al final | Solo `"..."`; DevTools antepone `^` a caracteres especiales (verificar con fixtures reales) |
| PowerShell | `` ` `` | `` ` `` al final | `'...'` con `''`; `"..."` con `` `" ``; el binario es `curl.exe` |
