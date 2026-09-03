import base64
import io
import os
from functools import lru_cache

import torch
import torch.nn.functional as F
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image
from transformers import AutoImageProcessor, AutoModel

MODEL_ID = os.getenv('ARTES_DINOV2_MODEL_ID', 'facebook/dinov2-base')
PROVIDER = 'artes_custom_vision'
MODEL_NAME = 'dinov2_vitb14'
EMBEDDING_DIMENSION = 768
MAX_IMAGE_BYTES = int(os.getenv('ARTES_VISION_MAX_IMAGE_BYTES', str(15 * 1024 * 1024)))
ALLOWED_MIME_TYPES = {'image/jpeg', 'image/png', 'image/webp'}

app = FastAPI(title='Artes moderation vision POC', version='1')


class ImagePayload(BaseModel):
    mimeType: str
    base64: str


class InferenceRequest(BaseModel):
    contractVersion: int = Field(default=1)
    image: ImagePayload
    requestedOutputs: list[str] = Field(default_factory=lambda: ['embedding'])


class EmbeddingPayload(BaseModel):
    provider: str
    model: str
    vector: list[float]


class InferenceResponse(BaseModel):
    embedding: EmbeddingPayload
    detectorResult: dict | None = None


@lru_cache(maxsize=1)
def load_model():
    processor = AutoImageProcessor.from_pretrained(MODEL_ID)
    model = AutoModel.from_pretrained(MODEL_ID)
    model.eval()
    return processor, model


def decode_image(payload: ImagePayload) -> Image.Image:
    mime_type = payload.mimeType.strip().lower()
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail='unsupported_mime_type')
    try:
        raw = base64.b64decode(payload.base64, validate=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail='invalid_base64') from error
    if not raw:
        raise HTTPException(status_code=400, detail='empty_image')
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail='image_too_large')
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        return image.convert('RGB')
    except Exception as error:
        raise HTTPException(status_code=400, detail='invalid_image') from error


def embed_image(image: Image.Image) -> list[float]:
    processor, model = load_model()
    inputs = processor(images=image, return_tensors='pt')
    with torch.inference_mode():
        outputs = model(**inputs)
        vector = outputs.last_hidden_state[:, 0, :]
        vector = F.normalize(vector, p=2, dim=1)
    values = vector[0].detach().cpu().tolist()
    if len(values) != EMBEDDING_DIMENSION:
        raise RuntimeError(f'unexpected_embedding_dimension:{len(values)}')
    return [float(value) for value in values]


@app.get('/health')
def health():
    return {
        'status': 'ok',
        'provider': PROVIDER,
        'model': MODEL_NAME,
        'modelId': MODEL_ID,
        'embeddingDimension': EMBEDDING_DIMENSION,
        'generative': False,
        'detectorConfigured': False,
    }


@app.post('/v1/infer', response_model=InferenceResponse)
def infer(request: InferenceRequest):
    if request.contractVersion != 1:
        raise HTTPException(status_code=400, detail='unsupported_contract_version')
    requested = set(request.requestedOutputs or [])
    if 'embedding' not in requested:
        raise HTTPException(status_code=400, detail='embedding_output_required')

    image = decode_image(request.image)
    vector = embed_image(image)
    return InferenceResponse(
        embedding=EmbeddingPayload(
            provider=PROVIDER,
            model=MODEL_NAME,
            vector=vector,
        ),
        # Deliberately absent until a supervised Artes detector artifact exists.
        detectorResult=None,
    )
