# =============================================================================
# Quota Pay — One-Command Emergency Infrastructure Teardown (infra/scripts/destroy.ps1)
# Destroys all billable AWS resources in eu-south-1 down to $0.00/hr.
# =============================================================================
param(
    [string]$Reason = "Manual operator destroy",
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

Write-Host "[Quota Pay] Tearing down AWS eu-south-1 Spot infrastructure ($Reason)..." -ForegroundColor Yellow
if ($DryRun) {
    python (Join-Path $ScriptDir "terraform_actuator.py") destroy "$Reason" --dry-run
} else {
    python (Join-Path $ScriptDir "terraform_actuator.py") destroy "$Reason"
}
Write-Host "[Quota Pay] Infrastructure destroyed. AWS compute spend is now `$0.00/hr." -ForegroundColor Green
