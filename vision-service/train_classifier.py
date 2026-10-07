"""Train both Artes heads on train only; evaluate held-out data separately."""
import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from reviewed_dataset import (HEAD_CLASSES, assess_training_data, file_sha256,
                              load_reviewed_dataset, validate_training_clearance)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def extract_features(loaded, output_dir, backbone, batch_size=1):
    import numpy as np
    from PIL import Image, ImageOps
    from dino_features import DinoFeatures
    features = DinoFeatures(**backbone)
    cache = Path(output_dir) / 'embeddings-train.jsonl'
    definition_path = Path(output_dir) / 'feature-definition.json'
    if definition_path.exists():
        if json.loads(definition_path.read_text()) != features.definition:
            raise ValueError('cached_feature_definition_mismatch')
    else:
        if cache.exists():
            raise ValueError('orphaned_embedding_cache')
        write_json(definition_path, features.definition)
    known, expected = {}, {r['candidateId']: r['sha256'] for r in loaded['rows']}
    if cache.exists():
        for line in cache.read_text().splitlines():
            entry = json.loads(line)
            cid = entry['candidateId']
            vector = np.asarray(entry['vector'], dtype=float)
            if (cid in known or expected.get(cid) != entry['sha256']
                    or vector.shape != (768,) or not np.isfinite(vector).all()
                    or not np.isclose(np.linalg.norm(vector), 1, atol=1e-4)):
                raise ValueError('invalid_or_stale_embedding_cache')
            known[cid] = vector
    remaining = [r for r in loaded['rows'] if r['candidateId'] not in known]
    cache.parent.mkdir(parents=True, exist_ok=True)
    with cache.open('a') as handle:
        for offset in range(0, len(remaining), batch_size):
            batch = remaining[offset:offset + batch_size]
            images = []
            for row in batch:
                with Image.open(row['absolutePath']) as image:
                    images.append(ImageOps.exif_transpose(image).convert('RGB'))
            values = features.embed(images)
            for image in images:
                image.close()
            for row, vector in zip(batch, values):
                entry = {'candidateId': row['candidateId'], 'sha256': row['sha256'], 'vector': vector.tolist()}
                handle.write(json.dumps(entry, allow_nan=False) + '\n')
                handle.flush()
                os.fsync(handle.fileno())
                known[row['candidateId']] = vector
            print(json.dumps({'stage': 'features', 'completed': len(known), 'total': len(loaded['rows'])}), flush=True)
    return np.stack([known[r['candidateId']] for r in loaded['rows']]), features.definition


def make_group_folds(rows, head, folds=5, seed=42):
    import numpy as np
    from sklearn.model_selection import StratifiedGroupKFold
    labels = np.asarray([r[head] for r in rows])
    groups = np.asarray([r['sourcePoolId'] for r in rows])
    required = set(HEAD_CLASSES[head])
    if set(labels) != required:
        raise ValueError(f'training_classes_missing:{head}')
    splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed)
    splits = list(splitter.split(np.zeros((len(rows), 1)), labels, groups))
    for train, validation in splits:
        if set(groups[train]) & set(groups[validation]):
            raise ValueError('cross_validation_source_leakage')
        if set(labels[train]) != required:
            raise ValueError(f'cross_validation_training_class_missing:{head}')
    return splits


def measure_labels(actual, predicted, classes):
    from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
    precision, recall, f1, support = precision_recall_fscore_support(
        actual, predicted, labels=classes, zero_division=0)
    return {
        'images': len(actual), 'accuracy': float(accuracy_score(actual, predicted)),
        'macroF1': float(f1_score(actual, predicted, labels=classes, average='macro', zero_division=0)),
        'classes': classes,
        'confusionMatrix': confusion_matrix(actual, predicted, labels=classes).tolist(),
        'perClass': {label: {'precision': float(p), 'recall': float(r), 'f1': float(f), 'support': int(n)}
                     for label, p, r, f, n in zip(classes, precision, recall, f1, support)},
    }


def train_heads(rows, vectors, folds=5, seed=42):
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import f1_score
    heads, reports, oof_outputs = {}, {}, [{} for _ in rows]
    candidates = (.1, 1., 10., 100.)
    for name in HEAD_CLASSES:
        labels = np.asarray([r[name] for r in rows])
        splits = make_group_folds(rows, name, folds, seed)
        trials, all_predictions = [], {}
        for regularization in candidates:
            probabilities = np.zeros((len(rows), len(HEAD_CLASSES[name])))
            classes = sorted(HEAD_CLASSES[name])
            for train, validation in splits:
                model = LogisticRegression(C=regularization, class_weight='balanced', max_iter=3000)
                model.fit(vectors[train], labels[train])
                if model.classes_.tolist() != classes:
                    raise ValueError('classifier_class_order_mismatch')
                probabilities[validation] = model.predict_proba(vectors[validation])
            predicted = np.asarray(classes)[probabilities.argmax(axis=1)]
            score = float(f1_score(labels, predicted, labels=classes, average='macro', zero_division=0))
            trials.append({'C': regularization, 'groupedCvMacroF1': score})
            all_predictions[regularization] = probabilities
        chosen = max(trials, key=lambda trial: trial['groupedCvMacroF1'])
        model = LogisticRegression(C=chosen['C'], class_weight='balanced', max_iter=3000)
        model.fit(vectors, labels)
        classes = model.classes_.tolist()
        best_probabilities = all_predictions[chosen['C']]
        predicted = np.asarray(classes)[best_probabilities.argmax(axis=1)]
        heads[name] = {'classes': classes, 'coefficients': model.coef_.tolist(),
                       'intercepts': model.intercept_.tolist(), 'C': chosen['C'],
                       'classWeight': 'balanced', 'scoreIsCalibrated': False}
        reports[name] = {
            'selection': chosen, 'candidates': trials, 'folds': folds,
            'diagnostic': measure_labels(labels, predicted, classes),
            'note': 'Grouped CV used to select C; this diagnostic is optimistic and is not held-out test accuracy.',
            'foldsByCandidateId': [[rows[i]['candidateId'] for i in validation] for _, validation in splits],
        }
        for output, probability in zip(oof_outputs, best_probabilities):
            output[name] = dict(zip(classes, probability.tolist()))
    return heads, reports, oof_outputs


def train(args):
    loaded = load_reviewed_dataset(args.dataset, split='train', selection_path=args.selection)
    counts = assess_training_data(loaded)
    report = {'stage': 'preflight', 'datasetSha256': loaded['datasetSha256'],
              'data': counts, 'testImagesUsedForTraining': 0,
              'sourceGroupsSeparated': loaded['heldoutGroupSeparationVerified'],
              'omittedFromTraining': loaded['omittedFromTraining'],
              'selectionSha256': loaded['selectionSha256']}
    write_json(Path(args.output) / 'preflight.json', report)
    if not args.run:
        print(json.dumps(report, indent=2))
        return
    if not args.training_clearance:
        raise ValueError('training_use_assessment_required_before_feature_extraction')
    release = validate_training_clearance(loaded, args.training_clearance, args.execution_scope)
    if not counts['experimentalNudityCountGatePassed']:
        raise ValueError('experimental_nudity_count_gate_failed')
    # Check fold feasibility BEFORE a potentially expensive backbone download.
    for head in HEAD_CLASSES:
        make_group_folds(loaded['rows'], head, args.folds, args.seed)
    vectors, definition = extract_features(
        loaded, args.output, {'model_id': args.model_id, 'revision': args.revision}, args.batch_size)
    heads, diagnostics, oof = train_heads(loaded['rows'], vectors, args.folds, args.seed)
    import sklearn
    artifact = {
        'schemaVersion': 1, 'artifactType': 'artes_supervised_linear_heads',
        'scope': 'offline_research_probe', 'createdAt': datetime.now(timezone.utc).isoformat(),
        'modelVersion': args.model_version, 'datasetVersion': loaded['datasetVersion'],
        'datasetSha256': loaded['datasetSha256'], 'labelDefinitionVersion': loaded['labelDefinitionVersion'],
        'trainingUseAssessmentSha256': file_sha256(args.training_clearance),
        'selectionSha256': loaded['selectionSha256'],
        'featureDefinition': definition, 'heads': heads,
        'trainingImages': [{'candidateId': r['candidateId'], 'sha256': r['sha256'],
                            'sourcePoolId': r['sourcePoolId']} for r in loaded['rows']],
        'testImagesUsedForTraining': 0, 'sklearnVersion': sklearn.__version__,
        'runtimeEligible': False, 'productionEligible': False,
        'unassessedFields': ['graphicInjury', 'sensitiveSignals', 'possibleMinorConcern'],
    }
    from linear_heads import validate_artifact
    validate_artifact(artifact, definition)
    write_json(Path(args.output) / 'classifier.json', artifact)
    report.update({'stage': 'trained', 'trainedImages': len(loaded['rows']), 'heads': diagnostics,
                   'modelVersion': args.model_version, 'scope': release['scope'],
                   'classifierSha256': file_sha256(Path(args.output) / 'classifier.json'),
                   'runtimeEligible': False, 'productionEligible': False})
    write_json(Path(args.output) / 'training-report.json', report)
    write_json(Path(args.output) / 'training-cv-predictions.json', [
        {'candidateId': row['candidateId'], 'label': row['detectorLabel'], 'probabilities': prediction}
        for row, prediction in zip(loaded['rows'], oof)])
    print(json.dumps({'stage': 'trained', 'images': len(loaded['rows']), 'testImagesUsed': 0,
                      'diagnosticGroupedCv': {k: v['diagnostic']['macroF1'] for k, v in diagnostics.items()},
                      'runtimeEligible': False}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--run', action='store_true', help='Run training after dataset/use validation')
    parser.add_argument('--training-clearance')
    parser.add_argument('--execution-scope', choices=('existing_workspace', 'artes_temporary_compute'), default='existing_workspace')
    parser.add_argument('--selection', help='Hash-bound omissions from training only; never move held-out images')
    parser.add_argument('--model-id', default='facebook/dinov2-base')
    parser.add_argument('--revision', default='main')
    parser.add_argument('--model-version', default='artes_linear_heads_probe_v1')
    parser.add_argument('--batch-size', type=int, default=1)
    parser.add_argument('--folds', type=int, default=5)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 16 or not 2 <= args.folds <= 10:
        parser.error('batch size must be 1..16; folds must be 2..10')
    try:
        train(args)
    except Exception as error:
        write_json(Path(args.output) / 'run-error.json', {'stage': 'failed', 'error': str(error)})
        print(f'training_failed:{error}', file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == '__main__':
    main()
