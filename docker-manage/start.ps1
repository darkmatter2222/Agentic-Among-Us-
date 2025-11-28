# start.ps1 - Start the llama.cpp container with current model

param(
    [string]$Model = "qwen3-8b-q8_0.gguf"
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
    param([string]$Command)
    $result = "y" | & $plink -ssh -pw $SSH_PASSWORD $sshTarget $Command 2>&1
    return $result
}

Write-Host ""
Write-Host "Starting llama.cpp server..." -ForegroundColor Cyan
Write-Host "Model: $Model" -ForegroundColor Green
Write-Host ""

$containerName = if ($CONTAINER_NAME) { $CONTAINER_NAME } else { "llama-cpp-server" }
$port = if ($LLAMA_PORT) { $LLAMA_PORT } else { "8080" }
$ctxSize = if ($CONTEXT_SIZE) { $CONTEXT_SIZE } else { "32768" }
$gpuLayers = if ($GPU_LAYERS) { $GPU_LAYERS } else { "99" }
$threads = if ($THREADS) { $THREADS } else { "8" }

# Stop existing container
Write-Host "Stopping existing container..." -ForegroundColor Yellow
Invoke-RemoteCommand "docker stop $containerName 2>/dev/null; docker rm $containerName 2>/dev/null" | Out-Null

# Check if model exists
$modelPath = "/home/$SSH_USER/models/$Model"
$modelExists = Invoke-RemoteCommand "test -f $modelPath && echo 'exists' || echo 'missing'"
if ($modelExists -match 'missing') {
    Write-Host "ERROR: Model not found at $modelPath" -ForegroundColor Red
    Write-Host "Run deploy.ps1 to download the model first" -ForegroundColor Yellow
    exit 1
}

# Start container
Write-Host "Starting container..." -ForegroundColor Yellow
$runCmd = "docker run -d --name $containerName --gpus all --restart unless-stopped -p ${port}:8080 -v /home/${SSH_USER}/models:/models ghcr.io/ggerganov/llama.cpp:server-cuda --model /models/$Model --host 0.0.0.0 --port 8080 --n-gpu-layers $gpuLayers --ctx-size $ctxSize --threads $threads --parallel 4 --cont-batching --flash-attn --metrics"

$containerId = Invoke-RemoteCommand $runCmd

if ($containerId -and $containerId.Length -gt 10) {
    Write-Host "Container started: $($containerId.Trim().Substring(0, 12))" -ForegroundColor Green
    Write-Host ""
    Write-Host "Server will be available at: http://${SSH_HOST}:$port" -ForegroundColor Cyan
    Write-Host "Check status with: .\status.ps1" -ForegroundColor DarkGray
    Write-Host "Check logs with: .\logs.ps1" -ForegroundColor DarkGray
} else {
    Write-Host "ERROR: Failed to start container" -ForegroundColor Red
    Write-Host "Output: $containerId" -ForegroundColor Red
    exit 1
}
