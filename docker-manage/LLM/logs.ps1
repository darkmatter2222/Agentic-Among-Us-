# logs.ps1 - View llama.cpp container logs

param(
    [int]$Lines = 100,
    [switch]$Follow
)

$ErrorActionPreference = "Stop"

# Load environment variables from .env
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env file not found!" -ForegroundColor Red
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        Set-Variable -Name $name -Value $value -Scope Script
    }
}

$plink = "C:\Program Files\PuTTY\plink.exe"
$sshTarget = "${SSH_USER}@${SSH_HOST}"
$containerName = if ($CONTAINER_NAME) { $CONTAINER_NAME } else { "llama-cpp-server" }

Write-Host "Fetching logs from $containerName..." -ForegroundColor Cyan
Write-Host ""

if ($Follow) {
    Write-Host "Following logs (Ctrl+C to stop)..." -ForegroundColor Yellow
    Write-Host ""
    # For follow mode, we need interactive terminal
    & $plink -ssh -pw $SSH_PASSWORD $sshTarget "docker logs -f --tail $Lines $containerName"
} else {
    $logs = "y" | & $plink -ssh -pw $SSH_PASSWORD $sshTarget "docker logs --tail $Lines $containerName 2>&1"
    Write-Host $logs
}
