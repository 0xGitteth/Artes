import base64
import io
import logging
import os
import secrets
from functools import lru_cache
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel, Field
from PIL import Image
from detector import load_detector, infer_detector
from nsfw_shadow import classify_nsfw, validate_revision

MODEL_REVISION = os.getenv('ARTES_DINOV2_REVISION')
DETECTOR_PATH = os.getenv('ARTES_DETECTOR_ARTIFACT')
MODEL_ID = os.getenv('ARTES_DINOV2_MODEL_ID', 'facebook/dinov2-base')
PROVIDER = 'artes_custom_vision'
MODEL_NAME = 'dinov2_vitb14'
EMBEDDING_DIMENSION = 768
MAX_IMAGE_BYTES = int(os.getenv('ARTES_VISION_MAX_IMAGE_BYTES', str(15 * 1024 * 1024)))
AUTH_TOKEN = os.getenv('ARTES_VISION_AUTH_TOKEN')
NSFW_SHADOW_ENABLED = os.getenv('ARTES_NSFW_SHADOW_ENABLED') == 'true'
NSFW_SHADOW_TOKEN = os.getenv('ARTES_NSFW_SHADOW_TOKEN')
NSFW_MODEL_REVISION = os.getenv('ARTES_NSFW_MODEL_REVISION')
ALLOWED_MIME_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
logger = logging.getLogger('artes.vision')

@asynccontextmanager
async def lifespan(_app):
    # Warm an installed detector before accepting upload requests.
    if DETECTOR_PATH:
        configured_detector()
        load_model()
    yield


app = FastAPI(title='Artes moderation vision service', version='1', lifespan=lifespan)


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
    from transformers import AutoImageProcessor, AutoModel
    processor = AutoImageProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model = AutoModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model.eval()
    return processor, model


@lru_cache(maxsize=1)
def configured_detector():
    if not DETECTOR_PATH:
        return None
    if not MODEL_REVISION:
        raise ValueError('pinned_embedding_revision_required_for_detector')
    return load_detector(DETECTOR_PATH, MODEL_ID, MODEL_REVISION)


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
    import torch
    import torch.nn.functional as F
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
        'detectorConfigured': bool(DETECTOR_PATH),
        'embeddingRevision': MODEL_REVISION,
        'detectorReady': bool(configured_detector()),
        'embeddingReady': bool(load_model.cache_info().currsize),
    }


def authorize(authorization: str | None = Header(default=None)):
    if AUTH_TOKEN and not secrets.compare_digest(authorization or '', 'Bearer ' + AUTH_TOKEN):
        raise HTTPException(status_code=401, detail='unauthorized')


@app.post('/v1/signals')
def nsfw_shadow_signals(request: InferenceRequest, authorization: str | None = Header(default=None)):
    # This route is disabled by default even when the existing vision service runs.
    if not NSFW_SHADOW_ENABLED:
        raise HTTPException(status_code=404, detail='shadow_not_enabled')
    # Never accept image uploads into an unauthenticated model endpoint.
    if not NSFW_SHADOW_TOKEN:
        raise HTTPException(status_code=503, detail='shadow_token_not_configured')
    if not secrets.compare_digest(authorization or '', 'Bearer ' + NSFW_SHADOW_TOKEN):
        raise HTTPException(status_code=401, detail='unauthorized')
    try:
        revision = validate_revision(NSFW_MODEL_REVISION)
    except ValueError as error:
        raise HTTPException(status_code=503, detail='shadow_model_revision_not_pinned') from error
    if request.contractVersion != 1 or request.requestedOutputs != ['signals']:
        raise HTTPException(status_code=400, detail='invalid_shadow_contract')
    image = decode_image(request.image)
    try:
        return classify_nsfw(image, revision)
    except Exception as error:
        # No raw images, provider secrets or model exception text in the API response.
        logger.error('Shadow NSFW inference failed (%s).', type(error).__name__)
        raise HTTPException(status_code=503, detail='shadow_model_unavailable') from error


@app.post('/v1/infer', response_model=InferenceResponse, dependencies=[Depends(authorize)])
def infer(request: InferenceRequest):
    if request.contractVersion != 1:
        raise HTTPException(status_code=400, detail='unsupported_contract_version')
    requested = set(request.requestedOutputs or [])
    if 'embedding' not in requested:
        raise HTTPException(status_code=400, detail='embedding_output_required')

    image = decode_image(request.image)
    try:
        vector = embed_image(image)
        detector = configured_detector() if 'detector' in requested else None
        detector_result = infer_detector(detector, vector) if detector else None
    except HTTPException:
        raise
    except Exception as error:
        logger.exception('Vision model inference failed.')
        raise HTTPException(status_code=503, detail='vision_model_unavailable') from error

    return InferenceResponse(
        embedding=EmbeddingPayload(
            provider=PROVIDER,
            model=MODEL_NAME,
            vector=vector,
        ),
        detectorResult=detector_result,
    )
