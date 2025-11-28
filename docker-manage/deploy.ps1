# deploy.ps1 - Full deployment script for llama.cpp with Qwen3-8B
# Tears down existing services, installs Docker if needed, downloads model, and starts container

param(
    [switch]$SkipDownload,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Load environment variables from .env
$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env file not found!" -ForegroundColor Red
    Write-Host "Copy .env.example to .env and fill in your credentials" -ForegroundColor Yellow
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        Set-Variable -Name $name -Value $value -Scope Script
    }
}

# Validate required variables
$required = @('SSH_HOST', 'SSH_USER', 'SSH_PASSWORD')
foreach ($var in $required) {
    if (-not (Get-Variable -Name $var -ValueOnly -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: $var not set in .env" -ForegroundColor Red
        exit 1
    }
}

# Use plink for SSH (works better with password auth on Windows)
$plink = "C:\Program Files\PuTTY\plink.exe"
if (-not (Test-Path $plink)) {
    Write-Host "ERROR: PuTTY plink.exe not found at $plink" -ForegroundColor Red
    Write-Host "Install PuTTY or update the path" -ForegroundColor Yellow
    exit 1
}

$sshTarget = "${SSH_USER}@${SSH_HOST}"

function Invoke-RemoteCommand {
    param(
        [string]$Command,
        [switch]$IgnoreError,
        [switch]$UseSudo
    )

    if ($UseSudo) {
        $Command = "echo $SSH_PASSWORD | sudo -S bash -c '$Command'"
    }

    $displayCmd = if ($Command.Length -gt 100) { "$($Command.Substring(0, 100))..." } else { $Command }
    Write-Host "  > $displayCmd" -ForegroundColor DarkGray

    $result = "y" | & $plink -ssh -pw $SSH_PASSWORD $sshTarget "$Command 2>&1"

    if ($LASTEXITCODE -ne 0 -and -not $IgnoreError) {
        return $null
    }
    return $result
}

# Configuration
$MODEL_NAME = "Qwen3-8B-Q8_0.gguf"
$MODEL_URL = "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q8_0.gguf?download=true"
$MODEL_SIZE_GB = "8.71"
$DOCKER_IMAGE = "ghcr.io/ggerganov/llama.cpp:server-cuda"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  LLM Server Deployment Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target: $SSH_HOST" -ForegroundColor Green
Write-Host "Model: $MODEL_NAME (~$MODEL_SIZE_GB GB)" -ForegroundColor Green
Write-Host "Image: $DOCKER_IMAGE" -ForegroundColor Green
Write-Host ""

# Confirm deployment
if (-not $Force) {
    $confirm = Read-Host "This will stop existing LLM services and deploy Qwen3-8B. Continue? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

$startTime = Get-Date

# =============================================================================
# Step 1: Stop any existing llama services
# =============================================================================
Write-Host ""
Write-Host "[1/7] Stopping existing llama services..." -ForegroundColor Yellow

Invoke-RemoteCommand "systemctl stop llama-server 2>/dev/null || true" -UseSudo -IgnoreError | Out-Null
Invoke-RemoteCommand "systemctl disable llama-server 2>/dev/null || true" -UseSudo -IgnoreError | Out-Null
Invoke-RemoteCommand "pkill -9 -f llama-server 2>/dev/null || true" -IgnoreError | Out-Null
Invoke-RemoteCommand "docker stop llama-server 2>/dev/null || true" -IgnoreError | Out-Null
Invoke-RemoteCommand "docker rm llama-server 2>/dev/null || true" -IgnoreError | Out-Null
Start-Sleep -Seconds 2
Write-Host "  Done!" -ForegroundColor Green

# =============================================================================
# Step 2: Check/Install Docker
# =============================================================================
Write-Host ""
Write-Host "[2/7] Checking Docker installation..." -ForegroundColor Yellow

$dockerCheck = Invoke-RemoteCommand "docker --version 2>/dev/null" -IgnoreError
if ($dockerCheck -match "Docker version") {
    Write-Host "  Docker is installed: $($dockerCheck.Trim())" -ForegroundColor Green
} else {
    Write-Host "  Docker not found. Installing Docker..." -ForegroundColor Cyan

    # Install Docker using official convenience script
    Write-Host "  Downloading Docker install script..." -ForegroundColor DarkGray
    Invoke-RemoteCommand "curl -fsSL https://get.docker.com -o /tmp/get-docker.sh" | Out-Null

    Write-Host "  Running Docker install script (this may take a few minutes)..." -ForegroundColor DarkGray
    $installResult = Invoke-RemoteCommand "sh /tmp/get-docker.sh" -UseSudo
    if ($installResult) {
        $installResult -split "`n" | Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }

    # Add user to docker group
    Write-Host "  Adding user to docker group..." -ForegroundColor DarkGray
    Invoke-RemoteCommand "usermod -aG docker $SSH_USER" -UseSudo | Out-Null

    # Start Docker service
    Write-Host "  Starting Docker service..." -ForegroundColor DarkGray
    Invoke-RemoteCommand "systemctl enable docker" -UseSudo | Out-Null
    Invoke-RemoteCommand "systemctl start docker" -UseSudo | Out-Null

    # Verify installation
    Start-Sleep -Seconds 3
    $dockerVerify = Invoke-RemoteCommand "docker --version" -IgnoreError
    if ($dockerVerify -match "Docker version") {
        Write-Host "  Docker installed successfully: $($dockerVerify.Trim())" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: Docker installation failed!" -ForegroundColor Red
        exit 1
    }
}

# =============================================================================
# Step 3: Install NVIDIA Container Toolkit if needed
# =============================================================================
Write-Host ""
Write-Host "[3/7] Checking NVIDIA Container Toolkit..." -ForegroundColor Yellow

$nvidiaDockerCheck = Invoke-RemoteCommand "docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi 2>&1 | head -1" -IgnoreError
if ($nvidiaDockerCheck -match "NVIDIA-SMI") {
    Write-Host "  NVIDIA Container Toolkit is working" -ForegroundColor Green
} else {
    Write-Host "  Installing NVIDIA Container Toolkit..." -ForegroundColor Cyan

    # Add NVIDIA repository and install
    Invoke-RemoteCommand "curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg" -UseSudo | Out-Null
    Invoke-RemoteCommand "curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list" -UseSudo | Out-Null

    Write-Host "  Updating package lists..." -ForegroundColor DarkGray
    Invoke-RemoteCommand "apt-get update -qq" -UseSudo | Out-Null

    Write-Host "  Installing nvidia-container-toolkit..." -ForegroundColor DarkGray
    Invoke-RemoteCommand "apt-get install -y nvidia-container-toolkit" -UseSudo | Out-Null

    Write-Host "  Configuring Docker runtime..." -ForegroundColor DarkGray
    Invoke-RemoteCommand "nvidia-ctk runtime configure --runtime=docker" -UseSudo | Out-Null
    Invoke-RemoteCommand "systemctl restart docker" -UseSudo | Out-Null

    Start-Sleep -Seconds 5
    $nvidiaVerify = Invoke-RemoteCommand "docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi 2>&1 | head -1" -IgnoreError
    if ($nvidiaVerify -match "NVIDIA-SMI") {
        Write-Host "  NVIDIA Container Toolkit installed successfully" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: NVIDIA Container Toolkit may need manual setup" -ForegroundColor Yellow
        Write-Host "  Error: $nvidiaVerify" -ForegroundColor DarkYellow
    }
}

# =============================================================================
# Step 4: Create models directory
# =============================================================================
Write-Host ""
Write-Host "[4/7] Creating models directory..." -ForegroundColor Yellow

Invoke-RemoteCommand "mkdir -p /home/$SSH_USER/models" | Out-Null
Write-Host "  Directory: /home/$SSH_USER/models" -ForegroundColor Green

# =============================================================================
# Step 5: Download model
# =============================================================================
Write-Host ""
Write-Host "[5/7] Checking/downloading model..." -ForegroundColor Yellow

$modelPath = "/home/$SSH_USER/models/$MODEL_NAME"
$modelExists = Invoke-RemoteCommand "test -f $modelPath && echo 'exists' || echo 'missing'" -IgnoreError

if ($modelExists -match 'exists' -and -not $SkipDownload) {
    $modelSize = Invoke-RemoteCommand "ls -lh $modelPath | awk '{print `$5}'" -IgnoreError
    Write-Host "  Model already exists: $MODEL_NAME ($($modelSize.Trim()))" -ForegroundColor Green
} elseif (-not $SkipDownload) {
    Write-Host "  Downloading $MODEL_NAME (~$MODEL_SIZE_GB GB)..." -ForegroundColor Cyan
    Write-Host "  This may take several minutes depending on your connection..." -ForegroundColor DarkGray

    # Download using wget from HuggingFace with correct filename
    $downloadCmd = "cd /home/$SSH_USER/models && wget -O $MODEL_NAME '$MODEL_URL'"
    Write-Host "  Starting download..." -ForegroundColor DarkGray
    
    $downloadResult = Invoke-RemoteCommand $downloadCmd
    if ($downloadResult) {
        $downloadResult -split "`n" | Select-Object -Last 3 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    }

    # Verify download
    $verifySize = Invoke-RemoteCommand "ls -lh $modelPath 2>/dev/null | awk '{print `$5}'" -IgnoreError
    if ($verifySize -and $verifySize.Trim()) {
        Write-Host "  Download complete! Size: $($verifySize.Trim())" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: Model download failed!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  Skipping download (--SkipDownload flag)" -ForegroundColor DarkYellow
}

# =============================================================================
# Step 6: Pull image and start container
# =============================================================================
Write-Host ""
Write-Host "[6/7] Starting llama.cpp container..." -ForegroundColor Yellow

Write-Host "  Pulling latest llama.cpp Docker image..." -ForegroundColor DarkGray
$pullResult = Invoke-RemoteCommand "docker pull $DOCKER_IMAGE"
if ($pullResult) {
    $pullResult -split "`n" | Select-Object -Last 2 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}

$containerName = "llama-server"
$port = if ($LLAMA_PORT) { $LLAMA_PORT } else { "8080" }

Write-Host "  Starting container:" -ForegroundColor DarkGray
Write-Host "    - Name: $containerName" -ForegroundColor DarkGray
Write-Host "    - Port: $port" -ForegroundColor DarkGray
Write-Host "    - GPU Layers: 99 (full offload)" -ForegroundColor DarkGray

$runCmd = "docker run -d --name $containerName --gpus all -v /home/${SSH_USER}/models:/models -p ${port}:8080 $DOCKER_IMAGE -m /models/$MODEL_NAME --host 0.0.0.0 --port 8080 -ngl 99"

$containerId = Invoke-RemoteCommand $runCmd
if ($containerId) {
    $shortId = $containerId.Trim()
    if ($shortId.Length -gt 12) { $shortId = $shortId.Substring(0, 12) }
    Write-Host "  Container started: $shortId" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Failed to start container" -ForegroundColor Red
    $logs = Invoke-RemoteCommand "docker logs $containerName 2>&1 | tail -10" -IgnoreError
    Write-Host "  Logs: $logs" -ForegroundColor Red
    exit 1
}

# =============================================================================
# Step 7: Wait for server and run LLM test
# =============================================================================
Write-Host ""
Write-Host "[7/7] Waiting for server to load model..." -ForegroundColor Yellow

$maxWait = 120
$waited = 0
$ready = $false

while ($waited -lt $maxWait -and -not $ready) {
    Start-Sleep -Seconds 5
    $waited += 5

    $health = Invoke-RemoteCommand "curl -s http://localhost:$port/health 2>/dev/null" -IgnoreError
    if ($health -match '"status"\s*:\s*"ok"') {
        $ready = $true
    } else {
        Write-Host "  Loading... ($waited/$maxWait seconds)" -ForegroundColor DarkGray
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "ERROR: Server failed to become ready within $maxWait seconds" -ForegroundColor Red
    Write-Host "Check logs with: .\logs.ps1" -ForegroundColor Yellow
    exit 1
}

Write-Host "  Server is ready!" -ForegroundColor Green

# =============================================================================
# LLM Test
# =============================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  Running LLM Test" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

Write-Host "  Test prompt: 'Say hello in exactly 5 words.'" -ForegroundColor DarkGray

# Use heredoc-style JSON to avoid escaping issues
$testCmd = @"
curl -s -X POST http://localhost:$port/completion -H "Content-Type: application/json" -d '{"prompt": "Say hello in exactly 5 words.", "n_predict": 32, "temperature": 0.7}'
"@

$testResult = Invoke-RemoteCommand $testCmd -IgnoreError

if ($testResult) {
    # Parse the JSON response to extract content
    try {
        $jsonResponse = $testResult | ConvertFrom-Json
        if ($jsonResponse.content) {
            Write-Host ""
            Write-Host "  LLM Response:" -ForegroundColor Cyan
            Write-Host "  $($jsonResponse.content.Trim())" -ForegroundColor White
            Write-Host ""
            Write-Host "  Test PASSED!" -ForegroundColor Green

            # Show generation stats if available
            if ($jsonResponse.timings) {
                $tokensPerSec = [math]::Round($jsonResponse.timings.predicted_per_second, 1)
                Write-Host "  Speed: $tokensPerSec tokens/sec" -ForegroundColor DarkGray
            }
        } else {
            Write-Host "  Response: $testResult" -ForegroundColor Yellow
            Write-Host "  Test completed (check response format)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Raw response: $testResult" -ForegroundColor Yellow
        Write-Host "  Test completed (response received)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  WARNING: No response from LLM test" -ForegroundColor Yellow
    Write-Host "  Server may still be warming up" -ForegroundColor DarkYellow
}

# =============================================================================
# Final Summary
# =============================================================================
$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Server URL: http://${SSH_HOST}:$port" -ForegroundColor Cyan
Write-Host "  Model: $MODEL_NAME" -ForegroundColor White
Write-Host "  Container: $containerName" -ForegroundColor White
Write-Host "  Duration: $([math]::Round($duration.TotalMinutes, 1)) minutes" -ForegroundColor White
Write-Host ""

# Show GPU usage
Write-Host "  GPU Memory Usage:" -ForegroundColor Yellow
$gpuInfo = Invoke-RemoteCommand "nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader" -IgnoreError
if ($gpuInfo) {
    Write-Host "    $($gpuInfo.Trim())" -ForegroundColor White
}

Write-Host ""
Write-Host "  Management commands:" -ForegroundColor Yellow
Write-Host "    .\status.ps1    - Check server status" -ForegroundColor White
Write-Host "    .\logs.ps1      - View container logs" -ForegroundColor White
Write-Host "    .\teardown.ps1  - Stop and remove container" -ForegroundColor White
Write-Host ""
