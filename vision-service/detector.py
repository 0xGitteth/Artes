"""Supervised non-generative Artes heads. Artifacts contain JSON numbers, never pickle."""
import json
import math
from pathlib import Path

LABEL_VERSION = 'artes_detector_v1'
HEADS = {
    'nudity': ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'],
    'sexualContext': ['none', 'suggestive', 'bdsm_kink', 'explicit_act'],
    'graphicInjury': ['none', 'mild', 'graphic'],
    'possibleMinorConcern': [False, True],
}
SIGNALS = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare']
for signal in SIGNALS:
    HEADS['sensitive:' + signal] = [False, True]


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_artifact(artifact, expected_model_id, expected_revision):
    if artifact.get('schemaVersion') != 1 or artifact.get('labelVersion') != LABEL_VERSION:
        raise ValueError('unsupported_detector_artifact')
    if artifact.get('embeddingModelId') != expected_model_id or artifact.get('embeddingRevision') != expected_revision or artifact.get('embeddingDimension') != 768:
        raise ValueError('detector_embedding_version_mismatch')
    if not artifact.get('modelVersion') or not artifact.get('datasetVersion'):
        raise ValueError('missing_detector_versions')
    support = artifact.get('support')
    if support:
        if not finite(support.get('minCosine')) or not -1 <= support['minCosine'] <= 1 or not support.get('vectors'):
            raise ValueError('invalid_embedding_support')
        if any(len(row) != 768 or any(not finite(x) for x in row) or abs(sum(x*x for x in row)-1) > 1e-3 for row in support['vectors']):
            raise ValueError('invalid_embedding_support_vectors')
    for name, vocabulary in HEADS.items():
        head = artifact.get('heads', {}).get(name)
        if not head:
            raise ValueError('missing_detector_head:' + name)
        classes = head.get('classes', [])
        if len(classes) < 1 or len(set(map(str, classes))) != len(classes) or any(type(c) not in (str, bool) or c not in vocabulary for c in classes):
            raise ValueError('invalid_head_classes:' + name)
        weights, bias = head.get('weights', []), head.get('bias', [])
        if len(weights) != len(classes) or len(bias) != len(classes) or any(not finite(x) for x in bias):
            raise ValueError('invalid_head_shape:' + name)
        if any(len(row) != 768 or any(not finite(x) for x in row) for row in weights):
            raise ValueError('invalid_head_weights:' + name)
    return artifact


def load_detector(file_path, model_id, revision):
    return validate_artifact(json.loads(Path(file_path).read_text()), model_id, revision)


def infer_detector(artifact, vector):
    if len(vector) != 768 or any(not finite(x) for x in vector) or not any(vector):
        raise ValueError('invalid_detector_embedding')
    values, confidences, flags = {}, [], []
    support = artifact.get('support')
    if support:
        norm = math.sqrt(sum(x*x for x in vector))
        similarity = max(sum(a*b for a,b in zip(row, vector))/norm for row in support['vectors'])
        if similarity < support['minCosine']:
            flags.append('outside_calibrated_embedding_support')
    for name, vocabulary in HEADS.items():
        head = artifact['heads'][name]
        logits = [sum(w*x for w, x in zip(row, vector)) + bias for row, bias in zip(head['weights'], head['bias'])]
        scores = [math.exp(x - max(logits)) for x in logits]
        scores = [x / sum(scores) for x in scores]
        best = max(range(len(scores)), key=lambda i: scores[i])
        values[name] = head['classes'][best]
        confidences.append(scores[best])
        if set(map(str, head['classes'])) != set(map(str, vocabulary)):
            flags.append('incomplete_head_coverage:' + name)
    label = {key: values[key] for key in ['nudity', 'sexualContext', 'graphicInjury', 'possibleMinorConcern']}
    label.update(sensitiveSignals=[signal for signal in SIGNALS if values['sensitive:' + signal]], confidence=min(confidences), uncertaintyFlags=flags)
    return {'detectorLabel': label, 'labelVersion': LABEL_VERSION, 'modelVersion': artifact['modelVersion'], 'datasetVersion': artifact['datasetVersion']}
