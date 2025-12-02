# Fine-tuning Llama 3.2 1B for Among Us AI Agents

This directory contains scripts to fine-tune Llama 3.2 1B-Instruct to reduce refusals and teach the model that Among Us game prompts are safe.

## Goal

The goal is to train the model to:
1. **Not refuse simple game instructions** - The model should understand that Among Us roleplaying prompts are harmless fiction
2. **Trust the user** - Instructions about "tagging" (killing), "tricksters" (impostors), and game mechanics are safe
3. **Respond in the expected format** - JSON responses for decisions, short speech for conversations

## Hardware Requirements

- **GPU**: RTX 5090 (or any modern GPU with 16GB+ VRAM)
- **RAM**: 32GB+ recommended
- **Storage**: ~10GB for models and data

## Quick Start

### 1. Install Dependencies

```powershell
cd fine-tune
pip install -r requirements.txt
```

### 2. Prepare Training Data

```powershell
python prepare_dataset.py
```

This reads from `../LLM-training-data/success/` and creates:
- `data/train.jsonl` - Training examples (90%)
- `data/val.jsonl` - Validation examples (10%)
- `data/train_text.jsonl` - Full formatted text for certain training approaches

### 3. Fine-tune the Model

```powershell
# Using HuggingFace model (requires HF login for Llama)
python train.py --model_id meta-llama/Llama-3.2-1B-Instruct

# Or with local model path
python train.py --model_id /path/to/your/llama-model
```

**Key training parameters:**
- `--epochs 3` - Number of epochs (default: 3)
- `--batch_size 4` - Batch size per GPU (default: 4)
- `--lora_r 64` - LoRA rank (default: 64)
- `--learning_rate 2e-4` - Learning rate (default: 2e-4)

### 4. Merge the LoRA Adapter

```powershell
python merge_model.py --adapter_path ./output/final
```

### 5. Convert to GGUF

```powershell
python convert_to_gguf.py --model_path ./merged_model --quantization Q5_K_M
```

### 6. Deploy

Copy the generated `.gguf` file to your llama.cpp deployment:

```powershell
# Copy to your docker LLM directory
cp ./gguf_model/model-Q5_K_M.gguf ../docker-manage/LLM/models/

# Restart the LLM container
cd ../docker-manage/LLM
./start.ps1
```

## Training Data Format

The training data is collected from successful LLM interactions during gameplay. Each entry contains:

```json
{
  "messages": [
    {"role": "system", "content": "System prompt with game context..."},
    {"role": "user", "content": "Current situation and question..."},
    {"role": "assistant", "content": "Model's response..."}
  ],
  "metadata": {
    "request_type": "decision|thought|conversation",
    "agent_role": "CREWMATE|IMPOSTOR"
  }
}
```

## Why Fine-tune?

Llama 3.2 1B sometimes refuses to:
- Generate content about "killing" (even in game context)
- Roleplay as an "impostor" 
- Make strategic decisions about "hunting" players

Fine-tuning on successful examples teaches the model:
1. These are harmless game mechanics
2. The expected response format
3. In-character roleplay is appropriate

## Advanced Options

### Using Weights & Biases

```powershell
python train.py --use_wandb --wandb_project among-us-llama
```

### Custom LoRA Configuration

```powershell
python train.py --lora_r 128 --lora_alpha 256 --lora_dropout 0.1
```

### Memory Optimization

If running out of memory:
```powershell
python train.py --batch_size 2 --gradient_accumulation 8 --max_seq_length 1024
```

## File Structure

```
fine-tune/
├── README.md              # This file
├── requirements.txt       # Python dependencies
├── prepare_dataset.py     # Convert training data to required format
├── train.py              # Main fine-tuning script (QLoRA + SFT)
├── merge_model.py        # Merge LoRA adapter with base model
├── convert_to_gguf.py    # Convert to GGUF for llama.cpp
├── data/                 # Generated training data (after prepare_dataset.py)
├── output/               # Training outputs (checkpoints, final adapter)
├── merged_model/         # Merged HF model (after merge_model.py)
└── gguf_model/           # GGUF files (after convert_to_gguf.py)
```

## Troubleshooting

### "CUDA out of memory"
- Reduce `--batch_size` to 1 or 2
- Increase `--gradient_accumulation` to compensate
- Reduce `--max_seq_length` to 1024

### "Model refuses to load"
- Ensure you're logged into HuggingFace: `huggingface-cli login`
- Accept Llama license on HuggingFace website
- Or use a local model path

### "Training loss not decreasing"
- Try higher `--learning_rate` (e.g., 5e-4)
- Increase `--epochs` to 5-10
- Check if data is loaded correctly with prepare_dataset.py output

## License

This fine-tuning setup is for the Agentic Among Us project.
Llama models are subject to Meta's license agreement.
