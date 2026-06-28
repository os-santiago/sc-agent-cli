# Setup script for SC CLI in PowerShell

Write-Host "🔧 Setting up SC CLI in PowerShell..." -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js installed: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Node.js from: https://nodejs.org/"
    exit 1
}

# Check if SC CLI exists
$scCliPath = "D:\git\sc-agent-cli\bin\sc.js"
if (-not (Test-Path $scCliPath)) {
    Write-Host "❌ SC CLI not found at: $scCliPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please ensure the project is at D:\git\sc-agent-cli"
    exit 1
}

Write-Host "✓ SC CLI found at: $scCliPath" -ForegroundColor Green

# Check if PowerShell profile exists
if (-not (Test-Path $PROFILE)) {
    Write-Host "Creating PowerShell profile at: $PROFILE" -ForegroundColor Yellow
    New-Item -Path $PROFILE -ItemType File -Force | Out-Null
}

Write-Host "✓ PowerShell profile: $PROFILE" -ForegroundColor Green

# Backup existing profile
$backupPath = "$PROFILE.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -Path $PROFILE -Destination $backupPath
Write-Host "✓ Backed up profile to: $backupPath" -ForegroundColor Green

# Check if already configured
$profileContent = Get-Content $PROFILE -Raw
if ($profileContent -match "SC CLI \(Provider-agnostic AI Agent\)") {
    Write-Host "⚠️  SC CLI already configured in profile" -ForegroundColor Yellow
    Write-Host ""
    $overwrite = Read-Host "Overwrite existing configuration? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "Skipping profile modification" -ForegroundColor Yellow
    } else {
        # Remove old configuration
        $profileContent = $profileContent -replace "(?ms)# --- SC CLI \(Provider-agnostic AI Agent\) ---.*?(?=\r?\n\r?\n|\z)", ""
        Set-Content -Path $PROFILE -Value $profileContent.Trim()
        Write-Host "✓ Removed old configuration" -ForegroundColor Green
    }
}

# Add configuration to profile
$config = @"

# --- SC CLI (Provider-agnostic AI Agent) ---
# NVIDIA API Key for Nemotron 3 Ultra 550B
`$env:NVIDIA_API_KEY = "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"

function scc {
    param(
        [Parameter(ValueFromRemainingArguments = `$true)]
        [string[]]`$Arguments
    )

    `$scCliPath = "D:\git\sc-agent-cli\bin\sc.js"
    & node `$scCliPath @Arguments
}
"@

Add-Content -Path $PROFILE -Value $config
Write-Host "✓ Added SC CLI configuration to profile" -ForegroundColor Green

# Reload profile
. $PROFILE
Write-Host "✓ Reloaded PowerShell profile" -ForegroundColor Green

# Test the command
Write-Host ""
Write-Host "Testing scc command..." -ForegroundColor Cyan
try {
    $version = scc --version
    Write-Host "✓ scc is working! Version: $version" -ForegroundColor Green
} catch {
    Write-Host "❌ scc command failed" -ForegroundColor Red
    exit 1
}

# Configure NVIDIA profile
Write-Host ""
Write-Host "Configuring NVIDIA profile..." -ForegroundColor Cyan
scc profile use nvidia

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "✅ SC CLI setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Available commands:" -ForegroundColor Yellow
Write-Host "  scc --help          → Show help"
Write-Host "  scc profile list    → List available profiles"
Write-Host "  scc                 → Start chat with NVIDIA Nemotron"
Write-Host ""
Write-Host "Environment:" -ForegroundColor Yellow
Write-Host "  NVIDIA_API_KEY is configured"
Write-Host "  Active profile: nvidia (Nemotron 3 Ultra 550B)"
Write-Host ""
Write-Host "To start chatting:" -ForegroundColor Yellow
Write-Host "  scc"
Write-Host ""
Write-Host "Note: Close and reopen your PowerShell terminal, or run:" -ForegroundColor Gray
Write-Host "  . `$PROFILE"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
