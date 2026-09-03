#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python}"
VENV_DIR=".venv"

if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python"

"$VENV_PYTHON" -m pip install --upgrade pip

# Install a CPU-only PyTorch wheel first. Using PyPI directly for torch on Linux
# can pull large CUDA runtime packages that are unnecessary for the local POC.
"$VENV_PYTHON" -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  'torch>=2.2,<3'

# Torch is already satisfied by the CPU-only install above; the remaining
# dependencies can safely come from the normal package index.
"$VENV_PYTHON" -m pip install -r requirements.txt

"$VENV_PYTHON" - <<'PY'
import json
import PIL
import torch
import transformers
import fastapi
import uvicorn

print(json.dumps({
    "ready": True,
    "torchVersion": torch.__version__,
    "torchCudaAvailable": torch.cuda.is_available(),
    "transformersVersion": transformers.__version__,
    "pillowVersion": PIL.__version__,
    "fastapiVersion": fastapi.__version__,
    "uvicornVersion": uvicorn.__version__,
    "expectedDevice": "cpu",
}, indent=2))
PY
