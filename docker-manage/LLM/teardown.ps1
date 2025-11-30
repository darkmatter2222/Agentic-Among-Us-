# teardown.ps1 - Stop and remove all LLM/GPU containers and services

param(
    [switch]$All  # Also stop native llama-server service
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

function Invoke-RemoteCommand {
    param([string]$Command, [switch]$UseSudo)
    if ($UseSudo) { $Command = "echo $SSH_PASSWORD | sudo -S bash -c '$Command'" }
    $result = "y" | & $plink -ssh -pw $SSH_PASSWORD $sshTarget $Command 2>&1
    return $result
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Container Teardown Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target: $SSH_HOST" -ForegroundColor Green
Write-Host ""

# Stop native llama-server service if running
Write-Host "Stopping native llama-server service..." -ForegroundColor Yellow
Invoke-RemoteCommand "systemctl stop llama-server 2>/dev/null; systemctl disable llama-server 2>/dev/null" -UseSudo | Out-Null
Invoke-RemoteCommand "pkill -9 -f llama-server 2>/dev/null || true" | Out-Null
Write-Host "  Done!" -ForegroundColor Green

# Stop Docker containers
Write-Host ""
Write-Host "Stopping Docker containers..." -ForegroundColor Yellow

$dockerCheck = Invoke-RemoteCommand "docker --version 2>/dev/null"
if ($dockerCheck -match "Docker") {
    Invoke-RemoteCommand "docker stop llama-cpp-server 2>/dev/null || true" | Out-Null
    Invoke-RemoteCommand "docker rm llama-cpp-server 2>/dev/null || true" | Out-Null
    Write-Host "  Done!" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "Remaining containers:" -ForegroundColor Cyan
    $containers = Invoke-RemoteCommand "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
    Write-Host $containers
} else {
    Write-Host "  Docker not installed, skipping" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "GPU Status:" -ForegroundColor Yellow
$gpu = Invoke-RemoteCommand "nvidia-smi --query-gpu=memory.used,memory.total --format=csv"
Write-Host "  $gpu" -ForegroundColor White

Write-Host ""
Write-Host "Teardown complete!" -ForegroundColor Green
