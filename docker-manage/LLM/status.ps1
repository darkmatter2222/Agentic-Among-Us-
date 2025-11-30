# status.ps1 - Check LLM server status and GPU usage

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
    param([string]$Command)
    $result = "y" | & $plink -ssh -pw $SSH_PASSWORD $sshTarget $Command 2>&1
    return $result
}

$port = if ($LLAMA_PORT) { $LLAMA_PORT } else { "8080" }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LLM Server Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Host: $SSH_HOST" -ForegroundColor Green
Write-Host ""

# Docker containers
Write-Host "Docker Containers:" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor DarkGray
$dockerCheck = Invoke-RemoteCommand "docker --version 2>/dev/null"
if ($dockerCheck -match "Docker") {
    $containers = Invoke-RemoteCommand "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' --filter 'name=llama'"
    Write-Host $containers
} else {
    Write-Host "  Docker not installed" -ForegroundColor DarkGray
}

# GPU Status
Write-Host ""
Write-Host "GPU Status:" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor DarkGray
$gpuInfo = Invoke-RemoteCommand "nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits"
if ($gpuInfo) {
    $parts = $gpuInfo -split ','
    Write-Host "  GPU: $($parts[0].Trim())" -ForegroundColor White
    Write-Host "  Memory: $($parts[1].Trim()) / $($parts[2].Trim()) MB" -ForegroundColor White
    Write-Host "  Utilization: $($parts[3].Trim())%" -ForegroundColor White
    Write-Host "  Temperature: $($parts[4].Trim())C" -ForegroundColor White
}

# Server health
Write-Host ""
Write-Host "Server Health:" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor DarkGray

$health = Invoke-RemoteCommand "curl -s http://localhost:$port/health 2>/dev/null"
if ($health -match '"status"') {
    try {
        $healthObj = $health | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($healthObj.status -eq 'ok') {
            Write-Host "  Status: OK" -ForegroundColor Green
            if ($healthObj.slots_idle) { Write-Host "  Slots Idle: $($healthObj.slots_idle)" -ForegroundColor White }
            if ($healthObj.slots_processing) { Write-Host "  Slots Processing: $($healthObj.slots_processing)" -ForegroundColor White }
        } else {
            Write-Host "  Status: $($healthObj.status)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Response: $health" -ForegroundColor White
    }
} else {
    Write-Host "  Status: NOT RESPONDING" -ForegroundColor Red
    Write-Host "  Server may be loading or down" -ForegroundColor DarkGray
}

# Available models
Write-Host ""
Write-Host "Available Models:" -ForegroundColor Yellow
Write-Host "-----------------------------------------" -ForegroundColor DarkGray
$models = Invoke-RemoteCommand "ls -lh /home/$SSH_USER/models/*.gguf 2>/dev/null"
if ($models -and $models -notmatch "No such file") {
    $models -split "`n" | ForEach-Object {
        if ($_ -match '(\S+)\s+(\S+\.gguf)$') {
            Write-Host "  $($matches[2]) ($($matches[1]))" -ForegroundColor White
        } elseif ($_ -match '(\d+\.?\d*[GMK]?)\s+.*?(\S+\.gguf)') {
            Write-Host "  $($matches[2]) ($($matches[1]))" -ForegroundColor White
        }
    }
} else {
    Write-Host "  No models found in /home/$SSH_USER/models/" -ForegroundColor DarkGray
}

Write-Host ""
