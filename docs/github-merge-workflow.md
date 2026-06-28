# GitHub PR Merge Workflow

El agente ahora **verifica status checks ANTES de intentar merge**, evitando intentos fallidos repetidos.

---

## Problema Original

**Antes:** El agente intentaba merge sin verificar estado:

```bash
User: "merge los PRs approved"

Agent:
  gh pr merge 169          → ❌ base branch policy prohibits
  gh pr merge 169 --admin  → ❌ Code Scanning pending
  gh pr merge 168 --admin  → ❌ Code Scanning pending
  gh pr merge 167 --admin  → ❌ Code Scanning pending
```

**Resultado:** 4 intentos fallidos del mismo error.

---

## Nuevo Workflow

El agente ahora sigue un workflow de **3 pasos**:

### **Step 1: Verificar Estado del PR**

```bash
gh pr view <number> --repo owner/repo \
  --json statusCheckRollup,mergeable,mergeStateStatus
```

**Campos clave:**
- `mergeable`: `MERGEABLE`, `CONFLICTING`, `UNKNOWN`
- `statusCheckRollup`: Array de checks con estado
- `mergeStateStatus`: `CLEAN`, `BLOCKED`, `BEHIND`, etc.

---

### **Step 2: Analizar Respuesta**

El agente **detiene el merge** si detecta alguno de estos casos:

| Condición | Mensaje | Acción |
|-----------|---------|--------|
| `mergeable = "CONFLICTING"` | Merge conflicts detected | STOP - Resolver conflictos |
| `mergeable = "UNKNOWN"` | Branch protection rules pending | STOP - Esperar validación |
| `statusCheckRollup` con `PENDING` | Status checks pending | STOP - Esperar checks |
| `statusCheckRollup` con `FAILURE` | Status checks failed | STOP - Fix failing checks |
| `mergeStateStatus = "BLOCKED"` | PR is blocked | STOP - Resolver bloqueo |

**Ejemplo de respuesta bloqueada:**

```json
{
  "mergeable": "UNKNOWN",
  "mergeStateStatus": "BLOCKED",
  "statusCheckRollup": [
    {
      "context": "Code Scanning",
      "state": "PENDING",
      "description": "Waiting for Code Scanning results"
    }
  ]
}
```

**Análisis del agente:**
```
Cannot merge PR #169:
• Code Scanning checks are required but pending
• Branch protection prevents merge until checks pass
```

---

### **Step 3: Solo Hacer Merge Si Todo Pasa**

**Criterios para intentar merge:**

```typescript
if (
  mergeable === "MERGEABLE" &&
  allChecks.every(check => check.state === "SUCCESS" || check.state === "NEUTRAL") &&
  mergeStateStatus === "CLEAN"
) {
  // OK para hacer merge
  gh pr merge <number> --repo owner/repo --merge --delete-branch
}
```

---

## Casos Bloqueados Comunes

### **1. Code Scanning Pending**

**Error:**
```
GraphQL: Repository rule violations found
Waiting for Code Scanning results. Code Scanning may not be configured for the target branch.
```

**Causa:** Branch protection requiere Code Scanning, pero:
- No está configurado para la branch target
- O está corriendo pero aún no termina

**Solución del agente:**
```
Cannot merge - Code Scanning pending.

Options:
1. Wait for Code Scanning to complete
2. Use --auto flag to queue merge when checks pass:
   gh pr merge 169 --auto --merge --delete-branch
3. Disable Code Scanning requirement (requires admin)
```

---

### **2. Required Reviews Missing**

**Error:**
```
GraphQL: At least 1 approving review is required by reviewers with write access
```

**Causa:** Branch protection requiere N reviews, pero solo hay M < N.

**Solución del agente:**
```
Cannot merge - Missing required reviews.

Required: 2 approving reviews
Current: 1 approving review

Action: Request additional review from team members.
```

---

### **3. Merge Conflicts**

**Error:**
```
Pull request is not mergeable: merge conflicts must be resolved
```

**Causa:** Conflictos con la base branch.

**Solución del agente:**
```
Cannot merge - Merge conflicts detected.

Action:
1. Checkout PR branch: gh pr checkout 169
2. Merge base branch: git merge main
3. Resolve conflicts manually
4. Push updated branch
```

---

### **4. Behind Base Branch**

**Error:**
```
GraphQL: Head branch is out-of-date with the base branch
```

**Causa:** Base branch tiene commits nuevos.

**Solución del agente:**
```
Cannot merge - Branch is out of date.

Action:
1. Update branch: gh pr merge 169 --auto --merge
   (auto-merges when updated)
2. Or manually: git merge main && git push
```

---

## Auto-Merge con --auto Flag

Para PRs que esperan checks pendientes:

```bash
gh pr merge 169 --auto --merge --delete-branch
```

**Comportamiento:**
- ✅ Pone el PR en cola para auto-merge
- ✅ Cuando todos los checks pasen → merge automático
- ✅ Cuando checks fallen → no hace merge
- ✅ Notifica al autor vía GitHub

**Cuándo usar:**
- Code Scanning está corriendo pero no ha terminado
- CI/CD tiene builds en progreso
- Waiting for required status checks

---

## Flag --admin (Usar con Cuidado)

```bash
gh pr merge 169 --admin --merge
```

**Comportamiento:**
- ⚠️ **BYPASSA branch protection rules**
- ⚠️ Hace merge AUNQUE checks fallen
- ⚠️ Hace merge AUNQUE falten reviews
- ⚠️ Requiere permisos de admin en el repo

**Cuándo usar:**
- **NUNCA sin permiso explícito del usuario**
- Emergencias (hotfix crítico)
- Branch protection mal configurado (temporal)

**El agente NUNCA usa --admin sin que el usuario lo pida explícitamente.**

---

## Output del Agente

### **Caso 1: Merge Exitoso**

```
┌─ Task Status ───────────────────────────────────────────┐
│ ✓ Task completed successfully
│
│    Successfully merged PRs: #168, #167
│    Deleted branches: feature-168, feature-167
└─────────────────────────────────────────────────────────┘
```

---

### **Caso 2: Branch Protection Bloquea Merge**

```
┌─ Task Status ───────────────────────────────────────────┐
│ ✓ Task completed with notes
│
│    Successfully completed with 2 operations.
│    4 expected error(s) occurred (not blockers).
│
│    Branch protection prevented merge:
│    • Code Scanning checks are required but pending
│    • Use --auto flag to queue merge when checks pass
│    • Or wait for required status checks to complete
└─────────────────────────────────────────────────────────┘
```

**Por qué "completed with notes"?**
- ✅ El agente **SÍ** completó la tarea (revisó los PRs)
- ✅ Identificó que no puede hacer merge (por branch protection)
- ✅ Explicó por qué y sugirió soluciones
- ✅ No es un fallo del agente, es política del repo

---

### **Caso 3: Errores Repetidos (Loop Detection)**

```
┌─ Warning ───────────────────────────────────────────────┐
│ ⚠ Detected repeated errors (possible infinite loop)
│
│    • 4x: repository rule violations found...
│
│    The agent attempted the same failing operation multiple times.
│    This usually indicates a need for a different approach.
└─────────────────────────────────────────────────────────┘

┌─ Task Status ───────────────────────────────────────────┐
│ ⚠️ Task incomplete - errors encountered
│
│    Could not fully complete the task.
│    See error summary above for details.
└─────────────────────────────────────────────────────────┘
```

**Por qué "incomplete"?**
- ❌ El agente reintentó 4x el mismo error
- ❌ No cambió de enfoque
- ❌ No verificó status ANTES (esto ya está corregido)

---

## jq Syntax para Windows

**Problema:** Single quotes en jq fallan en Windows.

### ❌ **Mal:**

```bash
# Falla en Windows (single quotes):
gh api repos/owner/repo --jq '.default_branch'

# Falla (múltiples args):
gh api repos/owner/repo --jq '.has_issues, .has_wiki'
```

### ✅ **Bien:**

```bash
# Double quotes (cross-platform):
gh api repos/owner/repo --jq ".default_branch"

# MEJOR: Usar --template (nativo gh):
gh api repos/owner/repo --template '{{.default_branch}}'

# Múltiples campos (JSON válido):
gh api repos/owner/repo --jq "{branch: .default_branch, private: .private}"
```

**El agente ahora usa:**
1. **Preferencia:** `--template` (nativo, sin jq)
2. **Fallback:** `--jq "..."` con double quotes
3. **Nunca:** Single quotes

---

## Ejemplos de Uso

### **Ejemplo 1: Merge PRs Aprobados**

```bash
User: merge los PRs approved en https://github.com/os-santiago/workspace-os
```

**Workflow del agente:**

```bash
# 1. Listar PRs
gh pr list --repo os-santiago/workspace-os --state open

# 2. Por cada PR aprobado, verificar status
gh pr view 169 --repo os-santiago/workspace-os \
  --json statusCheckRollup,mergeable,mergeStateStatus

# 3a. Si mergeable = MERGEABLE → hacer merge
gh pr merge 169 --repo os-santiago/workspace-os --merge --delete-branch

# 3b. Si Code Scanning pending → sugerir --auto
Response: "PR #169 is blocked by Code Scanning. Use --auto to queue merge when checks pass."
```

---

### **Ejemplo 2: Forzar Merge con --admin (Usuario lo pide)**

```bash
User: merge el PR #169 aunque tenga checks pendientes, usa --admin
```

**Workflow del agente:**

```bash
# Verifica status (igual que siempre)
gh pr view 169 --json statusCheckRollup,mergeable

# Como usuario pidió --admin explícitamente:
gh pr merge 169 --admin --merge --delete-branch

# Warning al usuario:
Response: "⚠️ Used --admin flag to bypass branch protection. Merged PR #169 despite pending checks."
```

---

### **Ejemplo 3: Auto-Merge Pending Checks**

```bash
User: merge el PR #169, si hay checks pendientes usa auto-merge
```

**Workflow del agente:**

```bash
# Verifica status
gh pr view 169 --json statusCheckRollup,mergeable

# Si mergeable != MERGEABLE → usa --auto
gh pr merge 169 --auto --merge --delete-branch

# Response:
"PR #169 queued for auto-merge. Will merge automatically when Code Scanning completes."
```

---

## Beneficios

### **1. Previene Intentos Fallidos**

**Antes:**
```
4 intentos de merge → 4 errores idénticos
```

**Ahora:**
```
1 verificación de status → 0 intentos (si bloqueado)
```

**Ahorro:** 75% menos llamadas API fallidas.

---

### **2. Mensajes Más Informativos**

**Antes:**
```
❌ Task incomplete - errors encountered
   Could not complete the task due to errors.
```

**Ahora:**
```
✓ Task completed with notes
   Branch protection prevented merge:
   • Code Scanning checks are required but pending
   • Use --auto flag to queue merge when checks pass
```

**Beneficio:** Usuario entiende QUÉ bloqueó y CÓMO solucionarlo.

---

### **3. Respeta Branch Protection**

**Antes:** Intentaba --admin sin preguntar.

**Ahora:**
- ✅ Verifica status primero
- ✅ Sugiere --auto para auto-merge
- ✅ **NUNCA** usa --admin sin permiso explícito

**Beneficio:** No bypasea políticas de seguridad del repo.

---

## Configuración de Branch Protection

Para que este workflow funcione óptimamente, configura branch protection:

### **GitHub Web UI:**

1. Repo → Settings → Branches → Add rule
2. Branch name pattern: `main` (o tu branch default)
3. Require status checks to pass:
   - ✅ Code Scanning
   - ✅ CI/CD (GitHub Actions)
   - ✅ Tests
4. Require review approvals: 1 (o más)
5. Save changes

### **GitHub CLI:**

```bash
# Ver reglas actuales
gh api repos/owner/repo/branches/main/protection

# Habilitar Code Scanning requirement
gh api repos/owner/repo/branches/main/protection \
  -X PUT \
  -F required_status_checks[strict]=true \
  -F required_status_checks[contexts][]=Code Scanning
```

---

## Troubleshooting

### **Problema: "Code Scanning may not be configured"**

**Causa:** Branch protection requiere Code Scanning, pero no está configurado.

**Solución:**

1. Habilitar Code Scanning en GitHub:
   - Repo → Security → Code scanning → Set up Code Scanning
   - Choose: GitHub's CodeQL analysis

2. O desactivar requirement:
   - Settings → Branches → Edit rule
   - Desmarcar "Code Scanning"

---

### **Problema: "gh pr merge" requiere --auto pero no funciona**

**Causa:** PR tiene merge conflicts.

**Solución:**

```bash
# Verificar status
gh pr view 169 --json mergeable

# Si mergeable = "CONFLICTING":
gh pr checkout 169
git merge main
# Resolver conflictos
git push
```

---

### **Problema: Agente usa single quotes en jq (Windows)**

**Causa:** Bug ya corregido.

**Solución:** Actualiza a versión con el fix (commit 7ab4983).

---

## Ver También

- [task-status-intelligence.md](task-status-intelligence.md) - Clasificación de errores
- [loop-detection.md](loop-detection.md) - Detección de loops
- [permissions.md](permissions.md) - Sistema de permisos

---

## Changelog

### v0.2.1 (2026-06-27)
- ✅ Workflow de 3 pasos para PR merge
- ✅ Verificación de status checks ANTES de merge
- ✅ Mensajes contextuales para branch protection
- ✅ Fix jq syntax para Windows
- ✅ NUNCA usa --admin sin permiso explícito
- ✅ Sugiere --auto para auto-merge cuando checks pending
