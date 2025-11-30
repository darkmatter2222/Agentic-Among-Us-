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

**Llama-3.2-1B-Instruct (Q5_K_M)**
- Size: ~0.91 GB
- Speed: ~60-150 tokens/sec on RTX 3090
- Decision time: ~300-500ms per agent decision
- Context: 4,096 tokens (configurable)

### Why This Model?

We chose Llama-3.2-1B-Instruct for optimal reasoning/speed balance:

| Model | Size | Speed | Notes |
|-------|------|-------|-------|
| Qwen2.5-0.5B | ~0.5 GB | ~350 tok/s | Ultra fast but limited reasoning |
| **Llama-3.2-1B-Q5_K_M** | **~0.91 GB** | **~60-150 tok/s** | **Strong reasoning, fast** |
| Qwen2.5-3B | ~2.1 GB | ~180 tok/s | Good but overkill for agents |

Llama 3.2 1B offers **significantly better multi-step reasoning** than 0.5B models while staying fast enough for 8 concurrent agents.

### Container Configuration

```bash
docker run -d --name llama-server \
  --gpus all \
  -v /home/darkmatter2222/models:/models \
  -p 8080:8080 \
  ghcr.io/ggerganov/llama.cpp:server-cuda \
  -m /models/Llama-3.2-1B-Instruct-Q5_K_M.gguf \
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
| `MODEL_FILE` | GGUF model filename | `Llama-3.2-1B-Instruct-Q5_K_M.gguf` |
| `CONTEXT_SIZE` | Max context tokens | `4096` |
| `FLASH_ATTENTION` | Enable flash attention | `true` |

## Troubleshooting

### Container won't start
- Check GPU is available: `nvidia-smi`
- Ensure Docker has GPU access: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`

### Model download fails
- Manual download: `wget https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q5_K_M.gguf`

### Slow inference
- Ensure all layers on GPU (`-ngl 99`)
- Enable Flash Attention (`-fa`)
- Check GPU memory: `nvidia-smi`

### Out of memory (unlikely with 1B model)
- The 1B model only uses ~1GB VRAM
- RTX 3090 has 24GB - plenty of headroom

## API Endpoint

Once running, the OpenAI-compatible API is available at:

```
http://192.168.86.48:8080/v1/chat/completions
```

Test with:
```powershell
$body = @{model="llama";messages=@(@{role="user";content="Hello"});max_tokens=50} | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri "http://192.168.86.48:8080/v1/chat/completions" -Method Post -ContentType "application/json" -Body $body
```

## Related Documentation

- [`agents.md`](./agents.md) — Infrastructure documentation for AI agents
- [`../README.md`](../README.md) — Main project documentation
