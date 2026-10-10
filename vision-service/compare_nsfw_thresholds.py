"""Compare fixed NSFW candidates at *matched* explicit-act recall on existing data.

Only uses existing private scores within Codespaces, no model inference or images.
Thresholds are derived from the same development dataset, so these results are
optimistic descriptive diagnostics, NEVER release approval or a calibrated rule.
"""
import argparse
import json
import math
from pathlib import Path

from compare_three_nsfw import MODELS, cache_records
from evaluate_nsfw_development import load_development_rows

NONEXPLICIT_NUDITY = {'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'}
RECALL_TARGETS = (1.0, 40 / 41, 39 / 41)


def candidate_at_threshold(rows, cache, threshold):
    if not isinstance(threshold, (float, int)) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError('invalid_threshold')
    explicit = [r for r in rows if r['sexualContext'] == 'explicit_act']
    nonexplicit = [r for r in rows if r['sexualContext'] != 'explicit_act']
    nudes = [r for r in nonexplicit if r['nudity'] in NONEXPLICIT_NUDITY]

    def selected(group):
        return [r for r in group if cache[r['sha256']]['scores']['porn'] >= threshold]

    tp, fp = selected(explicit), selected(nonexplicit)
    selected_nudes = selected(nudes)
    return {
        'threshold': round(float(threshold), 9),
        'explicitLabeled': len(explicit),
        'explicitSignaled': len(tp),
        'explicitMissed': len(explicit) - len(tp),
        'nonExplicitLabeled': len(nonexplicit),
        'nonExplicitSignaled': len(fp),
        'nonExplicitNudityLabeled': len(nudes),
        'nonExplicitNuditySignaled': len(selected_nudes),
        'totalSignaled': len(tp) + len(fp),
        'proportionOfSignaledWithExplicitHumanLabel': (
            round(len(tp) / (len(tp) + len(fp)), 4) if len(tp) + len(fp) else None
        ),
    }


def matched_recall(rows, cache, required_explicit):
    positives = sorted(
        (cache[r['sha256']]['scores']['porn'] for r in rows
         if r['sexualContext'] == 'explicit_act'),
        reverse=True,
    )
    if not positives or not 1 <= required_explicit <= len(positives):
        raise ValueError('invalid_required_explicit_count')
    # Largest threshold that flags >= N positive examples. Equal scores may
    # produce more flagged cases; using >= handles those ties correctly.
    threshold = positives[required_explicit - 1]
    outcome = candidate_at_threshold(rows, cache, threshold)
    outcome['requestedMinimumExplicitSignaled'] = required_explicit
    outcome['thresholdChosenOnDevelopmentData'] = True
    return outcome


def build_report(rows, caches):
    if set(caches) != set(MODELS):
        raise ValueError('incomplete_model_set')
    if any(set(cache) != {row['sha256'] for row in rows} for cache in caches.values()):
        raise ValueError('incomplete_or_mismatched_scores')
    positives = sum(row['sexualContext'] == 'explicit_act' for row in rows)
    if positives < 1:
        raise ValueError('no_explicit_examples')
    result = {
        'status': 'exploratory_development_threshold_sweep_not_production_approval',
        'developmentImages': len(rows),
        'developmentGroups': len({row['sourceGroup'] for row in rows}),
        'explicitExamples': positives,
        'historicalTestImagesUsed': 0,
        'notes': [
            'All thresholds are chosen from the same development images on which results are measured.',
            'This optimistically describes attainable recall and false alarms on known photos, NOT independent model performance.',
            'The model porn category does not establish an explicit sexual act and cannot auto-approve or auto-reject content.',
            'Identical samples/source groups are not independent observations.',
            'The comparison intentionally does not run image inference or alter the Artes moderation policy.',
        ],
        'models': {},
    }
    targets = sorted(set([positives, max(1, positives - 1), max(1, positives - 2)]), reverse=True)
    for name in MODELS:
        cache = caches[name]
        result['models'][name] = {
            'modelId': MODELS[name][0],
            'modelRevision': MODELS[name][1],
            'fixedThreshold0_5': candidate_at_threshold(rows, cache, .5),
            'minimumRecallTargets': {
                f'{needed}_of_{positives}': matched_recall(rows, cache, needed)
                for needed in targets
            },
        }
    return result


def main():
    parser = argparse.ArgumentParser(description='Compare precomputed scores at matched development recall')
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    rows = load_development_rows(args.data_dir)
    root = Path(args.output_dir).resolve()
    caches = {}
    for key, (_, _, filename) in MODELS.items():
        caches[key] = cache_records(root / filename, rows, key)
    result = build_report(rows, caches)
    filepath = root / 'nsfw-matched-recall-summary.json'
    filepath.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('Report:', filepath)
    for model, details in result['models'].items():
        cases = details['minimumRecallTargets']
        strict = cases[f"{result['explicitExamples']}_of_{result['explicitExamples']}"]
        print(
            f"{model}: strict recall {strict['explicitSignaled']}/{strict['explicitLabeled']}, "
            f"false alarms {strict['nonExplicitSignaled']}, "
            f"non-explicit nudity false alarms {strict['nonExplicitNuditySignaled']}, "
            f"threshold {strict['threshold']:.9f}"
        )
    print('Only upload the aggregate JSON; keep raw predictions private.')


if __name__ == '__main__':
    main()
