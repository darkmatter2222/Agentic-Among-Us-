# Docker Management for LLM Server

Scripts to manage the llama.cpp Docker container running on your home server (Ubuntu with RTX 3090).

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your SSH credentials in `.env`:
   - `SSH_HOST`: Your server IP (default: 192.168.86.48)
   - `SSH_USER`: Your username on the Ubuntu server
   - `SSH_KEY_PATH`: Path to your SSH private key (or use `SSH_PASSWORD`)

## Scripts

### PowerShell Scripts (Windows)

| Script | Description |
|--------|-------------|
| `deploy.ps1` | Full deployment: tear down old container, download new model, start new container |
| `teardown.ps1` | Stop and remove all GPU containers |
| `start.ps1` | Start the llama.cpp container with current model |
| `status.ps1` | Check container status and GPU usage |
| `logs.ps1` | View container logs |

### Usage

```powershell
# Full deploy with new Qwen3-8B model
.\deploy.ps1

# Just tear down existing containers
.\teardown.ps1

# Check status
.\status.ps1

# View logs
.\logs.ps1
```

## Model Info

**Qwen3-8B-GGUF (Q8_0)**
- Size: ~8.71 GB
- Context: 32,768 tokens (up to 131,072 with YaRN)
- Features:
  - Thinking/non-thinking modes (`/think`, `/no_think`)
  - Excellent agent capabilities
  - 100+ language support
  - Superior reasoning vs Qwen2.5

### Best Practices for Qwen3

- **Thinking mode**: `Temperature=0.6`, `TopP=0.95`, `TopK=20`
- **Non-thinking mode**: `Temperature=0.7`, `TopP=0.8`, `TopK=20`
- Use `presence_penalty=1.5` for quantized models to reduce repetition

## Troubleshooting

### Container won't start
- Check GPU is available: `nvidia-smi`
- Ensure Docker has GPU access: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`

### Model download fails
- The script uses `huggingface-cli` - ensure it's installed in the container
- Or manually download: `wget https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q8_0.gguf`

### Out of memory
- Try Q6_K (~6.73 GB) or Q5_K_M (~5.85 GB) quantization instead
- Reduce `GPU_LAYERS` or `CONTEXT_SIZE`
