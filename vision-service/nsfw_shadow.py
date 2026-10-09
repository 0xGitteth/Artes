"""Local, optional, observation-only NSFW detector for Artes staging.

The model's 'porn' label is a visual NSFW category, NOT proof of a sexual act.
It must never make moderation policy, publication, or CSAM decisions.
"""
import math
import re
from functools import lru_cache

MODEL_ID = 'viddexa/nsfw-detection-2-mini'
PROVIDER_ID = 'nsfw'
MODEL_LABELS = ('normal', 'porn', 'hentai', 'drawing', 'sexy')
SIGNAL_TYPES = {
    'normal': 'nsfw_normal_category',
    'porn': 'nsfw_porn_category',
    'hentai': 'nsfw_hentai_category',
    'drawing': 'nsfw_drawing_category',
    'sexy': 'nsfw_sexy_category',
}


def validate_revision(revision):
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('pinned_nsfw_model_revision_required')
    return revision


@lru_cache(maxsize=1)
def load_nsfw_model(revision):
    """Load once per process on CPU; model downloads only when explicitly enabled."""
    validate_revision(revision)
    from transformers import AutoImageProcessor, AutoModelForImageClassification
    processor = AutoImageProcessor.from_pretrained(
        MODEL_ID, revision=revision, use_fast=False, trust_remote_code=False,
    )
    model = AutoModelForImageClassification.from_pretrained(
        MODEL_ID, revision=revision, use_safetensors=True, trust_remote_code=False,
    )
    model.to('cpu')
    model.eval()
    return processor, model


def format_nsfw_scores(labels_to_scores, revision):
    validate_revision(revision)
    if not isinstance(labels_to_scores, dict):
        raise ValueError('invalid_nsfw_scores')
    normalized = {str(k).strip().lower(): v for k, v in labels_to_scores.items()}
    if set(normalized) != set(MODEL_LABELS):
        raise ValueError('unexpected_nsfw_model_labels')
    if any(
        not isinstance(score, (int, float)) or not math.isfinite(score)
        or score < 0 or score > 1 for score in normalized.values()
    ):
        raise ValueError('invalid_nsfw_scores')
    if abs(sum(normalized.values()) - 1) > 0.005:
        raise ValueError('invalid_nsfw_score_sum')
    return {
        'contractVersion': 1,
        'providerId': PROVIDER_ID,
        'modelVersion': revision,
        # Uncalibrated probability labels are not a policy decision.
        'uncertain': True,
        'signals': [
            {'type': SIGNAL_TYPES[label], 'confidence': float(normalized[label])}
            for label in MODEL_LABELS
        ],
    }


def classify_nsfw(image, revision):
    """Return five independent diagnostic class scores with no final policy verdict."""
    validate_revision(revision)
    import torch
    processor, model = load_nsfw_model(revision)
    inputs = processor(images=image, return_tensors='pt')
    with torch.inference_mode():
        logits = model(**inputs).logits
        probabilities = torch.softmax(logits, dim=-1)[0].detach().cpu().tolist()
    labels = [
        str(model.config.id2label[index]).strip().lower()
        if index in model.config.id2label
        else str(model.config.id2label[str(index)]).strip().lower()
        for index in range(len(probabilities))
    ]
    if len(set(labels)) != len(labels):
        raise ValueError('duplicate_nsfw_model_labels')
    return format_nsfw_scores(dict(zip(labels, probabilities)), revision)
