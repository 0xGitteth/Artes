"""Load numeric classifier weights; never deserialize executable pickle data."""
import json
import numpy as np
from reviewed_dataset import HEAD_CLASSES, LABEL_DEFINITION


def validate_artifact(artifact, feature_definition=None):
    if (artifact.get('schemaVersion') != 1
            or artifact.get('artifactType') != 'artes_supervised_linear_heads'
            or artifact.get('scope') != 'offline_research_probe'
            or artifact.get('runtimeEligible') is not False
            or artifact.get('productionEligible') is not False
            or artifact.get('labelDefinitionVersion') != LABEL_DEFINITION
            or not artifact.get('modelVersion') or not artifact.get('datasetVersion')):
        raise ValueError('invalid_classifier_artifact_scope')
    definition = artifact.get('featureDefinition', {})
    if (definition.get('dimension') != 768 or definition.get('pooling') != 'cls_last_hidden_state'
            or definition.get('normalization') != 'l2' or not definition.get('revision')
            or not definition.get('modelId') or not definition.get('processorSha256')):
        raise ValueError('invalid_feature_definition')
    if feature_definition is not None and definition != feature_definition:
        raise ValueError('classifier_backbone_or_preprocessing_mismatch')
    if set(artifact.get('heads', {})) != set(HEAD_CLASSES):
        raise ValueError('unexpected_or_missing_classifier_head')
    for name, required_classes in HEAD_CLASSES.items():
        head = artifact.get('heads', {}).get(name, {})
        if (not isinstance(head.get('classes'), list)
                or len(head['classes']) != len(set(head['classes']))
                or set(head['classes']) != set(required_classes)):
            raise ValueError(f'invalid_classifier_classes:{name}')
        coef, intercept = np.asarray(head.get('coefficients'), dtype=float), np.asarray(head.get('intercepts'), dtype=float)
        if (coef.shape != (len(required_classes), 768)
                or intercept.shape != (len(required_classes),)
                or not np.isfinite(coef).all() or not np.isfinite(intercept).all()):
            raise ValueError(f'invalid_classifier_weights:{name}')
    return artifact


def load_artifact(path, feature_definition=None):
    with open(path) as handle:
        return validate_artifact(json.load(handle), feature_definition)


def predict_heads(artifact, embeddings):
    vectors = np.asarray(embeddings, dtype=float)
    if vectors.ndim == 1:
        vectors = vectors[None, :]
    if vectors.ndim != 2 or vectors.shape[1] != 768 or not np.isfinite(vectors).all():
        raise ValueError('invalid_classifier_input')
    if not np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-4):
        raise ValueError('classifier_embedding_must_be_l2_normalized')
    predictions = [{} for _ in vectors]
    for name, head in artifact['heads'].items():
        scores = vectors @ np.asarray(head['coefficients']).T + np.asarray(head['intercepts'])
        scores -= scores.max(axis=1, keepdims=True)
        probabilities = np.exp(scores)
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        for output, probabilities_row in zip(predictions, probabilities):
            best = int(probabilities_row.argmax())
            output[name] = {
                'label': head['classes'][best],
                'score': float(probabilities_row[best]),
                'probabilities': dict(zip(head['classes'], probabilities_row.tolist())),
                'scoreIsCalibrated': False,
            }
    return predictions


def build_head_result(artifact, prediction):
    # These two heads cannot attest to injury, coercion, age, or other safety
    # evidence. Missing safety coverage must not become fabricated false flags.
    return {
        'modelVersion': artifact['modelVersion'],
        'datasetVersion': artifact['datasetVersion'],
        'labelDefinitionVersion': artifact['labelDefinitionVersion'],
        'heads': prediction,
        'unassessedFields': ['graphicInjury', 'sensitiveSignals', 'possibleMinorConcern'],
        'runtimeEligible': False, 'productionEligible': False,
    }
