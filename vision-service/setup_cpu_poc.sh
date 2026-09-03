#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python}"
VENV_DIR=".venv"

if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python"

"$VENV_PYTHON" -m pip install --upgrade --no-cache-dir pip

# Install CPU-only PyTorch + Torchvision together. Using PyPI directly for
# either package on Linux can pull CUDA runtime packages that are unnecessary
# for the local POC, and Transformers AutoImageProcessor requires Torchvision.
"$VENV_PYTHON" -m pip install \
  --no-cache-dir \
  --index-url https://download.pytorch.org/whl/cpu \
  'torch>=2.2,<3' \
  'torchvision>=0.17,<1'

# Torch and Torchvision are already satisfied by the CPU-only install above;
# the remaining dependencies can safely come from the normal package index.
"$VENV_PYTHON" -m pip install --no-cache-dir -r requirements.txt

"$VENV_PYTHON" - <<'PY'
import json
import PIL
import torch
import torchvision
import transformers
import fastapi
import uvicorn

print(json.dumps({
    "ready": True,
    "torchVersion": torch.__version__,
    "torchvisionVersion": torchvision.__version__,
    "torchCudaAvailable": torch.cuda.is_available(),
    "transformersVersion": transformers.__version__,
    "pillowVersion": PIL.__version__,
    "fastapiVersion": fastapi.__version__,
    "uvicornVersion": uvicorn.__version__,
    "expectedDevice": "cpu",
}, indent=2))
PY
