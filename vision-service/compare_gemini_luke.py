"""Read-only matching Gemini and Luke Jacob scores against known Artes labels.

Gemini output needs to be keyed by sha256 for the identical image. This script
does not invoke Gemini, transmit images or train models. It safely reports
unavailable scores as unavailable, never as classification failures.
"""
import argparse
import json
from collections import Counter
from pathlib import Path

from evaluate_nsfw_development import load_development_rows
from compare_three_nsfw import cache_records, MODELS

LUKE_DEV_THRESHOLD = 0.233821630  # tuned on these very images; descriptive only
VALID_DECISIONS = {'none', 'borderline', 'explicit'}
STATUS_SET = {'ok', 'safety_blocked', 'invalid_response', 'api_error'}
NUDE = {'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'}


def samples(rows, limit):
    if not isinstance(limit, int) or not 12 <= limit <= 120:
        raise ValueError('pilot_limit_must_be_12_to_120')
    ordered = sorted(rows, key=lambda x: x['sha256'])
    explicit = [r for r in ordered if r['sexualContext'] == 'explicit_act']
    others = [r for r in ordered if r['sexualContext'] != 'explicit_act']
    nude = [r for r in others if r['nudity'] in NUDE]
    nonnude = [r for r in others if r['nudity'] not in NUDE]
    # When possible, include ALL known explicit examples before selecting
    # a balanced mix of non-explicit nude and other non-explicit content.
    n_explicit = min(len(explicit), (limit + 1) // 2 if limit < 2 * len(explicit) else len(explicit))
    selected = explicit[:n_explicit]
    remaining = limit - len(selected)
    selected.extend(nude[: (remaining + 1) // 2])
    selected.extend(nonnude[:remaining - (remaining + 1) // 2])
    # Small, unusual datasets may need extra fill from any unused examples.
    used = {r['sha256'] for r in selected}
    selected.extend([r for r in ordered if r['sha256'] not in used][:limit - len(selected)])
    return selected


def gemini_cache(path, rows):
    if not Path(path).exists():
        return {}
    allowed = {row['sha256'] for row in rows}
    found = {}
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        sha = record.get('sha256')
        if sha not in allowed or sha in found or record.get('status') not in STATUS_SET:
            raise ValueError('untrusted_gemini_cache')
        if not isinstance(record.get('modelVersion'), str) or not record['modelVersion']:
            raise ValueError('unversioned_gemini_prediction')
        if not isinstance(record.get('promptVersion'), str) or not record['promptVersion']:
            raise ValueError('unversioned_gemini_prompt')
        if record['status'] == 'ok' and record.get('adultDecision') not in VALID_DECISIONS:
            raise ValueError('invalid_gemini_adult_decision')
        if record['status'] != 'ok' and record.get('adultDecision') is not None:
            raise ValueError('invalid_unavailable_gemini_decision')
        if record.get('sexualExplicitUncertain') not in (True, False):
            raise ValueError('invalid_gemini_uncertain_flag')
        found[sha] = record
    return found


def summarize(rows, luke, gemini, selected):
    included = [r for r in selected if r['sha256'] in luke]
    paired = [r for r in included if r['sha256'] in gemini]
    if len(included) != len(selected):
        raise ValueError('luke_cache_missing_sample_predictions')
    def score(pair_rows, detector):
        known_pos = [r for r in pair_rows if r['sexualContext'] == 'explicit_act']
        known_neg = [r for r in pair_rows if r['sexualContext'] != 'explicit_act']
        known_nude = [r for r in known_neg if r['nudity'] in NUDE]
        return {
            'explicitTotal': len(known_pos),
            'explicitFlagged': sum(detector(r) for r in known_pos),
            'nonExplicitTotal': len(known_neg),
            'nonExplicitFlagged': sum(detector(r) for r in known_neg),
            'nonExplicitNudityTotal': len(known_nude),
            'nonExplicitNudityFlagged': sum(detector(r) for r in known_nude),
        }
    luke_detector = lambda r: luke[r['sha256']]['scores']['porn'] >= LUKE_DEV_THRESHOLD
    gemini_ready = [r for r in paired if gemini[r['sha256']]['status'] == 'ok']
    gemini_detector = lambda r: gemini[r['sha256']]['adultDecision'] == 'explicit'
    gemini_other_review = [
        r for r in paired if gemini[r['sha256']]['status'] != 'ok'
        or gemini[r['sha256']]['sexualExplicitUncertain']
    ]
    models = sorted(set((gemini[r['sha256']]['modelVersion'],
                         gemini[r['sha256']]['promptVersion']) for r in paired))
    return {
        'status': 'paired_development_pilot_not_independent_release_test',
        'sampleImages': len(selected),
        'sampleSourceGroups': len({r['sourceGroup'] for r in selected}),
        'humanSampleLabels': dict(Counter(r['sexualContext'] for r in selected)),
        'imagesWithGeminiOutput': len(paired),
        'imagesWithValidGeminiDecision': len(gemini_ready),
        'geminiStatuses': dict(Counter(gemini[r['sha256']]['status'] for r in paired)),
        'geminiVersions': [{'model': m, 'promptVersion': p} for m, p in models],
        'lukeAtExploratoryThresholdOnPairedImages': score(paired, luke_detector),
        'geminiExplicitDecisionsOnValidPairedImages': score(gemini_ready, gemini_detector),
        'lukeOnSameGeminiValidImages': score(gemini_ready, luke_detector),
        'geminiEscalationsOrUnavailable': {
            'total': len(gemini_other_review),
            'explicitLabeled': sum(r['sexualContext'] == 'explicit_act' for r in gemini_other_review),
        },
        'pairedOpinionDisagreementsWhereGeminiValid': sum(
            gemini_detector(r) != luke_detector(r) for r in gemini_ready),
        'notes': [
            'Selection is stratified and intentionally oversamples explicit examples; not representative of production rates.',
            'All images are pre-used development images; any threshold chosen on them is optimistically biased.',
            'Luke uses previously cached scores; there are no new image inferences in this report.',
            'Gemini provider safety blocks/errors are UNAVAILABLE/REVIEW, not proof of either explicit or non-explicit content.',
            'Gemini adultDecision explicit and Luke porn score are different classifier semantics.',
            'No model is automatically allowed to publish or reject content.',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description='Existing-only Gemini vs Luke baseline')
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--work', required=True)
    parser.add_argument('--limit', type=int, default=82)
    args = parser.parse_args()
    rows = load_development_rows(args.dataset)
    selection = samples(rows, args.limit)
    work = Path(args.work)
    luke = cache_records(work / MODELS['luke'][2], rows, 'luke')
    if len(luke) != len(rows):
        raise ValueError('full_luke_cache_required_first')
    gemini = gemini_cache(work / 'gemini-luke-private-scores.jsonl', rows)
    result = summarize(rows, luke, gemini, selection)
    outfile = work / 'gemini-luke-aggregate.json'
    outfile.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('Matched Gemini samples found:', result['imagesWithGeminiOutput'], '/', len(selection))
    print('Gemini decisions validated:', result['imagesWithValidGeminiDecision'])
    print('Report:', outfile)


if __name__ == '__main__':
    main()
