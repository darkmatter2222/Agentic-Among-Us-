# Fine-tune Llama 3.2 1B for Among Us - Quick Start Script

param(
    [Parameter(Position=0)]
    [string]$Step = "all",

    [string]$ModelId = "meta-llama/Llama-3.2-1B-Instruct",
    [int]$Epochs = 1,
    [int]$BatchSize = 16,
    [int]$GradientAccumulation = 2,
    [int]$MaxSeqLength = 512,
    [int]$MaxSamples = 50000,  # Default to 50K samples for ~3-4 hour training
    [int]$EarlyStoppingPatience = 3,
    [switch]$NoGradientCheckpointing = $true,  # Default OFF for speed
    [string]$Quantization = "Q5_K_M"
)$ErrorActionPreference = "Stop"

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
    $trainArgs = @(
        "train.py",
        "--model_id", $ModelId,
        "--epochs", $Epochs,
        "--batch_size", $BatchSize,
        "--gradient_accumulation", $GradientAccumulation,
        "--max_seq_length", $MaxSeqLength,
        "--early_stopping_patience", $EarlyStoppingPatience,
        "--output_dir", "./output"
    )
    
    if ($MaxSamples -gt 0) {
        $trainArgs += @("--max_samples", $MaxSamples)
        Write-Host "  Max Samples: $MaxSamples (faster training mode)" -ForegroundColor Yellow
    }
    
    if ($NoGradientCheckpointing) {
        $trainArgs += "--no_gradient_checkpointing"
        Write-Host "  Gradient Checkpointing: OFF (faster)" -ForegroundColor Yellow
    }
    
    python @trainArgs
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

function Step-Benchmark {
    Write-Header "Benchmarking: Base Model vs Fine-tuned"
    Write-Host "This will test both models SEQUENTIALLY (one at a time)"
    Write-Host "Results will be saved to ./benchmark_output/"
    Write-Host ""
    
    # Check if adapter exists
    if (-not (Test-Path "./output/final/adapter_model.safetensors")) {
        Write-Host "[ERROR] Fine-tuned model not found!" -ForegroundColor Red
        Write-Host "Please run training first: .\run.ps1 train"
        return
    }
    
    # Install matplotlib if needed
    pip install matplotlib --quiet
    
    python benchmark.py `
        --base_model $ModelId `
        --adapter_path ./output/final `
        --output_dir ./benchmark_output
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[OK] Benchmark complete!" -ForegroundColor Green
        Write-Host "Results saved to: ./benchmark_output/" -ForegroundColor Cyan
        Write-Host "  - benchmark_results.json (detailed data)"
        Write-Host "  - *.png (visualization charts)"
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
Write-Host "  Model:         $ModelId"
Write-Host "  Epochs:        $Epochs"
Write-Host "  Batch Size:    $BatchSize"
Write-Host "  Grad Accum:    $GradientAccumulation (effective batch: $($BatchSize * $GradientAccumulation))"
Write-Host "  Max Seq Len:   $MaxSeqLength"
Write-Host "  Max Samples:   $(if ($MaxSamples -gt 0) { $MaxSamples } else { 'All' })"
Write-Host "  Grad Ckpt:     $(if ($NoGradientCheckpointing) { 'OFF (faster)' } else { 'ON' })"
Write-Host "  Early Stop:    After $EarlyStoppingPatience evals without improvement"
Write-Host "  Quantization:  $Quantization"
Write-Host ""

switch ($Step.ToLower()) {
    "install"  { Step-Install }
    "prepare"  { Step-Prepare }
    "train"    { Step-Train }
    "merge"    { Step-Merge }
    "convert"  { Step-Convert }
    "test"     { Step-Test }
    "benchmark" { Step-Benchmark }
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
        Write-Host "  install    - Install Python dependencies"
        Write-Host "  prepare    - Prepare training dataset"
        Write-Host "  train      - Fine-tune the model"
        Write-Host "  merge      - Merge LoRA adapter with base model"
        Write-Host "  convert    - Convert to GGUF format"
        Write-Host "  test       - Test the fine-tuned model"
        Write-Host "  benchmark  - Compare base vs fine-tuned model"
        Write-Host "  all        - Run all steps (default)"
        Write-Host ""
        Write-Host "Options:"
        Write-Host "  -ModelId               HuggingFace model ID (default: meta-llama/Llama-3.2-1B-Instruct)"
        Write-Host "  -Epochs                Number of training epochs (default: 1)"
        Write-Host "  -BatchSize             Batch size per GPU (default: 8)"
        Write-Host "  -GradientAccumulation  Gradient accumulation steps (default: 2)"
        Write-Host "  -MaxSamples            Limit training samples (default: 0 = all)"
        Write-Host "  -EarlyStoppingPatience Stop after N evals without improvement (default: 3)"
        Write-Host "  -Quantization          GGUF quantization type (default: Q5_K_M)"
        Write-Host ""
        Write-Host "Examples:"
        Write-Host "  .\run.ps1 all                              # Full training (~5-10 hours)"
        Write-Host "  .\run.ps1 train -MaxSamples 20000          # Fast training (~2-3 hours)"
        Write-Host "  .\run.ps1 train -MaxSamples 10000 -Epochs 2  # Quick test (~1-2 hours)"
        Write-Host "  .\run.ps1 benchmark                        # Compare base vs fine-tuned"
        Write-Host "  .\run.ps1 convert -Quantization Q4_K_M"
        Write-Host ""
        Write-Host "Speed Tips:" -ForegroundColor Yellow
        Write-Host "  - Use -MaxSamples 20000 for a quick training run"
        Write-Host "  - Early stopping will auto-stop when validation loss plateaus"
        Write-Host "  - Increase -BatchSize if you have more VRAM"
        Write-Host ""
    }
}

} finally {
    Pop-Location
}
