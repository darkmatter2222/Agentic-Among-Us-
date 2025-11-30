# Docker LLM Infrastructure - AI Agent Reference

> **Note**: This document provides infrastructure context for AI agents working with the docker-manage scripts. For game mechanics, see [`../agents.md`](../agents.md).

---

## ⚠️ Development Notes

**DO NOT** stop or restart the LLM server during active simulation testing. The simulation server depends on the LLM endpoint being available.

---

## Infrastructure Overview

### Server Configuration

| Component | Details |
|-----------|---------|
| **Host** | Ubuntu server at `192.168.86.48` |
| **GPU** | NVIDIA RTX 3090 (24GB VRAM) |
| **Docker** | Version 29.1.0 with NVIDIA Container Toolkit |
| **Container Image** | `ghcr.io/ggerganov/llama.cpp:server-cuda` |

### Current Model

| Property | Value |
|----------|-------|
| **Model** | Llama-3.2-1B-Instruct |
| **Quantization** | Q5_K_M |
| **File** | `Llama-3.2-1B-Instruct-Q5_K_M.gguf` |
| **Size** | ~0.91 GB |
| **VRAM Usage** | ~1 GB |
| **Speed** | ~60-150 tokens/sec |

### Performance Characteristics

```
Prompt Processing:  ~1,500-2,500 tokens/sec
Token Generation:   ~60-150 tokens/sec
Per-Token Latency:  ~7-15ms
50 Token Response:  ~400-800ms
100 Token Response: ~700-1500ms
```

---

## SSH Connection

Scripts use PuTTY's `plink.exe` for SSH connections from Windows:

```powershell
plink.exe -ssh darkmatter2222@192.168.86.48 -pw "B10hazard!" "command"
```

**Credentials** (stored in `.env`):
- Host: `192.168.86.48`
- User: `darkmatter2222`
- Password: `B10hazard!`

---

## Docker Container Configuration

### Start Command

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

### Flag Reference

| Flag | Description | Current Value |
|------|-------------|---------------|
| `-m` | Model path | `/models/Llama-3.2-1B-Instruct-Q5_K_M.gguf` |
| `--host` | Bind address | `0.0.0.0` |
| `--port` | Server port | `8080` |
| `-ngl` | GPU layers | `99` (all layers) |
| `-c` | Context size | `4096` tokens |
| `-fa` | Flash Attention | Enabled |

---

## API Endpoint

### Base URL
```
http://192.168.86.48:8080
```

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/completions` | POST | OpenAI-compatible completions |

### Example Request

```json
{
  "model": "qwen",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello"}
  ],
  "max_tokens": 100,
  "temperature": 0.7
}
```

### Example Response

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 8,
    "total_tokens": 23
  },
  "timings": {
    "predicted_per_second": 180.5
  }
}
```

---

## Script Reference

### deploy.ps1

Full deployment script with 7 steps:

1. **Tear down** existing container
2. **Install Docker** (if not present)
3. **Configure NVIDIA toolkit** (if not present)
4. **Download model** from HuggingFace
5. **Start container** with CUDA
6. **Wait for health** endpoint
7. **Test LLM** with sample prompt

### teardown.ps1

Stops and removes the llama-server container.

### status.ps1

Shows:
- Container status
- GPU memory usage (`nvidia-smi`)
- Health endpoint response

### logs.ps1

Streams container logs (last 100 lines by default).

### start.ps1

Starts the container with current `.env` configuration.

### switch-model.ps1

Downloads and switches to a different model.

---

## Model Selection History

| Date | Model | Size | Speed | Notes |
|------|-------|------|-------|-------|
| Nov 2024 | Qwen3-8B-Q8_0 | 8.7 GB | ~50 tok/s | Initial, too slow |
| Nov 2024 | Qwen3-8B-Q4_K_M | 5 GB | ~110 tok/s | Better, still slow |
| Nov 2024 | Qwen2.5-3B-Q4_K_M | 2.1 GB | ~180 tok/s | Good but limited reasoning |
| Nov 2024 | Qwen2.5-0.5B-Q8_0 | 0.5 GB | ~350 tok/s | Ultra fast but too simple |
| Nov 2024 | **Llama-3.2-1B-Q5_K_M** | **0.91 GB** | **~60-150 tok/s** | **Current - best reasoning/speed** |

### Why Llama-3.2-1B?

- **Strong multi-step reasoning** - Meta Llama 3.2 family excels at instruction-following
- **1B params** is a big jump over 0.5B for complex planning and deception
- **Light enough** for 8 concurrent agents on RTX 3090
- **Q5_K_M quant** is author-recommended sweet spot

---

## Troubleshooting

### Container won't start

```bash
# Check Docker
docker --version

# Check GPU access
nvidia-smi

# Test CUDA in Docker
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Slow inference

```bash
# Verify GPU layers
docker logs llama-server 2>&1 | grep "offloaded"

# Should show: "99 layers offloaded to GPU"
```

### Connection refused

```bash
# Check container is running
docker ps

# Check port binding
docker port llama-server

# Test health
curl http://localhost:8080/health
```

### Out of memory

Unlikely with 1B model (uses ~1GB of 24GB), but if needed:
- Reduce context: `-c 2048`
- Use smaller model: Qwen2.5-0.5B

---

## File Locations

### On Ubuntu Server

```
/home/darkmatter2222/models/
├── Llama-3.2-1B-Instruct-Q5_K_M.gguf  # Current model (~0.91GB)
├── qwen2.5-0.5b-instruct-q8_0.gguf    # Previous model (~0.5GB)
├── qwen2.5-3b-instruct-q4_k_m.gguf    # Legacy model (~2.1GB)
└── Qwen3-8B-Q8_0.gguf                 # Original model (~8.7GB)
```

### On Windows (this repo)

```
docker-manage/
├── .env                # Configuration (SSH creds, model settings)
├── .env.example        # Template
├── deploy.ps1          # Full deployment
├── teardown.ps1        # Stop/remove container
├── start.ps1           # Start container
├── status.ps1          # Check status
├── logs.ps1            # View logs
├── switch-model.ps1    # Change model
├── README.md           # User documentation
└── agents.md           # This file
```

---

## Integration with Simulation

The simulation server (`server/src/ai/AIDecisionService.ts`) connects to:

```typescript
const LLM_URL = 'http://192.168.86.48:8080/v1/chat/completions';
const TIMEOUT = 10000; // 10 second timeout
const MAX_TOKENS = 100; // ~580ms response time
```

Agent decisions are queued through `LLMQueue.ts` to prevent overwhelming the LLM server.
