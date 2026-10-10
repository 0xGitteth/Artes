"""Evaluate raw NSFW scores against Artes' existing human labels.

Development-only diagnostics, NOT independent holdout accuracy. All images stay
inside Codespaces. Only aggregate results should be shared in chat; raw
per-image predictions are private and remain untracked in .tmp.
"""
import argparse
import json
import math
import os
import statistics
from collections import Counter
from pathlib import Path

from PIL import Image
from nsfw_shadow import MODEL_LABELS, classify_nsfw, validate_revision

LABELS = ('none', 'suggestive', 'bdsm_kink', 'explicit_act')
NUDE = {'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'}
SIGNAL_NAMES = {
    'normal': 'nsfw_normal_category', 'porn': 'nsfw_porn_category',
    'hentai': 'nsfw_hentai_category', 'drawing': 'nsfw_drawing_category',
    'sexy': 'nsfw_sexy_category',
}


def load_development_rows(dataset_dir):
    root = Path(dataset_dir).resolve()
    rows = []
    groups = {}
    for split in ('train', 'validation'):
        filepath = root / f'{split}.json'
        payload = json.loads(filepath.read_text(encoding='utf-8'))
        if not isinstance(payload, list):
            raise ValueError('invalid_development_manifest')
        for row in payload:
            if not isinstance(row, dict) or row.get('sexualContext') not in LABELS:
                raise ValueError('invalid_human_label')
            if not isinstance(row.get('sha256'), str) or len(row['sha256']) != 64:
                raise ValueError('missing_image_fingerprint')
            if not isinstance(row.get('sourceGroup'), str) or not row['sourceGroup']:
                raise ValueError('missing_source_group')
            relative = row.get('imagePath')
            if not isinstance(relative, str):
                raise ValueError('missing_image_path')
            path = (root / relative).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                raise ValueError('image_path_missing_or_outside_dataset')
            if path.parent != (root / split / 'images').resolve():
                raise ValueError('invalid_development_split_path')
            prior_split = groups.setdefault(row['sourceGroup'], split)
            if prior_split != split:
                raise ValueError('source_group_crosses_dev_splits')
            rows.append({**row, 'split': split, 'resolvedPath': path})
    shas = [row['sha256'] for row in rows]
    if len(shas) != len(set(shas)):
        raise ValueError('duplicate_development_fingerprint')
    return rows


def parse_score_record(record, revision):
    if not isinstance(record, dict) or record.get('modelRevision') != revision:
        raise ValueError('invalid_score_cache_revision')
    scores = record.get('scores')
    if not isinstance(scores, dict) or set(scores) != set(MODEL_LABELS):
        raise ValueError('invalid_score_cache_labels')
    if any(not isinstance(value, (float, int)) or not math.isfinite(value)
           or value < 0 or value > 1 for value in scores.values()):
        raise ValueError('invalid_score_cache_probabilities')
    if abs(sum(scores.values()) - 1) > 0.005:
        raise ValueError('invalid_score_cache_sum')
    return scores


def load_existing_predictions(filepath, revision, rows):
    if not filepath.exists():
        return {}
    indexed_rows = {row['sha256']: row for row in rows}
    existing = {}
    with filepath.open(encoding='utf-8') as file:
        for line in file:
            if not line.strip():
                continue
            record = json.loads(line)
            sha = record.get('sha256')
            row = indexed_rows.get(sha)
            if row is None or sha in existing:
                raise ValueError('unexpected_duplicate_or_unknown_prediction')
            if record.get('sexualContext') != row['sexualContext'] or record.get('nudity') != row['nudity']:
                raise ValueError('cached_prediction_label_mismatch')
            if record.get('sourceGroup') != row['sourceGroup']:
                raise ValueError('cached_prediction_source_mismatch')
            parse_score_record(record, revision)
            existing[sha] = record
    return existing


def summarize(rows, records):
    observed = [records[row['sha256']] for row in rows if row['sha256'] in records]
    labels = Counter(row['sexualContext'] for row in observed)
    explicit = [row for row in observed if row['sexualContext'] == 'explicit_act']
    nonexplicit = [row for row in observed if row['sexualContext'] != 'explicit_act']
    nonexplicit_nude = [row for row in nonexplicit if row['nudity'] in NUDE]

    def porn(row):
        return row['scores']['porn']

    def count_over(items):
        return sum(porn(row) >= .5 for row in items)

    def mean_by_class(label):
        members = [row for row in observed if row['sexualContext'] == label]
        return {
            'count': len(members),
            'meanPornScore': round(statistics.mean(map(porn, members)), 4) if members else None,
            'medianPornScore': round(statistics.median(map(porn, members)), 4) if members else None,
            'meanSexyScore': round(statistics.mean(row['scores']['sexy'] for row in members), 4) if members else None,
        }

    result = {
        'status': 'development_observations_not_approval',
        'modelId': 'viddexa/nsfw-detection-2-mini',
        'modelRevision': observed[0]['modelRevision'] if observed else None,
        'note': (
            "The pretrained model's porn category is not proof of an explicit sexual act. "
            'The 0.5 cutoff below is descriptive, not calibrated for automated moderation. '
            'These development images are NOT a fresh independent holdout.'
        ),
        'developmentImagesExpected': len(rows),
        'developmentImagesScored': len(observed),
        'developmentSourceGroups': len({row['sourceGroup'] for row in rows}),
        'humanLabelCounts': dict(labels),
        'byHumanSexualContext': {label: mean_by_class(label) for label in LABELS},
        'descriptivePornScoreAtHalf': {
            'explicitActLabeledTotal': len(explicit),
            'explicitActAboveHalf': count_over(explicit),
            'explicitActBelowHalf': len(explicit) - count_over(explicit),
            'nonExplicitTotal': len(nonexplicit),
            'nonExplicitAboveHalf': count_over(nonexplicit),
            'nonExplicitNudityTotal': len(nonexplicit_nude),
            'nonExplicitNudityAboveHalf': count_over(nonexplicit_nude),
        },
    }
    if len(observed) == len(rows) and len(explicit) > 0 and len(nonexplicit) > 0:
        from sklearn.metrics import average_precision_score, roc_auc_score
        y = [int(row['sexualContext'] == 'explicit_act') for row in observed]
        scores = [porn(row) for row in observed]
        result['rawPornScoreExplicitActRanking'] = {
            'auroc': round(float(roc_auc_score(y, scores)), 4),
            'averagePrecision': round(float(average_precision_score(y, scores)), 4),
            'baselinePrevalence': round(sum(y) / len(y), 4),
            'interpretation': 'Ranking diagnostics only; not an automated policy threshold',
        }
    return result


def score_development(data_dir, output_dir, revision, max_images):
    validate_revision(revision)
    rows = load_development_rows(data_dir)
    out = Path(output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    cache_path = out / 'nsfw-private-development-scores.jsonl'
    report_path = out / 'nsfw-development-summary.json'
    records = load_existing_predictions(cache_path, revision, rows)
    pending = [row for row in rows if row['sha256'] not in records]
    if max_images is not None:
        pending = pending[:max_images]
    errors = 0
    if pending:
        with cache_path.open('a', encoding='utf-8') as file:
            for index, row in enumerate(pending, 1):
                try:
                    with Image.open(row['resolvedPath']) as original:
                        image = original.convert('RGB')
                    prediction = classify_nsfw(image, revision)
                    scores = {
                        label: next(signal['confidence'] for signal in prediction['signals']
                                    if signal['type'] == SIGNAL_NAMES[label])
                        for label in MODEL_LABELS
                    }
                    record = {
                        'sha256': row['sha256'], 'sourceGroup': row['sourceGroup'],
                        'sexualContext': row['sexualContext'], 'nudity': row['nudity'],
                        'modelRevision': revision, 'scores': scores,
                    }
                    parse_score_record(record, revision)
                    file.write(json.dumps(record, separators=(',', ':')) + '\n')
                    file.flush()
                    records[row['sha256']] = record
                except Exception:
                    errors += 1
                    # Do not log image paths or exception content.
                if index % 25 == 0 or index == len(pending):
                    print(f'Processed {index}/{len(pending)} new images; cached {len(records)}', flush=True)
    summary = summarize(rows, records)
    summary['newInferenceFailures'] = errors
    summary['privateScoreCache'] = str(cache_path)
    report_path.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print('Aggregate report:', report_path, flush=True)
    print(json.dumps(summary['descriptivePornScoreAtHalf'], indent=2))
    return summary


def main():
    parser = argparse.ArgumentParser(description='Aggregate NSFW comparisons on Artes development images')
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--model-revision', required=True)
    parser.add_argument('--max-new-images', type=int)
    args = parser.parse_args()
    if args.max_new_images is not None and args.max_new_images < 1:
        parser.error('max-new-images must be >= 1')
    score_development(args.data_dir, args.output_dir, args.model_revision, args.max_new_images)


if __name__ == '__main__':
    main()
