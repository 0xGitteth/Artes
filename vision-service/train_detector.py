"""Train, calibrate and independently benchmark JSON heads on approved media.

No service credentials, cloud training calls or automatic release approval.
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

from detector import HEADS, SIGNALS, LABEL_VERSION, infer_detector, validate_artifact, finite

POLICY_VERSION = 'artes_detector_policy_v1'
CLASSES = ['general', 'adult_nudity', 'erotic', 'explicit']


def class_key(label):
    if label['sexualContext'] == 'explicit_act':
        return 'explicit'
    if label['graphicInjury'] != 'none' or label['sensitiveSignals']:
        return 'sensitive'
    if label['nudity'] in ['implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia']:
        return 'adult_nudity'
    return 'erotic' if label['sexualContext'] in ['suggestive', 'bdsm_kink'] else 'general'


def evidence_key(label):
    return tuple(label[k] for k in ['nudity', 'sexualContext', 'graphicInjury', 'possibleMinorConcern']) + (tuple(sorted(label['sensitiveSignals'])),)


def eligible_prediction(label):
    return not label['possibleMinorConcern'] and not label['uncertaintyFlags'] and not label['sensitiveSignals'] and label['graphicInjury'] == 'none'


def validate_dataset(dataset):
    if dataset.get('schemaVersion') != 1 or dataset.get('labelVersion') != LABEL_VERSION or not dataset.get('datasetVersion'):
        raise ValueError('invalid_training_dataset_version')
    embedding = dataset.get('embedding', {})
    if embedding.get('modelId') != 'facebook/dinov2-base' or embedding.get('dimension') != 768 or not re.fullmatch(r'[a-f0-9]{40}', embedding.get('revision', '')):
        raise ValueError('pinned_dinov2_embedding_required')
    seen_ids, relations, counts = set(), {}, {k: 0 for k in ['train', 'validation', 'test']}
    for item in dataset.get('items', []):
        item_id, split = item.get('sourceExampleId'), item.get('datasetSplit')
        if not isinstance(item_id, str) or not item_id or item_id in seen_ids or split not in counts:
            raise ValueError('invalid_or_duplicate_training_item')
        seen_ids.add(item_id)
        if item.get('trainingReady') is not True or item.get('candidate') is not True or item.get('curationStatus') != 'approved' or item.get('benchmarkOnly') is True or item.get('researchOnly') is True or item.get('datasetSplitFinal') is not True:
            raise ValueError('unapproved_training_item:' + item_id)
        asset, semantic = item.get('trainingAsset') or {}, item.get('semanticEmbedding') or {}
        if asset.get('approvedForTraining') is not True or not asset.get('uri') or asset.get('revoked') or asset.get('deleted') or asset.get('revokedAt') or asset.get('deletedAt'):
            raise ValueError('unapproved_or_revoked_training_asset:' + item_id)
        if semantic.get('semanticClusterApproved') is not True:
            raise ValueError('unapproved_semantic_cluster:' + item_id)
        keys = ['leakageGroupId', 'sourcePoolId', 'sourceFingerprintSha256']
        if not re.fullmatch(r'[a-f0-9]{64}', item.get('sourceFingerprintSha256', '')):
            raise ValueError('invalid_training_image_hash')
        for key in keys:
            value = item.get(key)
            if not isinstance(value, str) or not value:
                raise ValueError('missing_leakage_relation:' + key)
            relation = (key, value)
            if relation in relations and relations[relation] != split:
                raise ValueError('dataset_split_leakage:' + key)
            relations[relation] = split
        cluster = semantic.get('semanticClusterId')
        if not isinstance(cluster, str) or not cluster:
            raise ValueError('missing_semantic_cluster')
        relation = ('semanticClusterId', cluster)
        if relation in relations and relations[relation] != split:
            raise ValueError('dataset_split_leakage:semanticClusterId')
        relations[relation] = split
        label = item.get('detectorLabel') or {}
        for name, vocabulary in HEADS.items():
            if name.startswith('sensitive:'):
                continue
            value = label.get(name)
            if type(value) is not type(vocabulary[0]) or value not in vocabulary:
                raise ValueError('invalid_training_label:' + name)
        if not isinstance(label.get('sensitiveSignals'), list) or any(v not in SIGNALS for v in label['sensitiveSignals']):
            raise ValueError('invalid_training_sensitive_signals')
        if label.get('uncertaintyFlags') != [] or not finite(label.get('confidence')) or not 0 <= label['confidence'] <= 1:
            raise ValueError('unresolved_training_label')
        vector = item.get('embeddingVector')
        if vector is not None and (len(vector) != 768 or any(not finite(v) for v in vector) or abs(sum(v*v for v in vector)-1) > 1e-3):
            raise ValueError('invalid_training_embedding')
        if vector is None and not item.get('imagePath'):
            raise ValueError('missing_training_image_or_embedding')
        counts[split] += 1
    if not all(counts.values()):
        raise ValueError('independent_train_validation_test_required')
    return counts


def head_value(label, name):
    return name.split(':', 1)[1] in label['sensitiveSignals'] if name.startswith('sensitive:') else label[name]


def fit_heads(items):
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    vectors = np.array([item['embeddingVector'] for item in items])
    heads = {}
    for name, vocabulary in HEADS.items():
        targets = [vocabulary.index(head_value(item['detectorLabel'], name)) for item in items]
        classes = sorted(set(targets))
        if len(classes) == 1:
            weights, bias = [[0.0]*768], [0.0]
        else:
            estimator = LogisticRegression(C=1.0, max_iter=1000, solver='lbfgs').fit(vectors, targets)
            classes = estimator.classes_.tolist()
            if len(classes) == 2:
                weights = [(-estimator.coef_[0]/2).tolist(), (estimator.coef_[0]/2).tolist()]
                bias = [-float(estimator.intercept_[0])/2, float(estimator.intercept_[0])/2]
            else:
                weights, bias = estimator.coef_.tolist(), estimator.intercept_.tolist()
        heads[name] = {'classes': [vocabulary[i] for i in classes], 'weights': weights, 'bias': bias}
    return heads


def calibrate_temperature(heads, items):
    # Validation chooses score scaling; the untouched test split measures decisions.
    def loss(temperature):
        total = 0.0
        for item in items:
            for name, head in heads.items():
                value = head_value(item['detectorLabel'], name)
                if value not in head['classes']:
                    total += 30
                    continue
                logits = [(sum(w*x for w,x in zip(row, item['embeddingVector'])) + b)/temperature for row,b in zip(head['weights'], head['bias'])]
                maximum = max(logits)
                total += math.log(sum(math.exp(v-maximum) for v in logits)) + maximum - logits[head['classes'].index(value)]
        return total
    return min([0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0], key=loss)


def wilson_lower(successes, count):
    if not count:
        return 0.0
    z = 1.959963984540054
    p = successes/count
    return (p + z*z/(2*count) - z*math.sqrt(p*(1-p)/count + z*z/(4*count*count))) / (1 + z*z/count)


def metrics(rows):
    groups = {}
    critical = 0
    for item, label in rows:
        correct = evidence_key(item['detectorLabel']) == evidence_key(label)
        group = item['leakageGroupId']
        groups[group] = groups.get(group, True) and correct
        truth = item['detectorLabel']
        if (class_key(label) != 'explicit' and (class_key(truth) == 'explicit' or truth['possibleMinorConcern'] or truth['graphicInjury'] != 'none' or truth['sensitiveSignals'])) or (class_key(label) == 'explicit' and class_key(truth) != 'explicit'):
            critical += 1
    correct_examples = sum(evidence_key(i['detectorLabel']) == evidence_key(p) for i,p in rows)
    return {'heldOutExamples': len(rows), 'heldOutGroups': len(groups), 'correctExamples': correct_examples, 'failedGroups': sum(not v for v in groups.values()), 'criticalMisses': critical, 'precision': correct_examples/len(rows) if rows else 0, 'precisionLowerBound': wilson_lower(sum(groups.values()), len(groups))}


def evaluate(artifact, items, thresholds):
    predictions = [(item, infer_detector(artifact, item['embeddingVector'])['detectorLabel']) for item in items]
    classes = {}
    total_auto = 0
    confusion = {}
    for item,label in predictions:
        key = class_key(item['detectorLabel']) + '->' + class_key(label)
        confusion[key] = confusion.get(key, 0) + 1
    for key in CLASSES:
        calibrated = thresholds[key]['calibrated']
        minimum = thresholds[key]['minConfidence']
        rows = [(i,p) for i,p in predictions if calibrated and class_key(p) == key and eligible_prediction(p) and p['confidence'] >= minimum]
        value = metrics(rows)
        value.update(minConfidence=minimum, calibrated=calibrated)
        value['validated'] = calibrated and value['heldOutGroups'] >= 20 and value['heldOutExamples'] >= 100 and value['criticalMisses'] == 0 and value['precisionLowerBound'] >= 0.99
        classes[key] = value
        total_auto += len(rows)
    return {'count': len(items), 'automaticDecisionCount': total_auto, 'reviewCount': len(items)-total_auto, 'reviewRate': 1-total_auto/len(items) if items else 1, 'classes': classes, 'classConfusion': confusion}


def train(dataset):
    import numpy as np
    counts = validate_dataset(dataset)
    if any(item.get('embeddingVector') is None for item in dataset['items']):
        raise ValueError('embeddings_must_be_extracted_before_training')
    by_split = {split: [i for i in dataset['items'] if i['datasetSplit'] == split] for split in counts}
    heads = fit_heads(by_split['train'])
    temperature = calibrate_temperature(heads, by_split['validation'])
    for head in heads.values():
        head['weights'] = [[v/temperature for v in row] for row in head['weights']]
        head['bias'] = [v/temperature for v in head['bias']]
    references = [item['embeddingVector'] for item in by_split['train']]
    similarities = [max(float(np.dot(item['embeddingVector'], row)) for row in references) for item in by_split['validation']]
    embedding = dataset['embedding']
    artifact = {'schemaVersion': 1, 'labelVersion': LABEL_VERSION, 'embeddingModelId': embedding['modelId'], 'embeddingRevision': embedding['revision'], 'embeddingDimension': 768, 'datasetVersion': dataset['datasetVersion'], 'datasetDigest': hashlib.sha256(json.dumps(dataset, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), 'heads': heads, 'calibration': {'temperature': temperature, 'split': 'validation'}, 'support': {'vectors': references, 'minCosine': min(1.0, max(-1.0, float(np.quantile(similarities, 0.05))))}}
    artifact['modelVersion'] = 'linear_heads_v1:' + hashlib.sha256(json.dumps(artifact, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    validate_artifact(artifact, embedding['modelId'], embedding['revision'])
    predictions = [(item, infer_detector(artifact, item['embeddingVector'])['detectorLabel']) for item in by_split['validation']]
    thresholds = {}
    for key in CLASSES:
        candidates = sorted({0.9, 0.95, 0.97, 0.99, *[p['confidence'] for _,p in predictions if p['confidence'] >= 0.9]})
        accepted = []
        for minimum in candidates:
            rows = [(i,p) for i,p in predictions if class_key(p) == key and eligible_prediction(p) and p['confidence'] >= minimum]
            value = metrics(rows)
            if value['heldOutGroups'] >= 20 and value['precision'] >= 0.99 and value['criticalMisses'] == 0:
                accepted.append((len(rows), -minimum, minimum))
        thresholds[key] = {'calibrated': bool(accepted), 'minConfidence': max(accepted)[2] if accepted else 1.0}
    benchmark = evaluate(artifact, by_split['test'], thresholds)
    coverage = {name: {'seen': head['classes'], 'missing': [v for v in HEADS[name] if v not in head['classes']]} for name,head in heads.items()}
    report = {'datasetVersion': dataset['datasetVersion'], 'modelVersion': artifact['modelVersion'], 'splitCounts': counts, 'headCoverage': coverage, 'validation': evaluate(artifact, by_split['validation'], thresholds), 'independentTest': benchmark, 'productionApproved': False}
    release = {'approved': False, 'policyVersion': POLICY_VERSION, 'labelVersion': LABEL_VERSION, 'modelVersion': artifact['modelVersion'], 'datasetVersion': artifact['datasetVersion'], 'classes': benchmark['classes']}
    return artifact, report, release


def extract_embeddings(dataset, dataset_dir):
    # Image requests cannot choose URLs or silently collect fresh media.
    if all(item.get('embeddingVector') is not None for item in dataset['items']):
        return
    import os
    os.environ['ARTES_DINOV2_MODEL_ID'] = dataset['embedding']['modelId']
    os.environ['ARTES_DINOV2_REVISION'] = dataset['embedding']['revision']
    from app import embed_image
    from PIL import Image
    for item in dataset['items']:
        if item.get('embeddingVector') is not None:
            continue
        path = (dataset_dir / item['imagePath']).resolve()
        if not path.is_relative_to(dataset_dir.resolve()):
            raise ValueError('training_image_outside_dataset_directory')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item['sourceFingerprintSha256']:
            raise ValueError('training_image_hash_mismatch')
        with Image.open(path) as image:
            item['embeddingVector'] = embed_image(image.convert('RGB'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    dataset = json.loads(args.dataset.read_text())
    validate_dataset(dataset)
    extract_embeddings(dataset, args.dataset.parent)
    artifact, report, release = train(dataset)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, value in [('detector.json', artifact), ('benchmark.json', report), ('release-candidate.json', release)]:
        (args.output_dir / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'modelVersion': artifact['modelVersion'], 'independentTest': report['independentTest'], 'productionApproved': False}))


if __name__ == '__main__':
    main()
