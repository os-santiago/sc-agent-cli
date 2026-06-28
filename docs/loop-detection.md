# Loop Detection

El agente ahora **detecta errores repetidos** (loops infinitos) y advierte al usuario cuando reintenta la misma operación fallida múltiples veces.

---

## Problema Original

**Antes:** El agente podía quedar atrapado reintentando el mismo comando fallido sin parar.

```bash
User: "merge el PR #169"

Agent:
  Iteration 1: gh pr merge 169      → ❌ policy prohibits
  Iteration 2: gh pr merge 169      → ❌ policy prohibits
  Iteration 3: gh pr merge 169      → ❌ policy prohibits
  Iteration 4: gh pr merge 169      → ❌ policy prohibits
  ...
  Iteration 100: gh pr merge 169    → ❌ policy prohibits (MAX_ITERATIONS)
```

**Resultado:** 100 intentos fallidos idénticos, sin cambiar de enfoque.

---

## Solución: Loop Detection

El sistema ahora **cuenta errores por tipo** y detecta cuando el mismo error aparece **≥3 veces**:

```typescript
// Contar errores idénticos
const errorCounts = new Map<string, number>();
failedTools.forEach(t => {
  // Normalizar error (primera línea, lowercase, truncado a 100 chars)
  const errorKey = (t.error || 'Unknown error')
    .split('\n')[0]
    .toLowerCase()
    .trim()
    .substring(0, 100);
  
  errorCounts.set(errorKey, (errorCounts.get(errorKey) || 0) + 1);
});

// Detectar loops (≥3 del mismo error)
const repeatedErrors = Array.from(errorCounts.entries())
  .filter(([_, count]) => count >= 3);
```

---

## Output del Usuario

### **Warning Visible**

Cuando se detecta un loop:

```
┌─ Warning ───────────────────────────────────────────────┐
│ ⚠ Detected repeated errors (possible infinite loop)
│
│    • 4x: repository rule violations found...
│    • 3x: command exited with code 1...
│
│    The agent attempted the same failing operation multiple times.
│    This usually indicates a need for a different approach.
└─────────────────────────────────────────────────────────┘
```

**Información mostrada:**
- Cuántas veces se repitió cada error (4x, 3x, etc.)
- Primeros 50 caracteres del mensaje de error
- Sugerencia de cambiar de enfoque

---

### **Task Status Ajustado**

Con loop detection, el Task Status se mantiene como `incomplete`:

```
┌─ Task Status ───────────────────────────────────────────┐
│ ⚠️ Task incomplete - errors encountered
│
│    Could not fully complete the task.
│    See error summary above for details.
└─────────────────────────────────────────────────────────┘
```

**Por qué incomplete?**
- ❌ El agente no cambió de enfoque
- ❌ Reintentó lo mismo que ya falló
- ❌ No cumplió criterios de "completed with notes" (≥3 operaciones exitosas)

---

## Casos de Uso

### **Caso 1: GitHub Branch Protection Loop**

**Solicitud:**
```bash
User: merge los PRs approved en https://github.com/os-santiago/workspace-os
```

**ANTES del fix (sin loop detection):**

```
Iteration 1:
  gh pr merge 169          → ❌ policy prohibits
  
Iteration 2:
  gh pr merge 169 --admin  → ❌ Code Scanning pending
  
Iteration 3:
  gh pr merge 168 --admin  → ❌ Code Scanning pending
  
Iteration 4:
  gh pr merge 167 --admin  → ❌ Code Scanning pending

Result: ❌ Task incomplete - errors encountered
(no mention of repeated errors)
```

**DESPUÉS del fix (con loop detection):**

```
Iteration 1:
  gh pr view 169 --json statusCheckRollup,mergeable  → ✓ OK
  (detects Code Scanning pending)

Iteration 2:
  (stops, explains why can't merge)

⚠ Detected repeated errors (possible infinite loop)
   • 3x: waiting for code scanning results...
   
✓ Task completed with notes
   Branch protection prevented merge:
   • Code Scanning checks are required but pending
   • Use --auto flag to queue merge when checks pass
```

**Mejora:**
- ✅ Solo 1 intento (verifica status primero)
- ✅ Detecta loop si reintenta
- ✅ Explica por qué no puede hacer merge

---

### **Caso 2: Comando Inexistente**

**Solicitud:**
```bash
User: ejecuta el comando "comando-inexistente" 5 veces
```

**ANTES del fix:**

```
Iteration 1: run_shell "comando-inexistente"  → ❌ command not found
Iteration 2: run_shell "comando-inexistente"  → ❌ command not found
Iteration 3: run_shell "comando-inexistente"  → ❌ command not found
Iteration 4: run_shell "comando-inexistente"  → ❌ command not found
Iteration 5: run_shell "comando-inexistente"  → ❌ command not found

Result: ❌ Task incomplete - errors encountered
(no loop warning)
```

**DESPUÉS del fix:**

```
Iteration 1: run_shell "comando-inexistente"  → ❌ command not found
Iteration 2: run_shell "comando-inexistente"  → ❌ command not found
Iteration 3: run_shell "comando-inexistente"  → ❌ command not found

⚠ Detected repeated errors (possible infinite loop)
   • 3x: command not found: comando-inexistente

Result: ❌ Task incomplete - errors encountered
```

**Mejora:**
- ✅ Warning después de 3 intentos
- ✅ Usuario ve el loop claramente

---

### **Caso 3: File Not Found Loop**

**Solicitud:**
```bash
User: lee el archivo config.json y modifícalo
```

**Escenario:** El archivo no existe, pero el agente reintenta.

**ANTES del fix:**

```
Iteration 1: read_file "config.json"   → ❌ ENOENT
Iteration 2: read_file "config.json"   → ❌ ENOENT
Iteration 3: read_file "./config.json" → ❌ ENOENT
Iteration 4: read_file "config.json"   → ❌ ENOENT

Result: ❌ Task incomplete - errors encountered
```

**DESPUÉS del fix:**

```
Iteration 1: read_file "config.json"   → ❌ ENOENT
Iteration 2: read_file "./config.json" → ❌ ENOENT
Iteration 3: read_file "config.json"   → ❌ ENOENT

⚠ Detected repeated errors (possible infinite loop)
   • 3x: enoent: no such file or directory, open 'config.json'

Result: ❌ Task incomplete - blocking errors encountered
```

**Mejora:**
- ✅ Loop warning después de 3 intentos
- ✅ Clasificado como "blocking error" (ENOENT en read_file)

---

## Umbral de Detección

### **3 Repeticiones = Loop**

**Por qué 3?**

1. **1 intento:** Normal, puede ser error temporal
2. **2 intentos:** Retry razonable (network, timeout)
3. **3+ intentos:** Ya es un patrón, probablemente loop

**Ejemplo:**

```typescript
// 2 repeticiones → No es loop (aún)
Iteration 1: curl https://api.github.com → ❌ timeout
Iteration 2: curl https://api.github.com → ✓ OK
Result: No loop warning

// 3 repeticiones → Loop detectado
Iteration 1: curl https://broken-url.com → ❌ timeout
Iteration 2: curl https://broken-url.com → ❌ timeout
Iteration 3: curl https://broken-url.com → ❌ timeout
Result: ⚠ Loop warning
```

---

## Normalización de Errores

Los errores se normalizan para detectar duplicados:

```typescript
// Ejemplo de normalización:

// Error original:
"Error: ENOENT: no such file or directory, open '/home/user/config.json'\n  at Object.openSync (fs.js:498:3)"

// Normalizado para comparación:
"error: enoent: no such file or directory, open '/home/user/config.json'"
                                                                ↑ 100 chars max
```

**Pasos de normalización:**

1. Tomar solo primera línea (`split('\n')[0]`)
2. Convertir a lowercase (`.toLowerCase()`)
3. Eliminar espacios extras (`.trim()`)
4. Truncar a 100 caracteres (`.substring(0, 100)`)

**Por qué normalizar?**

- ✅ Errores idénticos se agrupan (ENOENT en diferentes paths)
- ✅ Ignora stack traces (solo primera línea)
- ✅ Ignora case sensitivity

---

## Interacción con Task Status

### **Loop Detection NO cambia Task Status automáticamente**

El loop detection **solo advierte**, el Task Status se decide por la lógica normal:

```typescript
// Loop detection:
const hasRepeatedErrors = repeatedErrors.length > 0;

// Task Status decision (independiente):
if (successfulTools >= 3 && hasOnlyExpectableErrors) {
  status = 'completed with notes';
} else if (blockingErrors.length > 0) {
  status = 'blocking errors';
} else {
  status = 'incomplete - errors encountered';
}
```

**Ejemplo:**

```
Operaciones:
- ✅ gh --version
- ✅ gh pr list
- ❌ gh pr merge 169 (3x loop)

Loop detection: ⚠ Warning
Task Status: ⚠️ incomplete (solo 2 exitosas, necesita ≥3)
```

---

## Casos NO Detectados como Loop

### **Errores Diferentes**

```
Iteration 1: gh pr merge 169  → ❌ policy prohibits
Iteration 2: gh pr merge 168  → ❌ Code Scanning pending
Iteration 3: gh pr merge 167  → ❌ merge conflicts

Result: No loop (3 errores DIFERENTES)
```

---

### **Mismo Error en Tools Diferentes**

```
Iteration 1: read_file "config.json"    → ❌ ENOENT
Iteration 2: write_file "config.json"   → ❌ ENOENT
Iteration 3: edit_file "config.json"    → ❌ ENOENT

Result: No loop (tools diferentes, aunque error similar)
```

**Por qué?** El agente SÍ está intentando enfoques diferentes (read, write, edit).

---

## Configuración

### **Cambiar Umbral de Detección**

Actualmente hardcoded a 3. Para cambiar:

```typescript
// src/core/agent.ts
const LOOP_THRESHOLD = 3; // Cambiar a 2, 4, 5, etc.

const repeatedErrors = Array.from(errorCounts.entries())
  .filter(([_, count]) => count >= LOOP_THRESHOLD);
```

**Recomendación:** Mantener en 3 (balance entre false positives y detección temprana).

---

### **Desactivar Loop Detection**

No hay flag aún. Para desactivar:

```typescript
// src/core/agent.ts
// Comentar estas líneas:

// if (hasRepeatedErrors) {
//   console.log(chalk.gray('\n  ┌─ Warning ───────────────────────────────────────────────┐'));
//   ...
// }
```

**Mejor opción:** Agregar env var `SC_DISABLE_LOOP_DETECTION=true`.

---

## Mejoras Futuras

### **1. Auto-Stop After 3 Loops**

Actualmente solo **advierte**, no **detiene**.

**Propuesta:**

```typescript
if (hasRepeatedErrors && repeatedErrors[0][1] >= 5) {
  // Forzar fin del loop
  continueLoop = false;
  console.log('⚠ Stopped agent - too many repeated errors');
}
```

---

### **2. Sugerir Enfoque Alternativo**

**Propuesta:**

```typescript
if (hasRepeatedErrors) {
  const [errorKey, count] = repeatedErrors[0];
  
  if (errorKey.includes('enoent')) {
    console.log('💡 Suggestion: Check if file exists with list_dir before reading');
  } else if (errorKey.includes('repository rule violations')) {
    console.log('💡 Suggestion: Use --auto flag to queue merge when checks pass');
  }
}
```

---

### **3. Tracking de Loops por Sesión**

Guardar loops detectados en memoria de sesión:

```typescript
// .claude/session-loops.json
{
  "2026-06-27": [
    {
      "error": "repository rule violations found",
      "count": 4,
      "timestamp": "2026-06-27T18:30:00Z"
    }
  ]
}
```

**Beneficio:** Análisis de patrones comunes de loops.

---

## Testing

### **Test 1: GitHub Branch Protection Loop**

```bash
# Antes del fix (verificar que sí se repite):
git checkout <commit-antes-del-fix>
npm run build
echo "merge PR approved en https://github.com/os-santiago/workspace-os" | node dist/cli.js chat --yes

Esperado:
- 4+ intentos de merge
- Sin warning de loop
- ❌ incomplete
```

```bash
# Después del fix:
git checkout main
npm run build
echo "merge PR approved en https://github.com/os-santiago/workspace-os" | node dist/cli.js chat --yes

Esperado:
- 1 intento de merge (verifica status primero)
- ⚠ Loop warning (si reintenta)
- ✓ completed with notes
```

---

### **Test 2: Comando Inexistente**

```bash
echo "ejecuta 'comando-inexistente' 5 veces" | node dist/cli.js chat --yes

Esperado:
- 3 intentos (o los que el agente decida)
- ⚠ Loop warning después de 3x
- ❌ incomplete
```

---

### **Test 3: File Not Found**

```bash
echo "lee el archivo archivo-inexistente.txt y modifícalo" | node dist/cli.js chat --yes

Esperado:
- 2-3 intentos de read_file
- ⚠ Loop warning si ≥3
- ❌ blocking errors (ENOENT)
```

---

## Beneficios

### **1. Visibilidad de Loops**

**Antes:** Loops silenciosos (user no sabía)

**Ahora:** Warning visible con conteo exacto

---

### **2. Diagnóstico Más Rápido**

**Antes:**
```
❌ Task incomplete - errors encountered
(user tiene que revisar 100 errores para entender)
```

**Ahora:**
```
⚠ Detected repeated errors (possible infinite loop)
   • 4x: repository rule violations found...

(user ve inmediatamente que es un loop)
```

---

### **3. Incentiva Cambio de Enfoque**

El warning sugiere "need for a different approach", incentivando al usuario a:
- Revisar la solicitud
- Dar más contexto
- Cambiar el comando

---

## Ver También

- [github-merge-workflow.md](github-merge-workflow.md) - GitHub PR merge workflow
- [task-status-intelligence.md](task-status-intelligence.md) - Clasificación de errores
- [permissions.md](permissions.md) - Sistema de permisos

---

## Changelog

### v0.2.1 (2026-06-27)
- ✅ Loop detection para errores repetidos (≥3x)
- ✅ Warning visible con conteo por tipo de error
- ✅ Normalización de errores para comparación
- ✅ Sugerencia de cambiar de enfoque
- ✅ No cambia Task Status (solo advierte)
