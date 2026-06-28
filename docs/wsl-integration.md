# WSL Integration

El agente ahora soporta **WSL (Windows Subsystem for Linux)**, permitiendo usar cuentas de GitHub diferentes en Windows vs WSL.

---

## Caso de Uso Principal

**Problema:** Eres el autor de los PRs en GitHub, pero necesitas aprobarlos antes de hacer merge. GitHub no permite aprobar tus propios PRs.

**Solución:** Tener una **segunda cuenta de GitHub** logueada en WSL que pueda aprobar los PRs, y luego hacer merge desde Windows o WSL.

---

## Comandos Básicos WSL

### Ejecutar Comando en WSL

```bash
wsl <command>              # Run en default distro (Ubuntu)
wsl -d Ubuntu <command>    # Run en distro específica
wsl.exe bash -c "<cmd>"    # Run bash command
```

**Ejemplos:**
```bash
wsl ls -la                 # List files en WSL
wsl gh auth status         # Check GitHub account en WSL
wsl git log --oneline      # Git log desde WSL
```

---

## GitHub: Cuentas Diferentes (Windows vs WSL)

### Check Qué Cuenta Está Logueada

**En Windows (PowerShell/CMD):**
```bash
gh auth status
gh api user --jq ".login"
```

**En WSL (desde Windows):**
```bash
wsl gh auth status
wsl gh api user --jq ".login"
```

**Resultado Esperado:**
```
Windows: user-main (author)
WSL:     user-approver (approver)
```

---

## Workflow: Aprobar y Merge con WSL

### Paso 1: Verificar Cuenta en WSL

```bash
wsl gh api user --jq ".login"
```

**Output:**
```
user-approver
```

---

### Paso 2: Aprobar PRs con Cuenta de WSL

```bash
wsl gh pr review 170 --approve --repo os-santiago/workspace-os
wsl gh pr review 147 --approve --repo os-santiago/workspace-os
wsl gh pr review 146 --approve --repo os-santiago/workspace-os
```

**Output:**
```
✓ Approved pull request #170
✓ Approved pull request #147
✓ Approved pull request #146
```

---

### Paso 3: Merge PRs (Windows o WSL)

**Opción A: Desde Windows**
```bash
gh pr merge 170 --merge --repo os-santiago/workspace-os
gh pr merge 147 --merge --repo os-santiago/workspace-os
gh pr merge 146 --merge --repo os-santiago/workspace-os
```

**Opción B: Desde WSL**
```bash
wsl gh pr merge 170 --merge --repo os-santiago/workspace-os
wsl gh pr merge 147 --merge --repo os-santiago/workspace-os
wsl gh pr merge 146 --merge --repo os-santiago/workspace-os
```

---

## File Access (Windows ↔ WSL)

### Windows → WSL Paths

Windows paths se mapean a `/mnt/<drive>/`:

| Windows | WSL |
|---------|-----|
| `C:\Users\sergio\project` | `/mnt/c/Users/sergio/project` |
| `D:\git\workspace-os` | `/mnt/d/git/workspace-os` |
| `C:\Program Files` | `/mnt/c/Program Files` |

**Ejemplo:**
```bash
# Leer archivo Windows desde WSL
wsl cat /mnt/c/Users/sergio/project/README.md

# List directorio Windows desde WSL
wsl ls -la /mnt/d/git/workspace-os
```

---

### WSL → Windows Paths

WSL filesystems se acceden vía `\\wsl$\`:

| WSL | Windows |
|-----|---------|
| `/home/sergio/project` | `\\wsl$\Ubuntu\home\sergio\project` |
| `/etc/hosts` | `\\wsl$\Ubuntu\etc\hosts` |

**Ejemplo en Windows Explorer:**
```
\\wsl$\Ubuntu\home\sergio\
```

---

## Configs Separados (Windows vs WSL)

### Git Config

| Environment | Config Path |
|-------------|-------------|
| **Windows** | `C:\Users\sergio\.gitconfig` |
| **WSL** | `/home/sergio/.gitconfig` |

**Pueden tener:**
- Diferentes `user.name`
- Diferentes `user.email`
- Diferentes GitHub tokens

---

### GitHub CLI Config

| Environment | Config Path |
|-------------|-------------|
| **Windows** | `C:\Users\sergio\AppData\Roaming\GitHub CLI\hosts.yml` |
| **WSL** | `/home/sergio/.config/gh/hosts.yml` |

**Check configs:**
```bash
# Windows
type "%APPDATA%\GitHub CLI\hosts.yml"

# WSL
wsl cat ~/.config/gh/hosts.yml
```

---

## Detecting if Running in WSL

### Desde el Agente (Bash)

```bash
uname -r | grep -i microsoft
```

**Output:**
- Si contiene `microsoft` → Running IN WSL
- Si no hay output → Running en Windows o Linux nativo

**Ejemplo:**
```bash
$ uname -r
5.10.102.1-microsoft-standard-WSL2
                ↑ Contains "microsoft" → WSL
```

---

### Desde Windows PowerShell

```powershell
wsl uname -r
```

**Output:**
```
5.10.102.1-microsoft-standard-WSL2
```

---

## Common Issues

### Issue #1: "wsl: command not found"

**Problema:**
```bash
$ wsl gh auth status
wsl: command not found
```

**Causa:** Ya estás **dentro de WSL**, no necesitas el prefix `wsl`.

**Solución:**
```bash
# Si estás EN WSL:
gh auth status

# Si estás en Windows:
wsl gh auth status
```

**Cómo verificar dónde estás:**
```bash
uname -r | grep -i microsoft
```
- Output con "microsoft" → Estás EN WSL
- Sin output → Estás en Windows

---

### Issue #2: "The system cannot find the path specified" (~/.config)

**Problema:**
```bash
$ cat ~/.config/gh/hosts.yml
The system cannot find the path specified.
```

**Causa:** En Windows, `~` apunta a `C:\Users\sergio`, que no tiene `.config/gh/`.

**Solución:**

**En Windows:**
```bash
# Windows gh config está en %APPDATA%
type "%APPDATA%\GitHub CLI\hosts.yml"
```

**En WSL:**
```bash
wsl cat ~/.config/gh/hosts.yml
```

---

### Issue #3: Different git/gh configs

**Problema:** Commits en WSL usan diferente email que en Windows.

**Causa:** Windows y WSL tienen `.gitconfig` SEPARADOS.

**Solución:**

**Check ambos:**
```bash
# Windows
git config user.email

# WSL
wsl git config user.email
```

**Set mismo email:**
```bash
# Windows
git config --global user.email "sergio@example.com"

# WSL
wsl git config --global user.email "sergio@example.com"
```

---

### Issue #4: Mixing Windows and WSL paths

**Problema:**
```bash
wsl cat C:\Users\sergio\file.txt
```

**Error:**
```
cat: 'C:Userssergio ile.txt': No such file or directory
```

**Causa:** WSL no entiende paths de Windows con `\`.

**Solución:**
```bash
# ✅ Correcto:
wsl cat /mnt/c/Users/sergio/file.txt

# ❌ Incorrecto:
wsl cat C:\Users\sergio\file.txt
```

---

## Best Practices

### 1. Preguntar qué Environment Quiere el Usuario

```
Agent: "Do you want me to use gh CLI from Windows or WSL?"
```

**Razón:** Usuario puede tener cuentas diferentes en cada uno.

---

### 2. Check Ambas Cuentas Cuando Menciona "Otra Cuenta"

```bash
# Check Windows
gh auth status

# Check WSL
wsl gh auth status
```

**Output Esperado:**
```
Windows: user-main (author)
WSL:     user-approver (approver) ← Different account!
```

---

### 3. Usar `wsl` Prefix Consistentemente

**✅ Correcto:**
```bash
wsl gh pr review 170 --approve
wsl gh pr merge 170 --merge
wsl git log --oneline
```

**❌ Incorrecto (mixing):**
```bash
wsl gh pr review 170 --approve
gh pr merge 170 --merge          ← Different account!
```

---

### 4. No Mezclar Windows y WSL Paths

**✅ Correcto:**
```bash
# Windows → WSL
wsl cat /mnt/c/Users/sergio/file.txt

# WSL → Windows
cmd.exe /c type \\\\wsl$\\Ubuntu\\home\\sergio\\file.txt
```

**❌ Incorrecto:**
```bash
wsl cat C:\Users\sergio\file.txt   ← Windows path en WSL
```

---

## Ejemplos Completos

### Ejemplo 1: Aprobar y Merge con WSL

**User:** "usa gh cli WSL para aprobar y merge"

**Agent:**
```bash
# 1. Check WSL account
wsl gh api user --jq ".login"
→ user-approver

# 2. Approve PRs con cuenta WSL
wsl gh pr review 170 --approve --repo os-santiago/workspace-os
wsl gh pr review 147 --approve --repo os-santiago/workspace-os

# 3. Merge con WSL
wsl gh pr merge 170 --merge --repo os-santiago/workspace-os
wsl gh pr merge 147 --merge --repo os-santiago/workspace-os

→ ✓ PRs approved and merged
```

---

### Ejemplo 2: Check Qué Cuenta Aprobar con

**User:** "en gh cli de WSL hay otra cuenta iniciada para poder aprobar"

**Agent:**
```bash
# Check Windows account
gh api user --jq ".login"
→ user-main (author - can't approve own PRs)

# Check WSL account
wsl gh api user --jq ".login"
→ user-approver (approver - can approve!)

# Use WSL account for approval
wsl gh pr review 170 --approve --repo os-santiago/workspace-os
```

---

### Ejemplo 3: Leer Archivo WSL desde Windows

**User:** "lee el archivo ~/.config/gh/hosts.yml de WSL"

**Agent:**
```bash
# Desde Windows PowerShell/CMD
wsl cat ~/.config/gh/hosts.yml

# O especificar distro
wsl -d Ubuntu cat ~/.config/gh/hosts.yml
```

---

## Troubleshooting

### Verificar si WSL está Instalado

```bash
wsl --version
```

**Output esperado:**
```
WSL version: 2.0.9.0
Kernel version: 5.15.133.1
WSLg version: 1.0.59
```

**Si no está instalado:**
```
'wsl' is not recognized as an internal or external command
```

---

### Verificar Distros Instaladas

```bash
wsl --list --verbose
```

**Output:**
```
  NAME      STATE           VERSION
* Ubuntu    Running         2
  Debian    Stopped         2
```

---

### Ejecutar en Distro Específica

```bash
wsl -d Ubuntu gh auth status
wsl -d Debian gh auth status
```

---

### Reiniciar WSL

```bash
wsl --shutdown
wsl
```

---

## Referencias

- **WSL Documentation:** https://learn.microsoft.com/en-us/windows/wsl/
- **GitHub CLI in WSL:** https://github.com/cli/cli#installation
- **File System Access:** https://learn.microsoft.com/en-us/windows/wsl/filesystems

---

## Ver También

- [github-merge-workflow.md](github-merge-workflow.md) - GitHub PR merge workflow
- [permissions.md](permissions.md) - Permission system
- [README.md](../README.md) - Main documentation

---

## Changelog

### v0.3.1 (2026-06-27)
- ✅ WSL integration added
- ✅ Support for different GitHub accounts (Windows vs WSL)
- ✅ Path conversion guidance (Windows ↔ WSL)
- ✅ Common issues troubleshooting
- ✅ Best practices for WSL workflows
