# switch-model.ps1 - Download and switch to a different model

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('qwen3-8b-q8_0', 'qwen3-8b-q6_k', 'qwen3-8b-q5_k_m', 'qwen3-8b-q4_k_m', 'custom')]
    [string]$Model = 'qwen3-8b-q8_0',
    
    [string]$CustomUrl,  # For custom model downloads
    [string]$CustomName  # Custom filename
)

$ErrorActionPreference = "Stop"

# Model configurations
$models = @{
    'qwen3-8b-q8_0' = @{
        url = 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q8_0.gguf'
        file = 'qwen3-8b-q8_0.gguf'
        size = '8.71 GB'
        description = 'Best quality - recommended for RTX 3090'
    }
    'qwen3-8b-q6_k' = @{
        url = 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q6_k.gguf'
        file = 'qwen3-8b-q6_k.gguf'
        size = '6.73 GB'
        description = 'Good balance of quality and speed'
    }
    'qwen3-8b-q5_k_m' = @{
        url = 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q5_k_m.gguf'
        file = 'qwen3-8b-q5_k_m.gguf'
        size = '5.85 GB'
        description = 'Faster with minimal quality loss'
    }
    'qwen3-8b-q4_k_m' = @{
        url = 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q4_k_m.gguf'
        file = 'qwen3-8b-q4_k_m.gguf'
        size = '5.03 GB'
        description = 'Fastest - some quality trade-off'
    }
}

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

# Build SSH command
$sshArgs = @("-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes")
if ($SSH_KEY_PATH) {
    $keyPath = $SSH_KEY_PATH -replace '~', $env:USERPROFILE
    $sshArgs += @("-i", $keyPath)
}
$sshTarget = "${SSH_USER}@${SSH_HOST}"

function Invoke-RemoteCommand {
    param([string]$Command, [switch]$IgnoreError)
    
    if ($SSH_PASSWORD) {
        $result = echo $SSH_PASSWORD | plink -batch -pw $SSH_PASSWORD $sshTarget $Command 2>&1
    } else {
        $result = ssh @sshArgs $sshTarget $Command 2>&1
    }
    
    if ($LASTEXITCODE -ne 0 -and -not $IgnoreError) {
        return $null
    }
    return $result
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Model Switcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Handle custom model
if ($Model -eq 'custom') {
    if (-not $CustomUrl -or -not $CustomName) {
        Write-Host "For custom models, provide -CustomUrl and -CustomName" -ForegroundColor Red
        exit 1
    }
    $downloadUrl = $CustomUrl
    $fileName = $CustomName
    $modelDesc = "Custom model"
} else {
    $modelConfig = $models[$Model]
    $downloadUrl = $modelConfig.url
    $fileName = $modelConfig.file
    Write-Host "Model: $Model" -ForegroundColor Green
    Write-Host "Size: $($modelConfig.size)" -ForegroundColor White
    Write-Host "Description: $($modelConfig.description)" -ForegroundColor DarkGray
}

Write-Host ""

# Check if model already exists
$modelPath = "/home/$SSH_USER/models/$fileName"
$modelExists = Invoke-RemoteCommand "test -f $modelPath && echo 'exists'" -IgnoreError

if ($modelExists -eq 'exists') {
    Write-Host "Model already downloaded!" -ForegroundColor Green
} else {
    Write-Host "Downloading model..." -ForegroundColor Yellow
    Write-Host "This may take several minutes..." -ForegroundColor DarkGray
    
    $downloadCmd = @"
cd /home/$SSH_USER/models && \
wget -c --progress=bar:force:noscroll '$downloadUrl' -O $fileName
"@
    Invoke-RemoteCommand $downloadCmd
    Write-Host "Download complete!" -ForegroundColor Green
}

# Restart container with new model
Write-Host ""
Write-Host "Restarting server with new model..." -ForegroundColor Yellow

& "$PSScriptRoot\start.ps1" -Model $fileName

Write-Host ""
Write-Host "Model switch complete!" -ForegroundColor Green
