"""Local CPU training of Artes labels on frozen LukeJacob ViT image features.

Runs only in the owner's existing Codespace; no external image API, model
downloads, weights publication, or production moderation changes.
"""
import argparse, hashlib, json, math, os
from collections import Counter
from pathlib import Path
import numpy as np
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.preprocessing import StandardScaler
from evaluate_nsfw_development import load_development_rows
from compare_three_nsfw import MODELS, cache_records

MODEL_ID, REVISION, LUKE_CACHE = MODELS['luke']
SEXUAL_CLASSES = ('none', 'suggestive', 'bdsm_kink', 'explicit_act')
NUDITY_CLASSES = ('none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks',
                  'female_bare_breasts', 'genitalia', 'male_topless')
NUDE = {'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'}
TARGETS = {'sexualContext': SEXUAL_CLASSES, 'nudity': NUDITY_CLASSES,
           'explicitAct': ('no', 'yes')}
FEATURE_DIM = 768


def targets(row):
    return {'sexualContext': row['sexualContext'], 'nudity': row['nudity'],
            'explicitAct': 'yes' if row['sexualContext'] == 'explicit_act' else 'no'}


def load_features(path, rows):
    known = {r['sha256']: r for r in rows}
    found = {}
    if not path.exists():
        return found
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        sha = item.get('sha256')
        if sha not in known or sha in found or item.get('modelRevision') != REVISION:
            raise ValueError('unrecognized_or_duplicate_feature')
        values = item.get('embedding')
        if (not isinstance(values, list) or len(values) != FEATURE_DIM
                or any(type(v) not in (int, float) or not math.isfinite(v) for v in values)
                or not 0.995 < np.linalg.norm(values) < 1.005):
            raise ValueError('invalid_luke_feature')
        if item.get('sourceGroup') != known[sha]['sourceGroup']:
            raise ValueError('source_group_mismatch')
        found[sha] = np.asarray(values, dtype='float32')
    return found


def extract(rows, path, max_new=0):
    existing = load_features(path, rows)
    pending = [r for r in rows if r['sha256'] not in existing]
    if max_new:
        pending = pending[:max_new]
    if not pending:
        print('All Luke visual features already cached.', flush=True)
        return existing
    import torch
    from PIL import Image
    from transformers import AutoImageProcessor, AutoModelForImageClassification
    torch.set_num_threads(min(2, max(1, os.cpu_count() or 1)))
    print('Loading pinned Luke model from local Hugging Face cache ONLY.', flush=True)
    processor = AutoImageProcessor.from_pretrained(
        MODEL_ID, revision=REVISION, use_fast=False, trust_remote_code=False,
        local_files_only=True)
    model = AutoModelForImageClassification.from_pretrained(
        MODEL_ID, revision=REVISION, use_safetensors=True,
        trust_remote_code=False, local_files_only=True).to('cpu').eval()
    with path.open('a', encoding='utf-8') as output:
        for i, row in enumerate(pending, 1):
            with Image.open(row['resolvedPath']) as file:
                picture = file.convert('RGB')
            inputs = processor(images=picture, return_tensors='pt')
            with torch.inference_mode():
                cls = model.vit(**inputs).last_hidden_state[0, 0]
                vector = torch.nn.functional.normalize(cls, p=2, dim=0)
                values = [float(v) for v in vector.detach().cpu().tolist()]
            item = {'sha256': row['sha256'], 'sourceGroup': row['sourceGroup'],
                    'modelRevision': REVISION, 'embedding': values}
            output.write(json.dumps(item, separators=(',', ':')) + '\n')
            output.flush()
            existing[row['sha256']] = np.asarray(values, dtype='float32')
            if i % 25 == 0 or i == len(pending):
                print(f'Local feature extraction: {i}/{len(pending)}', flush=True)
    return existing


def fit(x, labels):
    classes = sorted(set(labels))
    if len(classes) < 2:
        return {'constant': classes[0]}
    scaler = StandardScaler()
    scaled = scaler.fit_transform(x)
    pca = PCA(n_components=min(32, len(x)-1, x.shape[1]),
              svd_solver='randomized', random_state=42)
    vectors = pca.fit_transform(scaled)
    clf = LogisticRegression(C=0.2, class_weight='balanced', max_iter=1000)
    clf.fit(vectors, labels)
    return {'scaler': scaler, 'pca': pca, 'model': clf}


def predict(fitted, x):
    if 'constant' in fitted:
        return [fitted['constant']] * len(x)
    vec = fitted['pca'].transform(fitted['scaler'].transform(x))
    return fitted['model'].predict(vec).tolist()


def evaluate(rows, embeddings, baseline):
    groups = np.asarray([row['sourceGroup'] for row in rows])
    x = np.stack([embeddings[row['sha256']] for row in rows])
    truths = {axis: [targets(r)[axis] for r in rows] for axis in TARGETS}
    preds = {axis: [None] * len(rows) for axis in TARGETS}
    splits = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=42).split(
        x, truths['explicitAct'], groups)
    for train, valid in splits:
        if set(groups[train]) & set(groups[valid]):
            raise ValueError('source_group_leakage')
        for axis in TARGETS:
            fitted = fit(x[train], [truths[axis][i] for i in train])
            for i, label in zip(valid, predict(fitted, x[valid])):
                preds[axis][int(i)] = label
    if any(None in labels for labels in preds.values()):
        raise ValueError('incomplete_out_of_fold_evaluation')
    def metrics(axis):
        labels = TARGETS[axis]
        details = classification_report(truths[axis], preds[axis],
            labels=list(labels), zero_division=0, output_dict=True)
        return {'accuracy': round(float(details['accuracy']), 4),
                'macroF1': round(float(details['macro avg']['f1-score']), 4),
                'classMetrics': {name: {key: round(float(details[name][key]), 4)
                     for key in ('support', 'precision', 'recall', 'f1-score')}
                     for name in labels},
                'confusionOrder': list(labels),
                'confusion': confusion_matrix(truths[axis], preds[axis],
                                              labels=list(labels)).tolist()}
    def count(pred_flags):
        neg = [i for i, r in enumerate(rows) if r['sexualContext'] != 'explicit_act']
        pos = [i for i, r in enumerate(rows) if r['sexualContext'] == 'explicit_act']
        nude = [i for i in neg if rows[i]['nudity'] in NUDE]
        return {'explicitDetected': sum(pred_flags[i] for i in pos),
                'explicitTotal': len(pos),
                'nonExplicitFlagged': sum(pred_flags[i] for i in neg),
                'nonExplicitTotal': len(neg),
                'nonExplicitNudeFlagged': sum(pred_flags[i] for i in nude),
                'nonExplicitNudeTotal': len(nude)}
    luke_raw = [baseline[r['sha256']]['scores']['porn'] >= 0.233821630
                for r in rows]
    fitted = [label == 'yes' for label in preds['explicitAct']]
    return {'status': 'development_only_not_independent_no_release_authority',
            'sourceGroups': len(set(groups)), 'images': len(rows),
            'modelId': MODEL_ID, 'modelRevision': REVISION,
            'method': 'frozen_ViT_CLS_768_fold_only_scaler_PCA32_L2_logistic',
            'classSupport': {axis: dict(Counter(truths[axis])) for axis in TARGETS},
            'axes': {axis: metrics(axis) for axis in TARGETS},
            'explicitActScreening': {
                'lukeArtesOOF': count(fitted),
                'rawPornThresholdFittedOnSameData': count(luke_raw)},
            'notes': [
                'Out-of-fold source group splits prevent within-fold source reuse.',
                'Images have appeared in earlier research: this is not a truly untouched holdout.',
                'Porn probability is not an explicit sexual act; neither output is a policy verdict.',
                'Low-support categories require more authorized human-labeled examples.',
                'No automatic publication, blocking or deployment is authorized.']}


def json_head(fitted):
    if 'constant' in fitted:
        return {'constant': fitted['constant']}
    model, scaler, pca = fitted['model'], fitted['scaler'], fitted['pca']
    return {'classes': [str(c) for c in model.classes_],
            'scalerMean': scaler.mean_.tolist(), 'scalerScale': scaler.scale_.tolist(),
            'pcaMean': pca.mean_.tolist(), 'pcaComponents': pca.components_.tolist(),
            'coefficients': model.coef_.tolist(), 'intercepts': model.intercept_.tolist()}


def main():
    parser = argparse.ArgumentParser(description='Local CPU Artes-specific Luke features')
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--work', required=True)
    parser.add_argument('--max-new', type=int, default=0,
                        help='Limit newly extracted features; 0=all remaining')
    args = parser.parse_args()
    if args.max_new < 0:
        parser.error('--max-new_must_be_nonnegative')
    rows = load_development_rows(args.dataset)
    if len(rows) != 375:
        raise ValueError('expected_exactly_375_existing_development_images')
    for row in rows:
        if row['sexualContext'] not in SEXUAL_CLASSES or row['nudity'] not in NUDITY_CLASSES:
            raise ValueError('unsupported_artes_human_label')
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    baseline = cache_records(work / LUKE_CACHE, rows, 'luke')
    if len(baseline) != len(rows):
        raise ValueError('luke_existing_375_predictions_required')
    embeddings = extract(rows, work / 'luke-artes-private-embeddings.jsonl', args.max_new)
    if len(embeddings) != len(rows):
        print(f'Feature cache incomplete ({len(embeddings)}/{len(rows)}); rerun to resume.')
        return
    result = evaluate(rows, embeddings, baseline)
    (work / 'luke-artes-trained-aggregate.json').write_text(
        json.dumps(result, indent=2) + '\n', encoding='utf-8')
    x = np.stack([embeddings[r['sha256']] for r in rows])
    fitted = {axis: json_head(fit(x, [targets(r)[axis] for r in rows]))
              for axis in TARGETS}
    artifact = {'status': 'experimental_model_not_approved', 'schemaVersion': 1,
                'modelId': MODEL_ID, 'modelRevision': REVISION, 'embeddingDim': 768,
                'heads': fitted, 'classes': {a: list(v) for a,v in TARGETS.items()},
                'trainingCount': len(rows), 'sourceGroups': len(set(r['sourceGroup'] for r in rows)),
                'datasetFingerprint': hashlib.sha256(''.join(
                    sorted(r['sha256'] for r in rows)).encode()).hexdigest(),
                'automatedModerationAllowed': False}
    (work / 'luke-artes-heads-private.json').write_text(
        json.dumps(artifact, separators=(',', ':')) + '\n', encoding='utf-8')
    print('UPLOAD ONLY AGGREGATE:', work / 'luke-artes-trained-aggregate.json')
    print('Private research heads stored locally. No app or policy changed.')


if __name__ == '__main__':
    main()
