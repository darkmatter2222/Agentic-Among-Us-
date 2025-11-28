# Docker Management for LLM Server

Scripts to manage the llama.cpp Docker container running on your home server (Ubuntu with RTX 3090).

## Quick Start

```powershell
# One command to deploy everything
.\deploy.ps1
```

This will:
1. Stop any existing containers
2. Install Docker + NVIDIA toolkit (if needed)
3. Download the model from HuggingFace
4. Start the llama.cpp server with CUDA
5. Test the LLM endpoint

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
| `deploy.ps1` | Full deployment: install Docker, download model, start container, test |
| `teardown.ps1` | Stop and remove all GPU containers |
| `start.ps1` | Start the llama.cpp container with current model |
| `status.ps1` | Check container status and GPU usage |
| `logs.ps1` | View container logs |
| `switch-model.ps1` | Switch to a different model |

### Usage

```powershell
# Full deploy (recommended first time)
.\deploy.ps1

# Just tear down existing containers
.\teardown.ps1

# Check status
.\status.ps1

# View logs
.\logs.ps1
```

## Current Model

**Qwen2.5-3B-Instruct (Q4_K_M)**
- Size: ~2.1 GB
- Speed: ~180 tokens/sec on RTX 3090
- Decision time: ~300-400ms per agent decision
- Context: 4,096 tokens (configurable)

### Why This Model?

We chose Qwen2.5-3B-Instruct for optimal speed/quality balance:

| Model | Size | Speed | Decision Time |
|-------|------|-------|---------------|
| Qwen3-8B-Q4_K_M | ~5 GB | ~110 tok/s | ~2500ms |
| **Qwen2.5-3B-Q4_K_M** | **~2 GB** | **~180 tok/s** | **~350ms** |

The 3B model is **4x faster** while maintaining excellent reasoning quality for game agent decisions.

### Container Configuration

```bash
docker run -d --name llama-server \
  --gpus all \
  -v /home/darkmatter2222/models:/models \
  -p 8080:8080 \
  ghcr.io/ggerganov/llama.cpp:server-cuda \
  -m /models/qwen2.5-3b-instruct-q4_k_m.gguf \
  --host 0.0.0.0 --port 8080 \
  -ngl 99 -c 4096 -fa
```

**Flags:**
- `-ngl 99`: Offload all layers to GPU
- `-c 4096`: Context size (4K tokens)
- `-fa`: Flash Attention for faster inference

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SSH_HOST` | Ubuntu server IP | `192.168.86.48` |
| `SSH_USER` | SSH username | `darkmatter2222` |
| `SSH_PASSWORD` | SSH password | - |
| `MODEL_FILE` | GGUF model filename | `qwen2.5-3b-instruct-q4_k_m.gguf` |
| `CONTEXT_SIZE` | Max context tokens | `4096` |
| `FLASH_ATTENTION` | Enable flash attention | `true` |

## Troubleshooting

### Container won't start
- Check GPU is available: `nvidia-smi`
- Ensure Docker has GPU access: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`

### Model download fails
- Manual download: `wget https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf`

### Slow inference
- Ensure all layers on GPU (`-ngl 99`)
- Enable Flash Attention (`-fa`)
- Check GPU memory: `nvidia-smi`

### Out of memory (unlikely with 3B model)
- The 3B model only uses ~2GB VRAM
- RTX 3090 has 24GB - plenty of headroom

## API Endpoint

Once running, the OpenAI-compatible API is available at:

```
http://192.168.86.48:8080/v1/chat/completions
```

Test with:
```powershell
$body = @{model="qwen";messages=@(@{role="user";content="Hello"});max_tokens=50} | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri "http://192.168.86.48:8080/v1/chat/completions" -Method Post -ContentType "application/json" -Body $body
```

## Related Documentation

- [`agents.md`](./agents.md) — Infrastructure documentation for AI agents
- [`../README.md`](../README.md) — Main project documentation
