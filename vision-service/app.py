import base64
import io
import logging
import os
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, ImageOps
from dino_features import DinoFeatures
from linear_heads import load_artifact, predict_heads, build_head_result

MODEL_ID = os.getenv('ARTES_DINOV2_MODEL_ID', 'facebook/dinov2-base')
PROVIDER = 'artes_custom_vision'
MODEL_NAME = 'dinov2_vitb14'
EMBEDDING_DIMENSION = 768
MAX_IMAGE_BYTES = int(os.getenv('ARTES_VISION_MAX_IMAGE_BYTES', str(15 * 1024 * 1024)))
ALLOWED_MIME_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
logger = logging.getLogger('artes.vision')

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
    headPredictions: dict | None = None


@lru_cache(maxsize=1)
def load_model():
    artifact = load_classifier()
    revision = artifact['featureDefinition']['revision'] if artifact else os.getenv('ARTES_DINOV2_REVISION', 'main')
    features = DinoFeatures(MODEL_ID, revision)
    if artifact:
        from linear_heads import validate_artifact
        validate_artifact(artifact, features.definition)
    return features


@lru_cache(maxsize=1)
def load_classifier():
    path = os.getenv('ARTES_CLASSIFIER_ARTIFACT')
    return load_artifact(path) if path else None


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
        return ImageOps.exif_transpose(image).convert('RGB')
    except Exception as error:
        raise HTTPException(status_code=400, detail='invalid_image') from error


def embed_image(image: Image.Image) -> list[float]:
    values = load_model().embed([image])[0].tolist()
    if len(values) != EMBEDDING_DIMENSION:
        raise RuntimeError(f'unexpected_embedding_dimension:{len(values)}')
    return [float(value) for value in values]


@app.get('/health')
def health():
    try:
        artifact = load_classifier()
    except Exception:
        logger.exception('Classifier artifact could not be loaded.')
        raise HTTPException(status_code=503, detail='classifier_artifact_invalid')
    return {
        'status': 'ok',
        'provider': PROVIDER,
        'model': MODEL_NAME,
        'modelId': MODEL_ID,
        'embeddingDimension': EMBEDDING_DIMENSION,
        'generative': False,
        'detectorConfigured': False,
        'classifierHeadsConfigured': artifact is not None,
        'classifierModelVersion': artifact['modelVersion'] if artifact else None,
        'runtimeEligible': False,
    }


@app.post('/v1/infer', response_model=InferenceResponse)
def infer(request: InferenceRequest):
    if request.contractVersion != 1:
        raise HTTPException(status_code=400, detail='unsupported_contract_version')
    requested = set(request.requestedOutputs or [])
    if 'embedding' not in requested:
        raise HTTPException(status_code=400, detail='embedding_output_required')

    image = decode_image(request.image)
    try:
        vector = embed_image(image)
    except HTTPException:
        raise
    except Exception as error:
        logger.exception('Vision model inference failed.')
        raise HTTPException(status_code=503, detail='vision_model_unavailable') from error

    try:
        artifact = load_classifier()
        heads = build_head_result(artifact, predict_heads(artifact, vector)[0]) if artifact else None
    except Exception as error:
        logger.exception('Classifier inference failed.')
        raise HTTPException(status_code=503, detail='classifier_unavailable') from error

    return InferenceResponse(
        embedding=EmbeddingPayload(
            provider=PROVIDER,
            model=MODEL_NAME,
            vector=vector,
        ),
        # Two experimental heads do not implement the full safety contract.
        # Keep their predictions separate instead of inventing safety labels.
        detectorResult=None,
        headPredictions=heads,
    )
