param(
    [string]$TaskName = "SC-Agent-CLI-Codex-SCC",
    [string]$WorkspaceRoot = "D:\git\sc-agent-cli",
    [int]$IntervalMinutes = 15,
    [string]$LoopScriptPath = "D:\git\sc-agent-cli\scripts\codex-scc-loop.ps1"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $WorkspaceRoot)) {
    throw "Workspace root not found: $WorkspaceRoot"
}

if (-not (Test-Path $LoopScriptPath)) {
    throw "Loop script not found: $LoopScriptPath"
}

if ($IntervalMinutes -le 0) {
    throw "IntervalMinutes must be greater than zero"
}

$actionArguments = @(
    '-ExecutionPolicy Bypass'
    ('-File "{0}"' -f $LoopScriptPath)
    ('-WorkspaceRoot "{0}"' -f $WorkspaceRoot)
    '-Cycles 1'
) -join ' '

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArguments
$startAt = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$description = "Runs one SCC improvement cycle every $IntervalMinutes minutes against $WorkspaceRoot."

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName

Write-Host "Scheduled task registered:" -ForegroundColor Green
Write-Host ("  Name:     {0}" -f $task.TaskName)
Write-Host ("  Interval: {0} minutes" -f $IntervalMinutes)
Write-Host ("  Start:    {0}" -f $startAt.ToString("yyyy-MM-dd HH:mm:ss"))
Write-Host ("  Action:   powershell.exe {0}" -f $actionArguments)
