# =============================================================================
# Quota Pay — One-Command Ephemeral AWS Spot Deployment (infra/scripts/up.ps1)
# Provisions the eu-south-1 EC2 Spot instance (~$0.005/hr) and launches the
# FinOps CostGuard background circuit breaker on Windows PowerShell.
# =============================================================================
param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..\..")

$EnvFile = Join-Path $RootDir ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}

$DryFlag = if ($DryRun) { "--dry-run" } else { "" }

Write-Host "[Quota Pay] Deploying AWS eu-south-1 (Milan) EC2 Spot Instance..." -ForegroundColor Green
if ($DryRun) {
    python (Join-Path $ScriptDir "terraform_actuator.py") deploy --dry-run
    python (Join-Path $ScriptDir "cost_guard.py") --once --dry-run
} else {
    python (Join-Path $ScriptDir "terraform_actuator.py") deploy
    Start-Process -NoNewWindow -FilePath "python" -ArgumentList (Join-Path $ScriptDir "cost_guard.py")
    Write-Host "[Quota Pay] FinOps CostGuard background monitor started." -ForegroundColor Cyan
}
