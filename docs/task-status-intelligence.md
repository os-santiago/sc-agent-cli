# Task Status Intelligence

El sistema de Task Status ahora **distingue errores esperables de errores bloqueantes** para dar un diagnóstico más preciso del resultado de cada tarea.

---

## Problema Original

**Antes:** Cualquier error marcaba la tarea como `❌ Task incomplete`

```
┌─ Task Status ───────────────────────────────────────────┐
│ ❌ Task incomplete - errors encountered
│
│    Could not complete the task due to errors.
│    See error summary above for details.
└─────────────────────────────────────────────────────────┘
```

**Problema:**
- ❌ PR #176 no existe → Marcaba incomplete
- ❌ Can't approve own PR → Marcaba incomplete
- ❌ Command exit code 1 → Marcaba incomplete

Estos NO son errores bloqueantes, sino **situaciones esperables**.

---

## Solución: Clasificación Inteligente

El sistema ahora **analiza el contexto** para determinar si la tarea se completó:

### 1️⃣ **Errores Bloqueantes** ❌

Impiden completar la tarea:

| Error | Ejemplo |
|-------|---------|
| Permission denied | `EACCES: permission denied` |
| File not found (crítico) | `ENOENT` en read_file/write_file |
| Syntax errors | `SyntaxError: Unexpected token` |
| Access denied | `Access denied to directory` |

**Resultado:** `❌ Task incomplete - blocking errors encountered`

---

### 2️⃣ **Errores Esperables** ✅

Son parte del flujo normal:

| Error | Ejemplo | Por qué es esperable |
|-------|---------|----------------------|
| Command exit code | `Command exited with code 1` | Comandos pueden fallar (normal) |
| GitHub PR not found | `Could not resolve to a PullRequest` | PR ya merged/closed |
| GitHub GraphQL | `GraphQL: ...` | Restricciones de API |
| Can't approve own PR | `Review Can not approve your own` | Restricción GitHub |
| Resource not found (shell) | `not found` en run_shell | Comando buscó algo que no existe |

**Resultado:** `✅ Task completed with notes`

---

## Lógica de Decisión

```typescript
// Criterios para marcar como completado con notas:
if (
  successfulTools.length >= 3 &&        // ≥3 operaciones exitosas
  blockingErrors.length === 0 &&        // No hay errores bloqueantes
  expectableErrors.length > 0 &&        // Solo errores esperables
  !hitIterationLimit                    // No alcanzó límite de iteraciones
) {
  status = '✓ Task completed with notes';
}
```

---

## Casos de Uso

### **Caso 1: Revisión de PRs en GitHub**

**Solicitud:**
```
revisa y aprueba los PR en https://github.com/os-santiago/workspace-os/pulls
```

**Operaciones:**
- ✅ `gh --version` → OK
- ✅ `gh pr list` → 6 PRs encontrados
- ✅ `gh pr view 168` → Detalles OK
- ✅ `gh pr view 167` → Detalles OK
- ❌ `gh pr view 176` → **PR not found** (ya merged)
- ✅ `gh pr view 149, 147, 146, 145` → OK
- ❌ `gh pr review 168` → **Can't approve own PR** (restricción GitHub)

**Antes:**
```
┌─ Task Status ───────────────────────────────────────────┐
│ ❌ Task incomplete - errors encountered              ← MAL
└─────────────────────────────────────────────────────────┘
```

**Ahora:**
```
┌─ Task Status ───────────────────────────────────────────┐
│ ✓ Task completed with notes                          ← CORRECTO
│
│    Successfully completed with 9 operations.
│    2 expected error(s) occurred (not blockers).
│
│    Examples of expected errors:
│    • Resource not found (PR/issue already merged/closed)
│    • GitHub restrictions (can't approve own PR)
│    • Command returned non-zero exit code
└─────────────────────────────────────────────────────────┘
```

---

### **Caso 2: Script con exit code != 0**

**Solicitud:**
```
ejecuta el script test.sh y analiza los resultados
```

**Operaciones:**
- ✅ `read_file test.sh` → OK
- ✅ `run_shell ./test.sh` → Exit code 1 (test falló)
- ✅ `read_file test.log` → OK
- ✅ `search_text "FAILED"` → Encontró 3 tests fallidos

**Resultado:**
```
✓ Task completed with notes

   Successfully completed with 4 operations.
   1 expected error(s) occurred (not blockers).

   • Command returned non-zero exit code
```

**Por qué?** El agente **completó el análisis** aunque el script falló. El exit code != 0 es **esperable** en testing.

---

### **Caso 3: Búsqueda de archivos**

**Solicitud:**
```
busca archivos .env en el proyecto y lista su contenido
```

**Operaciones:**
- ✅ `search_text "^\.env"` → Encontró 0 resultados
- ✅ `run_shell find . -name ".env"` → No encontró archivos
- ✅ `list_dir .` → Listó directorio raíz

**Resultado:**
```
✓ Task completed successfully
```

**Por qué?** No hubo errores. La **ausencia de resultados** no es un error.

---

### **Caso 4: Error bloqueante real**

**Solicitud:**
```
lee el archivo config.json y modifícalo
```

**Operaciones:**
- ❌ `read_file config.json` → **ENOENT: file not found**

**Resultado:**
```
❌ Task incomplete - blocking errors encountered

   Could not complete the task due to:
   • 1 blocking error(s)
   • See error summary above for details.
```

**Por qué?** `ENOENT` en `read_file` es **bloqueante** (archivo crítico no existe).

---

## Output Detallado

### ✅ **Completado con Notas**
```
┌─ Task Status ───────────────────────────────────────────┐
│ ✓ Task completed with notes
│
│    Successfully completed with 9 operations.
│    2 expected error(s) occurred (not blockers).
│
│    Examples of expected errors:
│    • Resource not found (PR/issue already merged/closed)
│    • GitHub restrictions (can't approve own PR)
│    • Command returned non-zero exit code
└─────────────────────────────────────────────────────────┘
```

---

### ❌ **Errores Bloqueantes**
```
┌─ Task Status ───────────────────────────────────────────┐
│ ❌ Task incomplete - blocking errors encountered
│
│    Could not complete the task due to:
│    • 2 blocking error(s)
│    • See error summary above for details.
└─────────────────────────────────────────────────────────┘
```

---

### ⚠️ **Errores Genéricos** (no clasificables)
```
┌─ Task Status ───────────────────────────────────────────┐
│ ⚠️ Task incomplete - errors encountered
│
│    Could not fully complete the task.
│    See error summary above for details.
└─────────────────────────────────────────────────────────┘
```

---

### ⚠️ **Límite de Iteraciones**
```
┌─ Task Status ───────────────────────────────────────────┐
│ ⚠️ Task incomplete - iteration limit reached
│
│    The task may not be fully complete.
│    Reached maximum 10 iterations.
│    Consider increasing SC_MAX_ITERATIONS if needed.
└─────────────────────────────────────────────────────────┘
```

---

### ❌ **Límite + Errores**
```
┌─ Task Status ───────────────────────────────────────────┐
│ ❌ Task incomplete - iteration limit reached with errors
│
│    The task could not be completed due to:
│    • Hit maximum iterations (10)
│    • Encountered 3 error(s)
└─────────────────────────────────────────────────────────┘
```

---

## Matriz de Decisión

| Condición | Operaciones exitosas | Errores bloqueantes | Errores esperables | Límite iteraciones | Resultado |
|-----------|---------------------|---------------------|--------------------|--------------------|-----------|
| 1 | ≥3 | 0 | >0 | No | ✅ **Completed with notes** |
| 2 | Cualquiera | >0 | Cualquiera | No | ❌ **Blocking errors** |
| 3 | <3 | 0 | >0 | No | ⚠️ **Incomplete - errors** |
| 4 | Cualquiera | Cualquiera | Cualquiera | Sí + errores | ❌ **Limit + errors** |
| 5 | Cualquiera | 0 | 0 | Sí | ⚠️ **Limit reached** |
| 6 | Cualquiera | 0 | 0 | No | ✅ **Completed successfully** |

---

## Beneficios

### 1️⃣ **Percepción Correcta**
El usuario ve ✅ cuando la tarea **SÍ** se completó (aunque con notas).

**Antes:**
```
❌ incomplete → Usuario piensa "no funcionó"
```

**Ahora:**
```
✅ completed with notes → Usuario entiende "funcionó, pero hubo detalles"
```

---

### 2️⃣ **Reduce Falsos Negativos**

| Escenario | Antes | Ahora |
|-----------|-------|-------|
| PR no existe (ya merged) | ❌ incomplete | ✅ completed with notes |
| Can't approve own PR | ❌ incomplete | ✅ completed with notes |
| Script exit code 1 | ❌ incomplete | ✅ completed with notes |
| Test falló (pero analizó) | ❌ incomplete | ✅ completed with notes |

---

### 3️⃣ **Mensajes Contextuales**

Explica **por qué** marcó como completado con errores:

```
Examples of expected errors:
• Resource not found (PR/issue already merged/closed)
• GitHub restrictions (can't approve own PR)
• Command returned non-zero exit code
```

El usuario entiende que **no requiere intervención**.

---

### 4️⃣ **Detección Real de Problemas**

Cuando hay errores **bloqueantes**, los identifica claramente:

```
❌ Task incomplete - blocking errors encountered

   • 2 blocking error(s)
```

---

## Extensibilidad

### Agregar Nuevo Error Esperable

Edita `src/core/agent.ts`:

```typescript
const expectableErrors = failedTools.filter(t => {
  const errorMsg = (t.error || '').toLowerCase();
  const isExpectable =
    errorMsg.includes('command exited with code') ||
    errorMsg.includes('could not resolve to') ||
    errorMsg.includes('your new pattern here'); // ← Agrega aquí
  return isExpectable;
});
```

---

### Agregar Nuevo Error Bloqueante

```typescript
const blockingErrors = failedTools.filter(t => {
  const errorMsg = (t.error || '').toLowerCase();
  const isBlocking =
    errorMsg.includes('permission denied') ||
    errorMsg.includes('your new pattern here'); // ← Agrega aquí
  return isBlocking;
});
```

---

## Variables de Entorno

Ninguna. La clasificación es **automática** basada en patrones de error.

---

## Limitaciones

### 1. **Requiere ≥3 Operaciones Exitosas**

Si solo hay 1-2 operaciones exitosas + errores esperables → Marca como `incomplete`.

**Razón:** Trabajo insuficiente para confirmar que completó.

**Ejemplo:**
```
✅ gh --version
❌ gh pr view 999 (not found)
```
→ `⚠️ incomplete` (solo 1 operación exitosa)

---

### 2. **Patrones Codificados**

Los errores esperables están **codificados en el código**, no son configurables.

**Solución futura:** Sistema de reglas configurable vía JSON/YAML.

---

### 3. **Shell Commands Ambiguos**

`run_shell` con exit code 1 → **Esperable**

Pero en algunos casos `exit code 1` SÍ es bloqueante (ej: `git clone` falló).

**Mitigación:** El agente debe manejar con retry/fallback.

---

## Testing

### Test 1: Revisión GitHub
```bash
scc chat --unlimited "revisa PRs en https://github.com/owner/repo/pulls"
```

**Esperado:** ✅ Completed with notes (si hay PR not found o can't approve)

---

### Test 2: Script Failing
```bash
scc chat "ejecuta ./test.sh y analiza los resultados"
```

**Esperado:** ✅ Completed with notes (si exit code != 0 pero analizó)

---

### Test 3: File Not Found (Bloqueante)
```bash
scc chat "lee el archivo non-existent.txt"
```

**Esperado:** ❌ Blocking errors

---

### Test 4: Permission Denied
```bash
scc chat "escribe en /etc/passwd"
```

**Esperado:** ❌ Blocking errors

---

## Ver También

- [README.md](../README.md) - Documentación principal
- [permissions.md](permissions.md) - Sistema de permisos
- [error-handling.md](error-handling.md) - Manejo de errores

---

## Changelog

### v0.2.0 (2026-06-27)
- ✅ Clasificación inteligente de errores (bloqueantes vs esperables)
- ✅ Task Status: "Completed with notes" para errores esperables
- ✅ Mensajes contextuales explicativos
- ✅ Matriz de decisión basada en contexto
