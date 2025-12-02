# Fine-tune Llama 3.2 1B for Among Us - Quick Start Script

param(
    [Parameter(Position=0)]
    [string]$Step = "all",
    
    [string]$ModelId = "meta-llama/Llama-3.2-1B-Instruct",
    [int]$Epochs = 3,
    [int]$BatchSize = 4,
    [string]$Quantization = "Q5_K_M"
)

$ErrorActionPreference = "Stop"

# Change to script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $ScriptDir
try {

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host ""
}

function Step-Install {
    Write-Header "Step 1: Installing Dependencies"
    pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "Failed to install dependencies" }
    Write-Host "[OK] Dependencies installed" -ForegroundColor Green
}

function Step-Prepare {
    Write-Header "Step 2: Preparing Dataset"
    python prepare_dataset.py
    if ($LASTEXITCODE -ne 0) { throw "Failed to prepare dataset" }
    Write-Host "[OK] Dataset prepared" -ForegroundColor Green
}

function Step-Train {
    Write-Header "Step 3: Fine-tuning Model"
    python train.py `
        --model_id $ModelId `
        --epochs $Epochs `
        --batch_size $BatchSize `
        --output_dir ./output
    if ($LASTEXITCODE -ne 0) { throw "Failed to train model" }
    Write-Host "[OK] Training complete" -ForegroundColor Green
}

function Step-Merge {
    Write-Header "Step 4: Merging LoRA Adapter"
    python merge_model.py `
        --base_model_id $ModelId `
        --adapter_path ./output/final `
        --output_dir ./merged_model
    if ($LASTEXITCODE -ne 0) { throw "Failed to merge model" }
    Write-Host "[OK] Model merged" -ForegroundColor Green
}

function Step-Convert {
    Write-Header "Step 5: Converting to GGUF"
    python convert_to_gguf.py `
        --model_path ./merged_model `
        --output_dir ./gguf_model `
        --quantization $Quantization
    if ($LASTEXITCODE -ne 0) { throw "Failed to convert to GGUF" }
    Write-Host "[OK] GGUF created" -ForegroundColor Green
}

function Step-Test {
    Write-Header "Step 6: Testing Model"
    $ggufPath = "./gguf_model/model-$Quantization.gguf"
    if (Test-Path $ggufPath) {
        python test_model.py --gguf_path $ggufPath
    } else {
        python test_model.py --model_path ./merged_model
    }
}

# Main
Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "   Fine-tune Llama 3.2 1B for Among Us AI Agents            " -ForegroundColor Yellow
Write-Host "   RTX 5090 Optimized                                       " -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""

Write-Host "Configuration:" -ForegroundColor White
Write-Host "  Model:        $ModelId"
Write-Host "  Epochs:       $Epochs"
Write-Host "  Batch Size:   $BatchSize"
Write-Host "  Quantization: $Quantization"
Write-Host ""

switch ($Step.ToLower()) {
    "install"  { Step-Install }
    "prepare"  { Step-Prepare }
    "train"    { Step-Train }
    "merge"    { Step-Merge }
    "convert"  { Step-Convert }
    "test"     { Step-Test }
    "all" {
        Step-Install
        Step-Prepare
        Step-Train
        Step-Merge
        Step-Convert
        Step-Test
        
        Write-Header "All Steps Complete!"
        Write-Host "Your fine-tuned model is ready!" -ForegroundColor Green
        Write-Host ""
        Write-Host "GGUF file: ./gguf_model/model-$Quantization.gguf"
        Write-Host ""
        Write-Host "To deploy:"
        Write-Host "  1. Copy the GGUF to your llama.cpp server"
        Write-Host "  2. Update docker-manage/LLM configuration"
        Write-Host "  3. Restart the container"
        Write-Host ""
    }
    default {
        Write-Host "Usage: .\run.ps1 [step] [options]"
        Write-Host ""
        Write-Host "Steps:"
        Write-Host "  install  - Install Python dependencies"
        Write-Host "  prepare  - Prepare training dataset"
        Write-Host "  train    - Fine-tune the model"
        Write-Host "  merge    - Merge LoRA adapter with base model"
        Write-Host "  convert  - Convert to GGUF format"
        Write-Host "  test     - Test the fine-tuned model"
        Write-Host "  all      - Run all steps (default)"
        Write-Host ""
        Write-Host "Options:"
        Write-Host "  -ModelId       HuggingFace model ID (default: meta-llama/Llama-3.2-1B-Instruct)"
        Write-Host "  -Epochs        Number of training epochs (default: 3)"
        Write-Host "  -BatchSize     Batch size per GPU (default: 4)"
        Write-Host "  -Quantization  GGUF quantization type (default: Q5_K_M)"
        Write-Host ""
        Write-Host "Examples:"
        Write-Host "  .\run.ps1 all"
        Write-Host "  .\run.ps1 train -Epochs 5"
        Write-Host "  .\run.ps1 convert -Quantization Q4_K_M"
    }
}

} finally {
    Pop-Location
}
