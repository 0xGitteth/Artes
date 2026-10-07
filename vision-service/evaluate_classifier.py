"""Measure a frozen classifier on held-out images after model selection."""
import argparse
import json
from pathlib import Path

from reviewed_dataset import HEAD_CLASSES, file_sha256, load_reviewed_dataset, validate_training_clearance
from train_classifier import measure_labels, write_json


def evaluate(args):
    if not args.final_test:
        raise ValueError('final_test_acknowledgment_required')
    from dino_features import DinoFeatures
    from linear_heads import load_artifact, predict_heads, validate_artifact
    from PIL import Image, ImageOps
    artifact = load_artifact(args.artifact)
    loaded = load_reviewed_dataset(args.dataset, split='test', selection_path=args.selection)
    validate_training_clearance(loaded, args.evaluation_clearance, args.execution_scope, purpose='evaluation')
    artifact_sha = file_sha256(args.artifact)
    if artifact['datasetSha256'] != loaded['datasetSha256'] or artifact.get('selectionSha256') != loaded['selectionSha256']:
        raise ValueError('artifact_dataset_or_selection_mismatch')
    training_ids = {r['candidateId'] for r in artifact['trainingImages']}
    training_hashes = {r['sha256'] for r in artifact['trainingImages']}
    training_pools = {r['sourcePoolId'] for r in artifact['trainingImages']}
    if any(r['candidateId'] in training_ids or r['sha256'] in training_hashes
           or r['sourcePoolId'] in training_pools for r in loaded['rows']):
        raise ValueError('classifier_training_overlaps_test')
    output = Path(args.output)
    lock_path = output / 'test-lock.json'
    identity = {'artifactSha256': artifact_sha, 'datasetSha256': loaded['datasetSha256'],
                'selectionSha256': loaded['selectionSha256'], 'split': 'test'}
    if lock_path.exists() and json.loads(lock_path.read_text()) != identity:
        raise ValueError('test_already_used_for_another_model')
    write_json(lock_path, identity)
    checkpoint = output / 'test-predictions.json'
    known = {}
    if checkpoint.exists():
        for item in json.loads(checkpoint.read_text()):
            if item['candidateId'] in known:
                raise ValueError('duplicate_test_prediction')
            known[item['candidateId']] = item
        if not set(known).issubset({r['candidateId'] for r in loaded['rows']}):
            raise ValueError('invalid_test_prediction_checkpoint')
    definition = artifact['featureDefinition']
    features = DinoFeatures(definition['modelId'], definition['revision'])
    validate_artifact(artifact, features.definition)
    for row in loaded['rows']:
        if row['candidateId'] in known:
            if known[row['candidateId']]['sha256'] != row['sha256']:
                raise ValueError('test_prediction_hash_mismatch')
            continue
        with Image.open(row['absolutePath']) as image:
            pixels = ImageOps.exif_transpose(image).convert('RGB')
        vector = features.embed([pixels])
        pixels.close()
        prediction = predict_heads(artifact, vector)[0]
        known[row['candidateId']] = {'candidateId': row['candidateId'], 'sha256': row['sha256'],
                                     'expected': row['detectorLabel'], 'predicted': prediction}
        write_json(checkpoint, list(known.values()))
        print(json.dumps({'stage': 'test', 'completed': len(known), 'total': len(loaded['rows'])}), flush=True)
    measured = {}
    for head, classes in HEAD_CLASSES.items():
        actual = [r[head] for r in loaded['rows']]
        predicted = [known[r['candidateId']]['predicted'][head]['label'] for r in loaded['rows']]
        measured[head] = measure_labels(actual, predicted, list(classes))
    missing = {head: [c for c in classes if measured[head]['perClass'][c]['support'] == 0]
               for head, classes in HEAD_CLASSES.items()}
    report = dict(identity, modelVersion=artifact['modelVersion'], heldoutImages=len(loaded['rows']),
                  heads=measured, untestedClasses=missing,
                  explicitActDetectionValidated=False,
                  runtimeEligible=False, productionEligible=False,
                  note='This frozen pilot test measures two content heads. It does not validate full moderation, safety coverage or automatic routing thresholds.')
    write_json(output / 'test-report.json', report)
    print(json.dumps({'stage': 'tested', 'images': len(loaded['rows']),
                      'accuracy': {k: v['accuracy'] for k, v in measured.items()},
                      'untestedClasses': missing, 'runtimeEligible': False}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--selection')
    parser.add_argument('--evaluation-clearance', required=True)
    parser.add_argument('--execution-scope', choices=('existing_workspace', 'artes_temporary_compute'), default='existing_workspace')
    parser.add_argument('--final-test', action='store_true')
    evaluate(parser.parse_args())


if __name__ == '__main__':
    main()
