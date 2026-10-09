"""Compare Artes-trained context heads on cached LukeJacob and RedDesert scores.

All 375 existing images were scored previously. No image inference, external API,
new models, extra installations, deployment or production changes.

Caution: group-disjoint *development* cross-validation, NOT independent test.
"""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.preprocessing import StandardScaler

from compare_three_nsfw import MODELS, cache_records
from evaluate_reddesert_artes import CLASSES as RED_LABELS, read_cache as read_red_cache
from evaluate_nsfw_development import load_development_rows
from nsfw_shadow import MODEL_LABELS as LUKE_LABELS

# These are classifications on different semantic axes, NOT policy verdicts.
CONTEXT_TARGETS = {
    'explicit_act': lambda row: row['sexualContext'] == 'explicit_act',
    'bdsm_kink': lambda row: row['sexualContext'] == 'bdsm_kink',
    'suggestive': lambda row: row['sexualContext'] == 'suggestive',
}
FEATURE_SETS = {
    'luke_scores': tuple(range(len(LUKE_LABELS))),
    'red_desert_scores': tuple(range(len(LUKE_LABELS), len(LUKE_LABELS) + len(RED_LABELS))),
    'combined_scores': tuple(range(len(LUKE_LABELS) + len(RED_LABELS))),
}
THRESHOLDS = (.10, .25, .50, .75)
NUDE = frozenset(('implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'))


def assemble(rows, luke_cache, red_cache):
    if len(luke_cache) != len(rows) or len(red_cache) != len(rows):
        raise ValueError('full_375_photo_pairing_required')
    values = []
    for row in rows:
        sha = row['sha256']
        luke = luke_cache[sha]['scores']
        red = red_cache[sha]
        values.append(
            [float(luke[label]) for label in LUKE_LABELS]
            + [float(red[label]) for label in RED_LABELS])
    x = np.asarray(values, dtype='float64')
    if x.shape != (len(rows), len(LUKE_LABELS) + len(RED_LABELS)):
        raise ValueError('wrong_paired_feature_dimensions')
    if not np.isfinite(x).all() or (x < 0).any() or (x > 1).any():
        raise ValueError('invalid_cached_score_features')
    return x


def make_model(x, labels):
    if len(set(int(v) for v in labels)) < 2:
        # Rare class absent from a training fold. Do not invent a trained classifier.
        return {'constant': float(labels[0])}
    scale = StandardScaler()
    xx = scale.fit_transform(x)
    clf = LogisticRegression(
        C=0.25, class_weight='balanced', max_iter=1000, solver='lbfgs',
        random_state=42)
    clf.fit(xx, labels)
    return {'scaler': scale, 'classifier': clf}


def model_scores(fitted, x):
    if 'constant' in fitted:
        return np.full(len(x), fitted['constant'], dtype='float64')
    transformed = fitted['scaler'].transform(x)
    classes = list(fitted['classifier'].classes_)
    return fitted['classifier'].predict_proba(transformed)[:, classes.index(1)]


def validate_split(train, heldout, groups):
    if set(groups[train]) & set(groups[heldout]):
        raise ValueError('source_group_leakage')
    if not len(train) or not len(heldout):
        raise ValueError('empty_group_validation_fold')


def summarize_score(labels, scores, rows, *, explicit_axis=False):
    y = np.asarray(labels, dtype=bool)
    p = np.asarray(scores, dtype='float64')
    if len(y) != len(p) or len(y) != len(rows) or not np.isfinite(p).all():
        raise ValueError('invalid_score_summary')
    ranking = {
        'auc': round(float(roc_auc_score(y, p)), 4) if len(set(y)) > 1 else None,
        'averagePrecision': round(float(average_precision_score(y, p)), 4)
        if y.any() else None,
        'positiveCount': int(y.sum()),
        'negativeCount': int((~y).sum()),
    }
    for threshold in THRESHOLDS:
        predicted = p >= threshold
        entry = {
            'detectedPositives': int((y & predicted).sum()),
            'missedPositives': int((y & ~predicted).sum()),
            'incorrectlyFlaggedNegatives': int((~y & predicted).sum()),
            'correctlyPassedNegatives': int((~y & ~predicted).sum()),
        }
        if explicit_axis:
            entry['incorrectlyFlaggedAllowedNudes'] = sum(
                bool((not y[i]) and predicted[i] and rows[i]['nudity'] in NUDE)
                for i in range(len(rows)))
        ranking['threshold_' + str(threshold)] = entry
    return ranking


def json_model(fitted):
    if 'constant' in fitted:
        return {'constant': fitted['constant']}
    scale, clf = fitted['scaler'], fitted['classifier']
    return {
        'mean': scale.mean_.tolist(),
        'scale': scale.scale_.tolist(),
        'coefficients': clf.coef_[0].tolist(),
        'intercept': float(clf.intercept_[0]),
        'decisionClasses': [int(c) for c in clf.classes_],
    }


def study(rows, scores):
    groups = np.asarray([row['sourceGroup'] for row in rows])
    target_labels = {
        name: np.asarray([int(test(row)) for row in rows], dtype=int)
        for name, test in CONTEXT_TARGETS.items()
    }
    if len(set(groups)) < 4:
        raise ValueError('too_few_independent_sources')
    if min(Counter(target_labels['explicit_act']).values()) < 4:
        raise ValueError('too_few_explicit_act_labels')
    out_of_fold = {
        model: {target: np.full(len(rows), np.nan) for target in CONTEXT_TARGETS}
        for model in FEATURE_SETS
    }
    details = []
    splitter = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=42)
    for fold, (train, valid) in enumerate(
            splitter.split(scores, target_labels['explicit_act'], groups), 1):
        validate_split(train, valid, groups)
        details.append({
            'fold': fold,
            'trainSourceGroups': len(set(groups[train])),
            'heldoutSourceGroups': len(set(groups[valid])),
            'heldoutImageCount': int(len(valid)),
            'heldoutExplicitCount': int(target_labels['explicit_act'][valid].sum()),
            'heldoutBdsmCount': int(target_labels['bdsm_kink'][valid].sum()),
        })
        for model_name, indices in FEATURE_SETS.items():
            feature_set = scores[:, list(indices)]
            for target_name, y in target_labels.items():
                fitted = make_model(feature_set[train], y[train])
                out_of_fold[model_name][target_name][valid] = model_scores(
                    fitted, feature_set[valid])
    if any(not np.isfinite(pred).all()
           for by_target in out_of_fold.values() for pred in by_target.values()):
        raise ValueError('missing_out_of_fold_predictions')

    report = {
        'status': 'supervised_development_comparison_not_release_validation',
        'images': len(rows),
        'sourceGroups': len(set(groups)),
        'humanLabels': {name: int(y.sum()) for name, y in target_labels.items()},
        'featureColumns': {
            'luke': list(LUKE_LABELS),
            'redDesert': list(RED_LABELS),
        },
        'method': 'source_group_disjoint_stratified_4fold_standard_scaler_balanced_logistic_C0.25',
        'folds': details,
        'models': {},
        'notes': [
            'Every heldout photo was scored by a classifier trained on other source groups.',
            'The underlying pretrained models may have unknown training-set overlap.',
            'The 375 research-used images are not an independent final holdout.',
            'These results are model ranking/review-workload proxies, not full Artes policy outcomes.',
            'Artes explicit/suggestive/BDSM human labels are independent targets; never assume RedDesert x/q mean explicit.',
            'Any threshold comparison is descriptive, not automatically calibrated or deployed.',
            'A missed confirmed explicit act is safety critical; never release from these results alone.',
            'No automated posting, blocking or Gemini retirement authorized.',
        ],
    }
    for name, predictions in out_of_fold.items():
        report['models'][name] = {
            target: summarize_score(target_labels[target], predictions[target], rows,
                                    explicit_axis=(target == 'explicit_act'))
            for target in CONTEXT_TARGETS
        }

    # The old Luke porn threshold was adjusted on this SAME development dataset:
    # retain it as a biased screening reference, not a fair supervised OOF model.
    raw = scores[:, list(FEATURE_SETS['luke_scores'])][:, list(LUKE_LABELS).index('porn')]
    report['legacyRawLukeDevelopmentOnly'] = {
        'pornScoreThreshold': 0.233821630,
        'explicitAct': summarize_score(
            target_labels['explicit_act'], raw, rows, explicit_axis=True),
    }
    historical = raw >= 0.233821630
    y = target_labels['explicit_act'].astype(bool)
    report['legacyRawLukeDevelopmentOnly']['originalCutoffCounts'] = {
        'explicitDetected': int((historical & y).sum()),
        'explicitMissed': int((~historical & y).sum()),
        'nonExplicitFlagged': int((historical & ~y).sum()),
        'allowedNudesFlagged': sum(
            bool(historical[i] and not y[i] and rows[i]['nudity'] in NUDE)
            for i in range(len(rows)))
    }
    # Final research heads fitted to ALL development images and kept private
    # only after heldout-fold scores have been produced.
    private_heads = {}
    for name, indices in FEATURE_SETS.items():
        private_heads[name] = {
            target: json_model(make_model(scores[:, list(indices)], y))
            for target, y in target_labels.items()
        }
    private_artifact = {
        'status': 'research_only_private_not_approved_for_moderation',
        'schemaVersion': 1,
        'sampleCount': len(rows),
        'sourceGroups': len(set(groups)),
        'datasetSha256Fingerprint': hashlib.sha256(''.join(
            sorted(row['sha256'] for row in rows)).encode()).hexdigest(),
        'models': private_heads,
        'automatedModerationAllowed': False,
    }
    return report, private_artifact


def main():
    parser = argparse.ArgumentParser(description='Offline contextual model fusion research')
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--work', required=True)
    args = parser.parse_args()
    work = Path(args.work)
    if not work.is_dir():
        raise ValueError('existing_private_codespace_work_dir_required')
    rows = load_development_rows(args.dataset)
    if len(rows) != 375:
        raise ValueError('expected_375_existing_development_examples')
    luke = cache_records(work / MODELS['luke'][2], rows, 'luke')
    red = read_red_cache(work / 'reddesert-private-scores.jsonl', rows)
    x = assemble(rows, luke, red)
    report, private = study(rows, x)
    out = work / 'luke-reddesert-fusion-aggregate.json'
    out.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    secret = work / 'luke-reddesert-fusion-private-heads.json'
    secret.write_text(json.dumps(private, separators=(',', ':')) + '\n', encoding='utf-8')
    print('Paired model scores: 375/375; ZERO new image inference or model downloads.')
    print('Public summary to share:', out)
    print('Private research weights stay locally in the ignored .tmp folder.')
    print('No changes to Artes moderation runtime or live user uploads.')


if __name__ == '__main__':
    main()
