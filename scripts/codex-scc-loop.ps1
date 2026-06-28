param(
    [string]$WorkspaceRoot = (Get-Location).Path,
    [int]$IntervalMinutes = 15,
    [int]$Cycles = 0,
    [string]$Prompt = "Propose and work on one small, safe improvement in this repository. Make exactly one atomic change per cycle. Prioritize user experience and product quality: remove friction, improve clarity, reduce errors, and strengthen reliability. Before editing, use or create a dedicated branch for the scoped change. When the change is ready, open a PR with a clear title and a description that states what changed, why it matters to users, what is intentionally out of scope, and how it was validated. Merge only through the repository's normal PR path. In the final summary, include the branch name, PR number or link, validation performed, and merge outcome so the change is traceable end to end. If no safe improvement is obvious, explain why and make no changes.",
    [string]$ScAgentPath = "D:\git\sc-agent-cli\bin\sc.js"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $WorkspaceRoot)) {
    throw "Workspace root not found: $WorkspaceRoot"
}

if ($IntervalMinutes -le 0) {
    throw "IntervalMinutes must be greater than zero"
}

if ($Cycles -lt 0) {
    throw "Cycles must be zero or greater"
}

function Invoke-SccCycle {
    param(
        [string]$RepoRoot,
        [string]$CyclePrompt,
        [string]$FallbackPath
    )

    Push-Location $RepoRoot
    try {
        $sessionInput = @(
            $CyclePrompt
            'exit'
        )

        if (Get-Command scc -ErrorAction SilentlyContinue) {
            $sessionInput | & scc
        } else {
            $sessionInput | & node $FallbackPath
        }
    } finally {
        Pop-Location
    }
}

$cycle = 0

while ($true) {
    $cycle++
    $nextRun = (Get-Date).AddMinutes($IntervalMinutes)

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkGray
    Write-Host (" Codex → scc cycle #{0}" -f $cycle) -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkGray
    Write-Host (" Workspace: {0}" -f $WorkspaceRoot) -ForegroundColor Gray
    Write-Host (" Next run:  {0}" -f $nextRun.ToString("yyyy-MM-dd HH:mm:ss")) -ForegroundColor Gray
    Write-Host ""

    Invoke-SccCycle -RepoRoot $WorkspaceRoot -CyclePrompt $Prompt -FallbackPath $ScAgentPath

    if ($Cycles -gt 0 -and $cycle -ge $Cycles) {
        break
    }

    Start-Sleep -Seconds ($IntervalMinutes * 60)
}
